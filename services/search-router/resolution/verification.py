"""P-DATA-1A — place-level verification semantics.

``first_seen`` / ``last_seen`` are *observation* timestamps — they answer
"when did a source last sight this place". ``verified_at`` answers a
different question: "when did the evidence actually earn verification".
The two must never alias: a fresh single-source record is confidently
*seen* but not *verified*.

``verification_level`` ladder (monotone in evidence strength):

- ``observed``      — default; one evidence origin, no review.
- ``corroborated``  — ≥2 *independent evidence keys* (P-DATA-1A.1) —
                      see :func:`independence_key`. Two providers citing
                      the same URL are one source, not two.
- ``verified``      — an operator-reviewed record with COMPLETE evidence:
                      ``review_status='verified'`` + ``source_url`` +
                      ``reviewed_at`` + ``verification_method``.
- ``authoritative`` — a contributor from a ``source_policies.kind =
                      'authority'`` provider (first-party truth).

``verified_at`` is the timestamp of the qualifying evidence —
``reviewed_at`` for manual review, the latest contributing
``observed_at`` otherwise — never wall-clock resolution time, so
re-resolution is deterministic and a value only exists at level ≥
corroborated.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ingestion.base import VERIFICATION_METHODS
from resolution.normalize import website_domain

VERIFICATION_LEVELS = ("observed", "corroborated", "verified", "authoritative")
LEVEL_RANK = {level: i for i, level in enumerate(VERIFICATION_LEVELS)}

REVIEW_VERIFIED = "verified"
METHOD_MULTI_SOURCE = "multi_source"
METHOD_FIRST_PARTY = "first_party"
METHOD_MANUAL_REVIEW = "manual_review"


def _as_dt(value: Any) -> datetime | None:
    """datetime | ISO-8601 str → aware datetime; anything else → None."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def _latest(contribs: list[Any], *attrs: str) -> datetime | None:
    """Most recent timestamp across contributors over the given attrs."""
    stamps = [_as_dt(getattr(c, a, None)) for c in contribs for a in attrs]
    stamps = [s for s in stamps if s is not None]
    return max(stamps) if stamps else None


def independence_key(rec: Any, policies: dict[str, dict]) -> str:
    """Identity of the EVIDENCE behind a contribution (P-DATA-1A.1).

    Corroboration must count independent evidence origins, not adapters:
    ``web_corpus`` and ``operator_pilot`` both citing ``cuahangabc.vn``
    are one source, not two. Precedence:

    - ``authority:<provider>`` — a first-party provider's dataset is its
      own evidence lane regardless of which page it cites.
    - ``url:<host>`` — the normalized host of ``source_url`` (lowercase,
      ``www.`` stripped). Domain-level on purpose: every page on the
      business's site is the same underlying evidence, and collapsing
      two platform URLs is the safe direction (never inflates trust).
    - ``provider:<provider>`` — a bare observation keys on its provider.
    """
    provider = getattr(rec, "provider", "") or ""
    if (policies.get(provider) or {}).get("kind") == "authority":
        return f"authority:{provider}"
    url = getattr(rec, "source_url", None)
    host = website_domain(url) if url else None
    if host:
        return f"url:{host}"
    return f"provider:{provider}"


def complete_review(rec: Any) -> bool:
    """A manual-verification claim only counts with the full evidence
    tuple: status + source_url + reviewed_at + verification_method —
    and the method must be in the operator vocabulary. ``reviewed_by``
    is optional provenance, not required evidence."""
    return (
        getattr(rec, "review_status", None) == REVIEW_VERIFIED
        and getattr(rec, "reviewed_at", None) is not None
        and getattr(rec, "verification_method", None) in VERIFICATION_METHODS
        and bool(getattr(rec, "source_url", None))
    )


def verification_for(
    contribs: list[Any], policies: dict[str, dict]
) -> tuple[str, str | None, datetime | None]:
    """(level, method, verified_at) from a place's contributing sources.

    Precedence: authoritative > verified > corroborated > observed — a
    first-party record outranks a review, which outranks raw agreement.
    """
    authority = [
        c for c in contribs if (policies.get(c.provider) or {}).get("kind") == "authority"
    ]
    if authority:
        return "authoritative", METHOD_FIRST_PARTY, _latest(authority, "observed_at")

    reviewed = [c for c in contribs if complete_review(c)]
    if reviewed:
        best = max(reviewed, key=lambda c: _as_dt(c.reviewed_at) or datetime.min.replace(tzinfo=UTC))
        return (
            "verified",
            getattr(best, "verification_method", None) or METHOD_MANUAL_REVIEW,
            _as_dt(getattr(best, "reviewed_at", None)),
        )

    if len({independence_key(c, policies) for c in contribs}) >= 2:
        return "corroborated", METHOD_MULTI_SOURCE, _latest(contribs, "observed_at")

    return "observed", None, None

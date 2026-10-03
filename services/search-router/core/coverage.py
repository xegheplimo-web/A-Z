"""Production coverage signals (P-LEARNING-3).

Every retrieve() folds into a demand cell ``admin_id × category × ISO week``
in hub-postgres ``coverage_signals``. Deliberately aggregate-only — no raw
query, no identifiers. Raw queries live in facade ``search_traces`` with a
short hot retention; coverage is the long-lived demand signal that feeds
acquisition priority.

Best-effort: a DB hiccup must never slow or fail a search response.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Any

from storage import pg_client

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO coverage_signals
    (cell_key, admin_id, category, specialty, week, demand, zero_result, low_result, last_seen_at)
VALUES ($1, $2, $3, $4, $5, 1, $6, $7, now())
ON CONFLICT (cell_key) DO UPDATE SET
    demand       = coverage_signals.demand + 1,
    zero_result  = coverage_signals.zero_result + EXCLUDED.zero_result,
    low_result   = coverage_signals.low_result + EXCLUDED.low_result,
    last_seen_at = now()
"""


def iso_week(today: date | None = None) -> str:
    iso = (today or datetime.now(UTC).date()).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def coverage_cell(result: dict[str, Any], today: date | None = None) -> dict[str, Any] | None:
    """Derive the demand cell from a retrieval result; None when there is no
    meaningful demand anchor (a local query with neither place nor specialty
    would only produce noise)."""
    u = result.get("understanding") or {}
    intent = u.get("intent") or "general"
    places = result.get("places") or {}
    docs = result.get("docs") or []
    exact = len(places.get("exact") or [])
    unverified = len(places.get("unverified") or [])

    if intent == "local_search":
        zero = exact == 0
        low = exact + unverified < 3
    else:
        zero = len(docs) == 0
        low = len(docs) < 3

    # Canonical serving scope, not resolver array order. Historical units
    # expand to ALL successors (Neo → old:07681 → 6 phường), so pick the
    # same-code successor first (old:07681 → new:07681 = direct rename),
    # else commune → province → resolved ids. resolved_current_ids[0] alone
    # split the same demand cell whenever successor order shifted.
    scope = result.get("scope") or {}
    communes = scope.get("communes") or []
    provinces = scope.get("provinces") or []
    matched_codes = {
        str(loc.get("id", "")).rsplit(":", 1)[-1]
        for loc in (u.get("locations") or [])
    }
    admin_id = next(
        (c for c in communes if c.rsplit(":", 1)[-1] in matched_codes),
        None,
    ) or (communes or [None])[0] or (provinces or [None])[0] or (
        u.get("resolved_current_ids") or [None]
    )[0]
    specialty = u.get("specialty")
    if intent == "local_search" and not (admin_id or specialty):
        return None

    category = specialty or intent
    week = iso_week(today)
    return {
        "cell_key": f"{admin_id or '-'}|{category}|{week}",
        "admin_id": admin_id,
        "category": category,
        "specialty": specialty,
        "week": week,
        "zero_result": int(zero),
        "low_result": int(low),
    }


async def record_coverage(result: dict[str, Any]) -> bool:
    """Upsert this search's demand cell. Returns False when skipped/degraded."""
    cell = coverage_cell(result)
    if cell is None:
        return False
    pool = await pg_client.get_pool()
    if pool is None:
        return False
    try:
        await pool.execute(
            _UPSERT_SQL,
            cell["cell_key"],
            cell["admin_id"],
            cell["category"],
            cell["specialty"],
            cell["week"],
            cell["zero_result"],
            cell["low_result"],
        )
        return True
    except Exception:
        logger.warning("coverage signal write failed", exc_info=True)
        return False

"""P-DATA-1A — verification & provenance hardening.

Separates "last observed" (``first_seen`` / ``last_seen``) from "verified"
(``verified_at`` + ``verification_level`` + ``verification_method``). A
fresh single-source record can reach confidence ≈0.70 through
0.6·authority + 0.3·recency + 0.1·corroboration — that alone must never
land a place in the exact bucket, and ``last_seen`` must never be read
as a verification timestamp again.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from ingestion.adapters.ndjson import NdjsonAdapter, entry_to_record
from ingestion.base import VERIFICATION_METHODS, IngestionContext
from ingestion.runner import _RECORD_COLS, _row_dict
from ingestion.validate import validate
from resolution.runner import run_resolution
from resolution.store import DictCanonicalStore
from resolution.verification import (
    LEVEL_RANK,
    complete_review,
    independence_key,
    verification_for,
)
from serving.places.projection import (
    doc_from_index_source,
    doc_to_index_source,
    project_row,
)

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
OLD = NOW - timedelta(days=30)


def _src(provider="osm", observed_at=NOW, **kw):
    base = {
        "provider": provider,
        "observed_at": observed_at,
        "source_url": None,
        "review_status": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "verification_method": None,
    }
    return SimpleNamespace(**{**base, **kw})


def _reviewed(**kw):
    base = {
        "source_url": "https://example.com/p/1",
        "review_status": "verified",
        "reviewed_by": "operator-1",
        "reviewed_at": NOW - timedelta(days=1),
        "verification_method": "official_website",
    }
    return {**base, **kw}


class TestVerificationLevels:
    def test_single_source_is_observed(self):
        level, method, at = verification_for([_src()], {})
        assert (level, method, at) == ("observed", None, None)

    def test_two_records_same_provider_stay_observed(self):
        """Corroboration needs distinct *providers* — two sightings from
        the same source are one voice."""
        level, _, at = verification_for(
            [_src(record_id=1), _src(record_id=2, observed_at=OLD)], {}
        )
        assert level == "observed" and at is None

    def test_two_providers_corroborate(self):
        level, method, at = verification_for(
            [_src("osm", observed_at=OLD), _src("google_maps", observed_at=NOW)], {}
        )
        assert level == "corroborated"
        assert method == "multi_source"
        assert at == NOW  # the second sighting is what corroborates

    def test_complete_manual_review_verifies(self):
        level, method, at = verification_for([_src(**_reviewed())], {})
        assert level == "verified"
        assert method == "official_website"
        assert at == NOW - timedelta(days=1)  # reviewed_at, not observed_at

    def test_incomplete_review_claim_does_not_elevate(self):
        """review_status=verified without the evidence tuple must never
        count — completeness is re-checked here, not just at ingest."""
        for missing in ("source_url", "reviewed_at", "verification_method"):
            kw = _reviewed(**{missing: None})
            level, _, _ = verification_for([_src(**kw)], {})
            assert level == "observed", missing

    def test_authority_provider_outranks_all(self):
        policies = {"gov_registry": {"kind": "authority"}}
        level, method, at = verification_for(
            [
                _src("osm", observed_at=NOW),
                _src("google_maps", observed_at=NOW),
                _src("gov_registry", observed_at=OLD, **_reviewed()),
            ],
            policies,
        )
        assert level == "authoritative"
        assert method == "first_party"
        assert at == OLD  # latest authority-source observation

    def test_manual_review_beats_corroboration(self):
        level, method, _ = verification_for(
            [_src("osm", **_reviewed()), _src("google_maps")], {}
        )
        assert level == "verified" and method == "official_website"

    def test_level_rank_order(self):
        assert LEVEL_RANK["observed"] < LEVEL_RANK["corroborated"]
        assert LEVEL_RANK["corroborated"] < LEVEL_RANK["verified"]
        assert LEVEL_RANK["verified"] < LEVEL_RANK["authoritative"]

    def test_string_timestamps_normalized(self):
        """Dict-store rows / staged JSON may carry ISO strings."""
        level, _, at = verification_for(
            [
                _src("a", observed_at="2026-10-01T00:00:00Z"),
                _src("b", observed_at="2026-10-02T00:00:00Z"),
            ],
            {},
        )
        assert level == "corroborated" and at == datetime(2026, 10, 2, tzinfo=UTC)

    def test_complete_review_helper(self):
        assert complete_review(_src(**_reviewed()))
        assert not complete_review(_src())
        assert not complete_review(_src(**_reviewed(source_url=None)))


class TestEvidenceIndependence:
    """P-DATA-1A.1 — corroboration counts independent EVIDENCE keys,
    not adapters. Two providers citing the same URL are one source."""

    def test_same_source_domain_two_providers_stays_observed(self):
        level, _, at = verification_for(
            [
                _src("web_corpus", source_url="https://cuahangabc.vn/menu"),
                _src("operator_pilot", source_url="https://cuahangabc.vn/about"),
            ],
            {},
        )
        assert level == "observed" and at is None

    def test_same_exact_url_two_providers_stays_observed(self):
        url = "https://review.vn/p/123"
        level, _, _ = verification_for(
            [_src("a", source_url=url), _src("b", source_url=url)], {}
        )
        assert level == "observed"

    def test_www_and_scheme_variants_collapse(self):
        level, _, _ = verification_for(
            [
                _src("a", source_url="https://www.cuahangabc.vn"),
                _src("b", source_url="http://cuahangabc.vn"),
            ],
            {},
        )
        assert level == "observed"

    def test_two_independent_urls_corroborate(self):
        level, method, at = verification_for(
            [
                _src("web_corpus", source_url="https://cuahangabc.vn", observed_at=OLD),
                _src("news_corpus", source_url="https://review.vn/p/123", observed_at=NOW),
            ],
            {},
        )
        assert level == "corroborated" and method == "multi_source" and at == NOW

    def test_url_and_bare_provider_are_two_keys(self):
        """A URL-cited observation plus an independent provider record
        (no URL — keys on provider identity) do corroborate."""
        level, _, _ = verification_for(
            [_src("web_corpus", source_url="https://cuahangabc.vn"), _src("osm")], {}
        )
        assert level == "corroborated"

    def test_key_precedence_authority_then_url_then_provider(self):
        policies = {"gov": {"kind": "authority"}}
        # authority records key on the dataset, not the cited page
        assert independence_key(
            _src("gov", source_url="https://dangkykinhdoanh.gov.vn/p/1"), policies
        ) == "authority:gov"
        assert independence_key(
            _src("web", source_url="https://cuahangabc.vn/x"), {}
        ) == "url:cuahangabc.vn"
        assert independence_key(_src("osm"), {}) == "provider:osm"


class TestVerificationMethodAllowlist:
    """verification_method is a controlled vocabulary — a review claim
    with a free-form method is rejected at ingest and can never elevate
    at resolution."""

    def test_all_allowlisted_methods_pass_ingest(self):
        for method in sorted(VERIFICATION_METHODS):
            rec = entry_to_record(
                {
                    "name": "Cửa hàng A",
                    "source_url": "https://example.com/p/1",
                    "review_status": "verified",
                    "reviewed_at": "2026-10-01T08:00:00Z",
                    "verification_method": method,
                },
                fetched_at=NOW,
                provider="operator_pilot",
            )
            assert validate(rec) == [], method

    def test_unknown_method_rejected_at_ingest(self):
        rec = entry_to_record(
            {
                "name": "Cửa hàng A",
                "source_url": "https://example.com/p/1",
                "review_status": "verified",
                "reviewed_at": "2026-10-01T08:00:00Z",
                "verification_method": "trust_me",
            },
            fetched_at=NOW,
            provider="operator_pilot",
        )
        assert "unknown_verification_method" in validate(rec)

    def test_unknown_method_rejected_without_review_claim(self):
        """The vocabulary stays clean even on inert metadata."""
        rec = entry_to_record(
            {"name": "Cửa hàng A", "verification_method": "abc"},
            fetched_at=NOW,
            provider="operator_pilot",
        )
        assert "unknown_verification_method" in validate(rec)

    def test_unknown_method_cannot_elevate_at_resolution(self):
        """Defense in depth: a staged row that bypassed validation still
        cannot reach 'verified' with a free-form method."""
        level, method, at = verification_for(
            [_src(**_reviewed(verification_method="trust_me"))], {}
        )
        assert (level, method, at) == ("observed", None, None)


# ── resolution end-to-end ────────────────────────────────────────────────


def _row(i: int, **kw) -> dict:
    base = {
        "id": i,
        "provider": "osm",
        "external_id": f"osm_node:{i}",
        "raw_name": f"Place {i}",
        "raw_address": "Neo, Bắc Giang",
        "raw_phone": None,
        "raw_website": None,
        "raw_category": None,
        "raw_hours": None,
        "lat": 21.21,
        "lon": 106.21,
        "admin_unit_id": 1,
        "observed_at": NOW,
        "source_url": None,
        "review_status": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "verification_method": None,
    }
    return {**base, **kw}


async def _feed(rows: list[dict]):
    for r in rows:
        yield r


def _run(rows: list[dict], **kw):
    return asyncio.run(run_resolution(None, sources_feed=_feed(rows), **kw))


class TestResolutionVerification:
    def test_fresh_single_source_stays_observed(self):
        """The P-DATA-1A regression: one brand-new source record →
        high confidence possible, verified NEVER."""
        store = DictCanonicalStore()
        _run([_row(1)], store=store)
        place = store.places[1]
        assert place.verification_level == "observed"
        assert place.verified_at is None
        assert place.verification_method is None

    def test_cross_provider_merge_corroborates(self):
        store = DictCanonicalStore()
        _run(
            [
                _row(1, raw_name="Phở Thìn", observed_at=OLD),
                _row(
                    2,
                    provider="google_maps",
                    external_id="ChIJx",
                    raw_name="Phở Thìn",
                    observed_at=NOW,
                ),
            ],
            store=store,
        )
        place = store.places[1]
        assert place.verification_level == "corroborated"
        assert place.verification_method == "multi_source"
        assert place.verified_at == NOW

    def test_reviewed_record_verifies(self):
        store = DictCanonicalStore()
        _run(
            [
                _row(
                    1,
                    provider="operator_pilot",
                    source_url="https://example.com/p/1",
                    review_status="verified",
                    reviewed_by="operator-1",
                    reviewed_at=NOW - timedelta(days=1),
                    verification_method="official_website",
                )
            ],
            store=store,
        )
        place = store.places[1]
        assert place.verification_level == "verified"
        assert place.verification_method == "official_website"
        assert place.verified_at == NOW - timedelta(days=1)

    def test_unsubstantiated_review_claim_stays_observed(self):
        """Resolution re-checks evidence — a staged row claiming
        verification without it is just an observation."""
        store = DictCanonicalStore()
        _run([_row(1, provider="operator_pilot", review_status="verified")], store=store)
        assert store.places[1].verification_level == "observed"
        assert store.places[1].verified_at is None

    def test_last_seen_tracks_latest_observation(self):
        """first_seen/last_seen are observation timestamps — the merge
        keeps last_seen honest instead of freezing it at creation."""
        store = DictCanonicalStore()
        _run(
            [
                _row(1, raw_name="Phở Thìn", observed_at=OLD),
                _row(2, provider="google_maps", raw_name="Phở Thìn", observed_at=NOW),
            ],
            store=store,
        )
        assert store.places[1].last_seen == NOW

    def test_merged_same_url_stays_observed(self):
        """P-DATA-1A.1 end-to-end: two providers citing the same evidence
        URL merge into one place that stays 'observed'."""
        store = DictCanonicalStore()
        _run(
            [
                _row(1, raw_name="Phở Thìn", source_url="https://review.vn/p/1"),
                _row(
                    2,
                    provider="google_maps",
                    external_id="ChIJx",
                    raw_name="Phở Thìn",
                    source_url="https://review.vn/p/1",
                ),
            ],
            store=store,
        )
        place = store.places[1]
        assert place.verification_level == "observed"
        assert place.verified_at is None

    def test_merged_independent_urls_corroborate(self):
        store = DictCanonicalStore()
        _run(
            [
                _row(1, raw_name="Phở Thìn", source_url="https://review.vn/p/1"),
                _row(
                    2,
                    provider="google_maps",
                    external_id="ChIJx",
                    raw_name="Phở Thìn",
                    source_url="https://dulich.vn/pho-thin",
                ),
            ],
            store=store,
        )
        place = store.places[1]
        assert place.verification_level == "corroborated"
        assert place.verification_method == "multi_source"


# ── projection ───────────────────────────────────────────────────────────


def _prow(i: int, **kw) -> dict:
    base = {
        "place_id": i,
        "business_id": None,
        "canonical_name": f"Place {i}",
        "normalized_name": f"place {i}",
        "canonical_category": "food",
        "address": "Neo",
        "phone": None,
        "website": None,
        "website_domain": None,
        "opening_hours": None,
        "lat": 21.21,
        "lon": 106.21,
        "admin_unit_id": 1,
        "status": "open",
        "confidence": 0.9,
        "source_count": 2,
        "last_seen": NOW,
        "updated_at": NOW,
        "rating": None,
        "review_count": None,
        "price_level": None,
        "primary_image_url": None,
        "images": None,
        "verified_at": None,
        "verification_level": "observed",
        "verification_method": None,
    }
    return {**base, **kw}


class TestProjectionVerification:
    def test_last_seen_is_not_verified_at(self):
        """REGRESSION: the old projection aliased last_seen →
        last_verified_at. An observed-only row now projects NULL."""
        doc = project_row(_prow(1))
        assert doc.last_seen == NOW
        assert doc.last_verified_at is None
        assert doc.verification_level == "observed"

    def test_verified_row_projects_honestly(self):
        doc = project_row(
            _prow(
                2,
                verified_at=NOW,
                verification_level="verified",
                verification_method="official_website",
            )
        )
        assert doc.last_verified_at == NOW
        assert doc.last_seen == NOW
        assert doc.verification_level == "verified"
        assert doc.verification_method == "official_website"
        assert doc.document_version == 2

    def test_index_source_roundtrip_keeps_verification(self):
        doc = project_row(
            _prow(
                3,
                verified_at=NOW,
                verification_level="corroborated",
                verification_method="multi_source",
            )
        )
        back = doc_from_index_source(doc_to_index_source(doc))
        assert back.last_verified_at == NOW
        assert back.last_seen == NOW
        assert back.verification_level == "corroborated"
        assert back.verification_method == "multi_source"

    def test_legacy_index_doc_defaults_observed(self):
        """V1 index docs carry no verification fields — a stale doc
        must downgrade to 'observed', never keep inflated trust."""
        src = doc_to_index_source(project_row(_prow(4)))
        src.pop("verification_level", None)
        src.pop("verification_method", None)
        src["last_verified_at"] = NOW.isoformat()  # stale V1 alias value
        back = doc_from_index_source(src)
        assert back.verification_level == "observed"
        # verified flag downstream reads the level, so an inflated
        # last_verified_at alone cannot promote it (see retrieve gate)


# ── retrieval gate ───────────────────────────────────────────────────────


class _Services:
    """Minimal service binding — canonical rows drive the gate."""

    def __init__(self, rows):
        self._rows = rows

    def profile(self, q):
        return {"freshness_required": False}

    def resolve(self, q):
        return {
            "matched": [{"name": "Yên Dũng", "status": "historical", "admin_level": 2}],
            "current": [{"unit_id": 1, "name": "Neo", "admin_level": 3}],
            "path": [],
        }

    async def anchor(self, q):
        return {"lat": 21.21, "lng": 106.21, "label": "Neo"}

    async def canonical(self, q, loc, ids, limit):
        return self._rows, False

    async def web(self, q, mode, limit):
        return [], False

    async def corpus(self, q, mode, limit):
        return [], False

    async def finish_documents(self, q, lanes, mode, limit, read):
        return []


def _canon_row(i: int, name: str, **kw):
    base = {
        "place_id": i,
        "canonical_name": name,
        "canonical_category": "restaurant",
        "admin_unit_id": 1,
        "address": "Neo, Yên Dũng",
        "status": "open",
        "lat": 21.21,
        "lon": 106.21,
        "confidence": 0.9,
        # strict-product queries need positive field evidence, so rows
        # carry the specialty the way provenance enrichment fills it
        "specialties": ["giò chả"],
        "last_verified_at": None,
        "verification_level": "observed",
    }
    return {**base, **kw}


def _retrieve(rows):
    from core.unified_retrieve import UnifiedRetriever

    return asyncio.run(
        UnifiedRetriever(_Services(rows), deadline_ms=300).retrieve(
            {"query": "quán giò chả Yên Dũng"}
        )
    )


class TestRetrieveGate:
    def test_fresh_single_source_never_exact(self):
        """THE bug: high confidence + fresh last_seen used to verify.
        One provider saying 'giò chả' today is unverified evidence."""
        d = _retrieve([_canon_row(1, "Giò chả A", confidence=0.9)])
        assert d["places"]["exact"] == []
        assert [p["id"] for p in d["places"]["unverified"]] == ["1"]

    def test_stale_index_alias_cannot_verify(self):
        """A doc whose last_verified_at was inflated by the old
        last_seen alias still lacks a level → not exact."""
        d = _retrieve(
            [
                _canon_row(
                    1,
                    "Giò chả A",
                    last_verified_at="2026-10-01T00:00:00Z",
                    verification_level=None,
                )
            ]
        )
        assert d["places"]["exact"] == []
        assert [p["id"] for p in d["places"]["unverified"]] == ["1"]

    def test_corroborated_place_is_exact(self):
        d = _retrieve(
            [
                _canon_row(
                    1,
                    "Giò chả A",
                    verification_level="corroborated",
                    verification_method="multi_source",
                    last_verified_at="2026-10-01T00:00:00Z",
                )
            ]
        )
        assert [p["id"] for p in d["places"]["exact"]] == ["1"]
        assert "verified:multi_source" in d["places"]["exact"][0]["why"]

    def test_manually_verified_place_is_exact(self):
        d = _retrieve(
            [
                _canon_row(
                    1,
                    "Giò chả A",
                    verification_level="verified",
                    verification_method="official_website",
                    last_verified_at="2026-10-01T00:00:00Z",
                )
            ]
        )
        assert [p["id"] for p in d["places"]["exact"]] == ["1"]
        assert "verified:official_website" in d["places"]["exact"][0]["why"]

    def test_confidence_threshold_still_applies(self):
        """Verification opens the gate; confidence still closes it."""
        d = _retrieve(
            [
                _canon_row(
                    1,
                    "Giò chả A",
                    verification_level="corroborated",
                    last_verified_at="2026-10-01T00:00:00Z",
                    confidence=0.5,
                )
            ]
        )
        assert d["places"]["exact"] == []


# ── curated NDJSON review contract ───────────────────────────────────────


def _ctx(parameters=None, checkpoint=None):
    return IngestionContext(
        run_id=1, provider="test", parameters=parameters or {}, checkpoint=checkpoint or {}
    )


class TestNdjsonReviewContract:
    def test_review_fields_map_verbatim(self):
        rec = entry_to_record(
            {
                "name": "Cửa hàng A",
                "source_url": "https://example.com/p/1",
                "review_status": "verified",
                "reviewed_by": "operator-1",
                "reviewed_at": "2026-10-01T08:00:00Z",
                "verification_method": "official_website",
            },
            fetched_at=NOW,
            provider="operator_pilot",
        )
        assert rec.review_status == "verified"
        assert rec.reviewed_by == "operator-1"
        assert rec.reviewed_at == datetime(2026, 10, 1, 8, 0, tzinfo=UTC)
        assert rec.verification_method == "official_website"
        assert validate(rec) == []

    def test_verified_claim_needs_full_evidence(self):
        for missing in ("source_url", "reviewed_at", "verification_method"):
            kw = _reviewed(**{missing: None})
            rec = entry_to_record(
                {"name": "Cửa hàng A", **kw}, fetched_at=NOW, provider="operator_pilot"
            )
            assert "incomplete_review_evidence" in validate(rec), missing

    def test_unknown_review_status_rejected(self):
        rec = entry_to_record(
            {"name": "Cửa hàng A", "review_status": "trusted"},
            fetched_at=NOW,
            provider="operator_pilot",
        )
        assert "invalid_review_status" in validate(rec)

    def test_unreviewed_record_stays_valid_observation(self):
        rec = entry_to_record(
            {"name": "Cửa hàng A"}, fetched_at=NOW, provider="operator_pilot"
        )
        assert rec.review_status is None and validate(rec) == []

    def test_adapter_streams_review_fields(self):
        line = json.dumps({"name": "X", "review_status": "rejected", "reviewed_by": "op"})
        recs = asyncio.run(
            _collect(NdjsonAdapter(lines=[line]), _ctx())
        )
        assert recs[0].review_status == "rejected"
        assert recs[0].reviewed_by == "op"

    def test_runner_stages_review_columns(self):
        rec = entry_to_record(
            {"name": "Cửa hàng A", **_reviewed()},
            fetched_at=NOW,
            provider="operator_pilot",
        )
        row = _row_dict(rec, 1, None, None, "{}", None)
        for col in ("review_status", "reviewed_by", "reviewed_at", "verification_method"):
            assert col in _RECORD_COLS
        assert row["review_status"] == "verified"
        assert row["reviewed_at"] == (NOW - timedelta(days=1)).isoformat()


async def _collect(adapter, ctx):
    return [rec async for rec in adapter.ingest(ctx)]

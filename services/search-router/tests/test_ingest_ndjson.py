"""P-DATA-1 ingestion tests.

Covers the operator_pilot NDJSON adapter (curated business rows — the
legal, reviewed data path) and the OSM adapter's ``bbox`` crop used for
pilot-area imports.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

import pytest
from test_p151_hardening import _build_pbf

from ingestion.adapters.ndjson import NdjsonAdapter, entry_to_record
from ingestion.adapters.osm_pbf import OsmPbfAdapter, _in_bbox, _parse_bbox
from ingestion.base import IngestionContext, RawPlaceRecord
from ingestion.validate import validate

NOW = datetime(2026, 10, 2, tzinfo=UTC)


def _ctx(parameters: dict | None = None, checkpoint: dict | None = None) -> IngestionContext:
    return IngestionContext(
        run_id=1, provider="test", parameters=parameters or {}, checkpoint=checkpoint or {}
    )


async def _collect(adapter, ctx) -> list[RawPlaceRecord]:
    out: list[RawPlaceRecord] = []
    async for rec in adapter.ingest(ctx):
        out.append(rec)
    return out


class TestNdjsonAdapter:
    def test_good_line_maps_all_fields(self):
        line = json.dumps(
            {
                "name": "Quán Giò Chả A",
                "external_id": "pilot-1",
                "source_url": "https://example.com/p/1",
                "address": "Neo, Yên Dũng, Bắc Giang",
                "phone": "0901234567",
                "website": "https://giocha.example.com",
                "category": "quán ăn",
                "hours": {"Monday": ["07:00-17:00"]},
                "status": "OPERATIONAL",
                "lat": 21.207,
                "lon": 106.202,
                "observed_at": "2026-09-30T12:00:00Z",
                "extra_note": "kept verbatim",
            },
            ensure_ascii=False,
        )
        recs = asyncio.run(_collect(NdjsonAdapter(lines=[line]), _ctx()))
        assert len(recs) == 1
        rec = recs[0]
        assert rec.provider == "operator_pilot"
        assert rec.external_id == "pilot-1"
        assert rec.external_id_type == "operator_id"
        assert rec.raw_name == "Quán Giò Chả A"
        assert rec.raw_address == "Neo, Yên Dũng, Bắc Giang"
        assert rec.raw_phone == "0901234567"
        assert rec.raw_category == "quán ăn"
        assert rec.raw_hours == {"Monday": ["07:00-17:00"]}
        assert rec.raw_status == "OPERATIONAL"
        assert rec.lat == pytest.approx(21.207)
        assert rec.lon == pytest.approx(106.202)
        assert rec.observed_at == datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
        assert rec.raw_payload["extra_note"] == "kept verbatim"
        assert validate(rec) == []

    def test_hours_verbatim_string_wrapped(self):
        rec = entry_to_record(
            {"name": "Shop", "hours": "7h-17h hàng ngày"}, fetched_at=NOW, provider="operator_pilot"
        )
        assert rec is not None
        assert rec.raw_hours == {"raw": "7h-17h hàng ngày"}

    def test_bad_json_yields_parse_error_record(self):
        recs = asyncio.run(_collect(NdjsonAdapter(lines=["{not json"]), _ctx()))
        assert len(recs) == 1
        assert "__parse_error__" in recs[0].raw_payload
        assert validate(recs[0]) == ["parse_error"]

    def test_no_identity_hook_yields_unusable_record(self):
        recs = asyncio.run(
            _collect(NdjsonAdapter(lines=[json.dumps({"address": "no name no id"})]), _ctx())
        )
        assert len(recs) == 1
        assert "missing_name" in validate(recs[0])
        assert "missing_identity" in validate(recs[0])

    def test_outside_vietnam_rejected_by_validation(self):
        rec = entry_to_record(
            {"name": "Far Away", "lat": 51.5, "lon": -0.1},
            fetched_at=NOW,
            provider="operator_pilot",
        )
        assert rec is not None
        assert "coords_outside_vietnam" in validate(rec)

    def test_checkpoint_advances_and_resumes(self, tmp_path):
        path = tmp_path / "pilot.ndjson"
        lines = [json.dumps({"name": f"Shop {i}"}) for i in range(3)]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        ctx = _ctx(parameters={"ndjson": str(path)})
        asyncio.run(_collect(NdjsonAdapter(), ctx))
        offset_after_first_run = ctx.checkpoint["offset"]
        assert offset_after_first_run > 0
        # resume from the end of the file → no further records
        recs = asyncio.run(_collect(NdjsonAdapter(), ctx))
        assert recs == []
        # resume mid-file → only the tail is re-read
        mid = len(lines[0].encode()) + 1
        ctx2 = _ctx(parameters={"ndjson": str(path)}, checkpoint={"offset": mid})
        recs2 = asyncio.run(_collect(NdjsonAdapter(), ctx2))
        assert [r.raw_name for r in recs2] == ["Shop 1", "Shop 2"]

    def test_probe_injected_lines(self):
        probe = asyncio.run(NdjsonAdapter(lines=[]).probe())
        assert probe.ok and probe.provider == "operator_pilot"


class TestOsmBbox:
    def test_parse_bbox(self):
        assert _parse_bbox(None) is None
        assert _parse_bbox("") is None
        assert _parse_bbox("105.8,21.0,105.9,21.1") == (105.8, 21.0, 105.9, 21.1)
        with pytest.raises(ValueError):
            _parse_bbox("105.9,21.1,105.8,21.0")  # inverted
        with pytest.raises(ValueError):
            _parse_bbox("1,2,3")

    def test_in_bbox(self):
        inside = RawPlaceRecord(provider="osm", lat=21.05, lon=105.85)
        outside = RawPlaceRecord(provider="osm", lat=21.5, lon=106.5)
        nocoord = RawPlaceRecord(provider="osm")
        bbox = (105.8, 21.0, 105.9, 21.1)
        assert _in_bbox(None, outside)
        assert _in_bbox(bbox, inside)
        assert not _in_bbox(bbox, outside)
        assert not _in_bbox(bbox, nocoord)

    def test_adapter_bbox_filters_nodes(self, tmp_path):
        blocks = [
            {
                "nodes": [
                    (20, 21.03, 105.85, {"name": "Cà Phê Trong", "amenity": "cafe"}),
                    (30, 21.50, 106.50, {"name": "Shop Ngoài", "shop": "convenience"}),
                ]
            }
        ]
        path = tmp_path / "t.osm.pbf"
        path.write_bytes(_build_pbf(blocks))
        ctx = _ctx(parameters={"pbf": str(path), "bbox": "105.80,21.00,105.90,21.10"})
        recs = asyncio.run(_collect(OsmPbfAdapter(path, backend="pbf"), ctx))
        assert [r.raw_name for r in recs] == ["Cà Phê Trong"]
        # without bbox both POI nodes are emitted
        recs_all = asyncio.run(_collect(OsmPbfAdapter(path, backend="pbf"), _ctx()))
        assert {r.raw_name for r in recs_all} == {"Cà Phê Trong", "Shop Ngoài"}

"""Operator-curated NDJSON adapter (P-DATA-1).

The legal path for reviewed, operator-provided business rows — the pilot
doc forbids random crawling and Google scraping, so curated exports land
here with honest provenance (provider ``operator_pilot``).

One JSON object per line::

    {
      "name": "Quán Giò Chả A",        # required (missing → DLQ missing_name)
      "external_id": "pilot-0001",     # optional stable id; id-less rows
                                       # dedupe on (provider, identity_hash)
      "external_id_type": "pilot_id",  # optional, default "operator_id"
      "source_url": "https://…",       # where the observation came from
      "address": "…", "phone": "…", "website": "…",
      "category": "nhà hàng",          # source label → source_category_mappings
      "hours": {"Monday": ["07:00-17:00"]}  # dict, or a verbatim string
      "status": "OPERATIONAL",         # provider-reported status verbatim
      "lat": 21.207, "lon": 106.202,
      "observed_at": "2026-10-02T09:00:00Z"  # optional; defaults to fetch time
    }

Unknown keys are preserved verbatim inside ``raw_payload`` — the runner
is the only fidelity boundary downstream.

Context parameters:
  ``ndjson`` — path to the line-delimited file (required unless ``lines``
  is injected for tests/API upload).
Checkpoint: ``{"offset": N}`` byte offset for resume (same as gmaps).
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import AsyncIterator, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ingestion.base import IngestionContext, RawPlaceRecord, SourceProbe

logger = logging.getLogger(__name__)


def _s(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _f(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _dt(value: Any) -> datetime | None:
    """ISO-8601 string → aware datetime; anything else → None (validator DLQs)."""
    if isinstance(value, datetime):
        return value
    text = _s(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def entry_to_record(
    obj: dict[str, Any], *, fetched_at: datetime, provider: str
) -> RawPlaceRecord | None:
    """Map one curated JSON line → RawPlaceRecord. Whole line stays in payload."""
    if not isinstance(obj, dict):
        return None
    name = _s(obj.get("name"))
    ext_id = _s(obj.get("external_id"))
    if not name and not ext_id:
        return None  # validator needs at least one identity hook
    hours = obj.get("hours")
    return RawPlaceRecord(
        provider=provider,
        external_id=ext_id,
        external_id_type=_s(obj.get("external_id_type")) or ("operator_id" if ext_id else None),
        source_url=_s(obj.get("source_url")),
        raw_name=name,
        raw_address=_s(obj.get("address")),
        raw_phone=_s(obj.get("phone")),
        raw_website=_s(obj.get("website")),
        raw_category=_s(obj.get("category")),
        raw_hours=hours if isinstance(hours, dict) else ({"raw": hours} if _s(hours) else None),
        raw_status=_s(obj.get("status")),
        lat=_f(obj.get("lat")),
        lon=_f(obj.get("lon")),
        raw_payload=obj,
        observed_at=_dt(obj.get("observed_at")) or fetched_at,
        fetched_at=fetched_at,
    )


class NdjsonAdapter:
    """Streams curated JSONL rows → RawPlaceRecord.

    ``lines`` constructor arg / ``lines`` param accepts an in-memory
    iterable (tests, API upload); otherwise the ``ndjson`` path is read.
    """

    name = "operator_pilot"
    adapter_version = "ndjson-v1"

    def __init__(self, lines: Iterable[str] | None = None):
        self._lines = lines
        self.source_dataset: dict[str, Any] = {}

    async def probe(self) -> SourceProbe:
        if self._lines is not None:
            return SourceProbe(ok=True, provider=self.name, detail="lines injected")
        return SourceProbe(ok=True, provider=self.name, detail="file-based; probe at ingest")

    async def ingest(self, context: IngestionContext) -> AsyncIterator[RawPlaceRecord]:
        fetched = datetime.now(UTC)
        offset = int(context.checkpoint.get("offset", 0) or 0)
        sha = hashlib.sha256()
        size = 0

        if self._lines is not None:
            stream: Iterable[str] = self._lines
        else:
            path = Path(str(context.param("ndjson", "")))
            # newline="" keeps raw bytes/line endings visible so checkpoint
            # byte offsets and the dataset sha stay accurate on Windows too.
            f = path.open("r", encoding="utf-8", errors="replace", newline="")
            if offset:
                f.seek(offset)
            stream = f
            self.source_dataset = {
                "file": path.name,
                "hash_scope": "from_checkpoint" if offset else "full",
            }

        pos = offset
        for line in stream:
            raw = line.encode("utf-8", errors="replace")
            sha.update(raw)
            size += len(raw)
            self.source_dataset.update({"sha256": sha.hexdigest(), "size_bytes": size})
            pos += len(raw)
            context.checkpoint["offset"] = pos
            stripped = line.strip()
            if not stripped:
                continue
            try:
                obj = json.loads(stripped)
            except json.JSONDecodeError:
                # Runner counts parse failures; surface as an unusable record.
                yield RawPlaceRecord(
                    provider=self.name,
                    raw_payload={"__parse_error__": stripped[:2000]},
                    observed_at=None,
                    fetched_at=fetched,
                )
                continue
            rec = entry_to_record(obj, fetched_at=fetched, provider=self.name)
            if rec is None:
                yield RawPlaceRecord(
                    provider=self.name,
                    raw_payload=obj if isinstance(obj, dict) else {"__raw__": stripped[:2000]},
                    observed_at=None,
                    fetched_at=fetched,
                )
                continue
            yield rec


__all__ = ["NdjsonAdapter", "entry_to_record"]

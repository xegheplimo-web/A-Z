"""Retrieval Contract v1 orchestration, NOT a second search engine.

Existing dependencies own the work: QueryUnderstanding / AdminGraph,
PlacesService (OS + PostGIS), SearchOrchestrator (SourceRouter + federation),
FederatedRetriever (BM25 + dense RRF), and the bounded reader.
No answer/research/LLM entrypoint is called here.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
import time
from typing import Any, cast
from urllib.parse import urlsplit

from core.entity_resolver import fold
from core.local_discovery import extract_specialty, locality_of


def plain(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "__dataclass_fields__"):
        from dataclasses import asdict

        return asdict(value)
    return value


def distance_km(a: dict, b: dict) -> float | None:
    if any(v is None for v in (a.get("lat"), a.get("lng"), b.get("lat"), b.get("lon"))):
        return None
    lat1, lon1, lat2, lon2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lon"]))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


class ExistingCoreServices:
    """Binding to the pinned upstream's existing services; lazy imports keep tests light."""

    def profile(self, query: str):
        from api.v1 import _get_orchestrator

        return plain(_get_orchestrator().query_understanding.analyze(query))

    def resolve(self, query: str):
        from api.v1 import _get_admin_resolver

        return plain(_get_admin_resolver().resolve(query))

    async def anchor(self, query: str):
        from services.admin import admin_anchor

        p = await admin_anchor(query)
        return (
            {"lat": p.lat, "lng": p.lon, "label": p.display_name or p.name}
            if p
            else None
        )

    async def canonical(
        self, query: str, location: dict | None, unit_ids: list[int], limit: int
    ):
        from api.v1 import _get_places_service

        service = _get_places_service()

        # Existing serving cache -> OS candidates -> PostGIS exact geo. Bounded fanout.
        async def one(unit_id):
            rows, meta = await service.search(
                q=query,
                lat=location["lat"] if location else None,
                lon=location["lng"] if location else None,
                radius_m=5000,
                admin_unit_id=unit_id,
                admin_contains=unit_id is not None,
                limit=min(50, limit * 3),
                debug=True,
            )
            return rows, bool(getattr(meta, "degraded", False))

        results = await asyncio.gather(*(one(i) for i in (unit_ids[:8] or [None])))
        rows = [r for batch, _ in results for r in batch][:100]

        # Strict product queries need positive field evidence, not a generic restaurant/hardware label.
        async def enrich(row):
            if row.get("specialties") or row.get("specialty_evidence"):
                return row
            detail = await service.get_place(row["place_id"])
            payload = cast(dict[str, Any] | None, getattr(detail, "payload", None))
            if payload:
                evidence = [
                    str(p.get("value", ""))
                    for p in payload.get("provenance", [])
                    if p.get("chosen")
                    and p.get("field")
                    in {"specialties", "products", "menu", "cuisine", "description"}
                ]
                return {**row, "specialty_evidence": " ".join(evidence)}
            return row

        if extract_specialty(query)[0] in {"giò chả", "sắt thép"} or re.search(
            r"(?<!\w)sat(?!\w)", fold(query)
        ):
            details = await asyncio.gather(
                *(enrich(r) for r in rows[:30]), return_exceptions=True
            )
            rows = [
                original if isinstance(detail, Exception) else detail
                for original, detail in zip(rows[:30], details)
            ] + rows[30:]
        return rows, any(d for _, d in results)

    async def web(self, query: str, mode: str, limit: int):
        from api.v1 import _get_orchestrator
        from core.budget import SearchBudget

        orchestrator = _get_orchestrator()
        before = {
            name: health.last_failure
            for name, health in orchestrator.monitor.snapshot_all().items()
        }
        budget = SearchBudget.for_mode(mode)
        profile = orchestrator.query_understanding.analyze(query)
        sources = await orchestrator._search_query(
            query, budget, profile, mode, overrides={"max_results": min(50, limit * 3)}
        )
        after = orchestrator.monitor.snapshot_all()
        degraded = any(
            health.last_failure is not None
            and health.last_failure != before.get(name)
            for name, health in after.items()
        ) or any(health.circuit.value != "closed" for health in after.values())
        return [plain(s) for s in sources[:50]], degraded

    async def corpus(self, query: str, mode: str, limit: int):
        from api.v1 import _hybrid_retrieve

        result = await _hybrid_retrieve(query)
        return [
            plain(s) for s in result.to_source_results(top_n=min(50, limit * 3))
        ], result.degraded

    async def finish_documents(
        self, query: str, lanes: list[list[dict]], mode: str, limit: int, read: bool
    ):
        from api.v1 import _get_orchestrator
        from core.budget import SearchBudget
        from models import Source

        orchestrator = _get_orchestrator()
        # Preserve the core's URL identity + normalization. RRF is rank fusion only.
        acc: dict[str, tuple[Source, float]] = {}
        for lane in lanes:
            seen = set()
            for rank, row in enumerate(lane[:50]):
                url = row.get("canonical_url") or row.get("url")
                if not url or url in seen:
                    continue
                identity = orchestrator._canonical(url)
                seen.add(url)
                source = Source(
                    **{k: v for k, v in row.items() if k in Source.model_fields}
                )
                old = acc.get(identity)
                score = (old[1] if old else 0) + 1 / (60 + rank + 1)
                acc[identity] = (
                    old[0]
                    if old and len(old[0].content) >= len(source.content)
                    else source,
                    score,
                )
        top = [s for s, _ in sorted(acc.values(), key=lambda p: -p[1])[:30]]
        profile = orchestrator.query_understanding.analyze(query)
        top = orchestrator._rank(top, query, profile.freshness_required)[:limit]
        if read and top:
            await orchestrator._fetch_top(
                top[: min(7, limit)], SearchBudget.for_mode(mode)
            )
        return [plain(s) for s in top]


class UnifiedRetriever:
    def __init__(self, services=None, deadline_ms: int | None = None):
        self.services = services or ExistingCoreServices()
        self.deadline_ms = deadline_ms

    async def retrieve(self, req: dict) -> dict:
        started = time.monotonic()
        query = req["query"].strip()
        normalized = fold(query)
        profile = self.services.profile(query)
        specialty, forms = extract_specialty(query)
        # Add common local vocabulary without introducing another NLP stack.
        extra = [
            ("sắt thép", ("sat", "sat thep")),
            ("tạp hóa", ("bach hoa", "tap hoa")),
            ("nhà thuốc", ("nha thuoc", "hieu thuoc")),
        ]
        for label, aliases in extra:
            if any(
                re.search(r"(?<!\w)" + re.escape(a) + r"(?!\w)", normalized)
                for a in aliases
            ):
                specialty, forms = label, aliases
                break
        legal = bool(
            re.search(r"nghi dinh|thong tu|hoa don|phap luat|thue", normalized)
        )
        local = (
            bool(specialty or re.search(r"quan |cua hang|gan day|gan neo", normalized))
            and not legal
        )
        intent = (
            "local_search"
            if local
            else "legal"
            if legal
            else "news"
            if re.search(r"tin tuc|tin moi", normalized)
            else "market_price"
            if re.search(r"gia vang|ty gia|gia xang", normalized)
            else "weather"
            if "thoi tiet" in normalized
            else "general"
        )
        location_text = locality_of(query) if local else query
        resolved = self.services.resolve(location_text or query)
        matched = resolved.get("matched", [])
        current = resolved.get("current", [])
        if not matched and req.get("context") and local:
            resolved = self.services.resolve(req["context"])
            matched, current = resolved.get("matched", []), resolved.get("current", [])
        explicit = req.get("location")
        anchor = {**explicit, "label": "vị trí của bạn"} if explicit else None
        if not anchor and local:
            try:
                anchor = await asyncio.wait_for(
                    self.services.anchor(location_text or query), timeout=0.4
                )
            except (TimeoutError, OSError):
                anchor = None
        mode = req.get("mode", "auto")
        budget = (
            "research"
            if mode in ("research", "deep")
            else "standard"
            if mode in ("standard", "balanced")
            else "fast"
            if mode == "fast" or local
            else "standard"
        )
        deadline = (
            started
            + (
                self.deadline_ms
                or {"fast": 4500, "standard": 8000, "research": 15000}[budget]
            )
            / 1000
        )
        limit = min(30, max(1, req.get("max_results", 10)))
        stages, widening = [], []
        core_mode = {"fast": "fast", "standard": "normal", "research": "deep"}[budget]
        unit_ids = [
            u["unit_id"]
            for u in current
            if u.get("unit_id") is not None and u.get("admin_level", 1) >= 2
        ]
        near = bool(re.search(r"\bgan\b|\bneo\b", normalized)) or explicit is not None

        async def lane(name, factory, cap=2.5):
            t = time.monotonic()
            try:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                rows, degraded = await asyncio.wait_for(factory(), min(cap, remaining))
                stages.append(
                    {
                        "provider": name,
                        "lane": name,
                        "status": "error" if degraded else "ok" if rows else "empty",
                        "count": len(rows),
                        "ms": round((time.monotonic() - t) * 1000),
                        "detail": "dependency degraded" if degraded else "",
                    }
                )
                return rows
            except TimeoutError:
                status = "timeout"
            except Exception:  # noqa: BLE001 — provider failures are contract data
                status = "error"
            stages.append(
                {
                    "provider": name,
                    "lane": name,
                    "status": status,
                    "count": 0,
                    "ms": round((time.monotonic() - t) * 1000),
                }
            )
            return []

        exact, unverified, related = [], [], []
        if local:
            rows = await lane(
                "canonical-places",
                lambda: self.services.canonical(query, anchor, unit_ids, limit),
                1.8,
            )
            seen = set()
            area_terms = [fold(u.get("name", "")) for u in matched]
            for row in rows:
                pid = str(row.get("place_id") or row.get("id") or "")
                if (
                    not pid
                    or pid in seen
                    or row.get("status") in ("closed", "permanently_closed")
                ):
                    continue
                seen.add(pid)
                dist = distance_km(anchor, row) if anchor else None
                in_scope = row.get("admin_unit_id") in unit_ids if unit_ids else False
                if near and anchor or not unit_ids and anchor:
                    in_scope = dist is not None and dist <= 5
                elif not unit_ids and area_terms:
                    # Address evidence only; never use a province match to satisfy a commune query.
                    address = fold(row.get("address") or "")
                    in_scope = any(term and term in address for term in area_terms)
                if not in_scope:
                    continue
                category = row.get("canonical_category") or row.get("category") or ""
                evidence = fold(
                    " ".join(
                        [
                            row.get("canonical_name") or row.get("name") or "",
                            row.get("description") or "",
                            " ".join(row.get("specialties") or []),
                            str(row.get("specialty_evidence") or ""),
                        ]
                    )
                )
                if specialty in {"giò chả", "sắt thép"}:
                    evidence = fold(
                        " ".join(
                            [
                                row.get("description") or "",
                                " ".join(row.get("specialties") or []),
                                str(row.get("specialty_evidence") or ""),
                            ]
                        )
                    )
                matched_specialty = not specialty or any(
                    re.search(r"(?<!\w)" + re.escape(fold(f)) + r"(?!\w)", evidence)
                    for f in forms or [specialty]
                )
                allowed_category = {
                    "cà phê": {"cafe", "coffee_shop"},
                    "tạp hóa": {"convenience", "grocery", "supermarket"},
                    "nhà thuốc": {"pharmacy"},
                }
                matched_specialty = matched_specialty or (
                    specialty is not None
                    and category in allowed_category.get(specialty, set())
                )
                verified = (
                    bool(row.get("last_verified_at"))
                    and float(row.get("confidence") or 0) >= 0.7
                )
                p = {
                    "id": pid,
                    "name": row.get("canonical_name") or row.get("name") or "",
                    "category": category,
                    "category_label": category,
                    "address": row.get("address") or "",
                    "province_id": str(row.get("province_id") or ""),
                    "specialties": [specialty]
                    if specialty and matched_specialty
                    else [],
                    "rating": row.get("rating"),
                    "review_count": row.get("review_count") or 0,
                    "phone": row.get("phone"),
                    "hours": None,
                    "open_now": row.get("open_now"),
                    "distance_km": dist,
                    "distance_label": f"{dist:.1f} km" if dist is not None else None,
                    "image": row.get("primary_image_url"),
                    "source": "canonical",
                    "verified": verified,
                    "score": float(row.get("confidence") or 0),
                    "lat": row.get("lat"),
                    "lng": row.get("lon"),
                    "updated_at": row.get("last_verified_at"),
                    "why": [
                        "specialty evidence"
                        if matched_specialty
                        else "related category"
                    ],
                }
                (
                    exact
                    if matched_specialty and verified
                    else unverified
                    if matched_specialty
                    else related
                ).append(p)
        lane_docs: list[list[dict[str, Any]]] = []
        if not local or len(exact) < min(2, limit):
            if local:
                widening.append(
                    "Canonical chưa đủ bằng chứng → web + own index; kết quả web không tự trở thành địa điểm exact."
                )
            lane_docs = cast(
                list[list[dict[str, Any]]],
                list(
                    await asyncio.gather(
                        lane("live-web", lambda: self.services.web(query, core_mode, limit)),
                        lane(
                            "own-index",
                            lambda: self.services.corpus(query, core_mode, limit),
                        ),
                    )
                ),
            )
        elif local:
            stages.append(
                {
                    "provider": "live-web",
                    "lane": "progressive widening",
                    "status": "skipped",
                    "ms": 0,
                    "count": 0,
                }
            )
        before_rank = time.monotonic()
        docs = []
        if any(lane_docs):
            remaining = deadline - time.monotonic()
            if remaining > 0:
                try:
                    docs = await asyncio.wait_for(
                        self.services.finish_documents(
                            query,
                            lane_docs,
                            core_mode,
                            min(limit, 10),
                            req.get("evidence") != "off" and budget != "fast",
                        ),
                        remaining,
                    )
                except Exception:  # noqa: BLE001 — bounded reader degrades to no docs
                    stages.append(
                        {
                            "provider": "reader-rerank",
                            "lane": "evidence",
                            "status": "error",
                            "ms": 0,
                            "count": 0,
                        }
                    )
        doc_rows = []
        for d in docs[:limit]:
            url = d.get("canonical_url") or d.get("url") or ""
            if not url.startswith(("http://", "https://")):
                continue
            domain = urlsplit(url).hostname or ""
            typ = (
                "government"
                if domain.endswith(".gov.vn")
                else "news"
                if intent == "news"
                else "web"
            )
            doc_rows.append(
                {
                    "id": d.get("source_id")
                    or hashlib.sha256(url.encode()).hexdigest(),
                    "title": d.get("title") or "",
                    "url": url,
                    "domain": domain,
                    "source_type": typ,
                    "snippet": d.get("description") or "",
                    "content": d.get("content") or d.get("description") or "",
                    "authority": max(
                        0,
                        min(
                            1,
                            d.get("authority_score")
                            or (0.9 if typ == "government" else 0.5),
                        ),
                    ),
                    "published_at": d.get("published_at"),
                    "entities": [],
                    "score": float(d.get("score") or 0),
                    "why": ["existing core federation + bounded rerank"],
                    "origin": "search-router",
                }
            )
        count = len(exact) if local else len(doc_rows)
        conf = (
            0.85 if count >= 2 else 0.7 if count == 1 else 0.35 if unverified else 0.0
        )
        historical = [u for u in matched if u.get("status") != "current"]
        transition = (
            {
                "from": historical[0]["name"],
                "to": [u["name"] for u in current],
                "date": (resolved.get("path") or [{}])[0].get("effective_date"),
            }
            if historical and current
            else None
        )
        elapsed = (time.monotonic() - started) * 1000
        return {
            "contract_version": "1",
            "backend": "search-router",
            "understanding": {
                "raw": query,
                "normalized": normalized,
                "tokens": normalized.split(),
                "intent": intent,
                "intent_label": "Địa điểm" if local else intent,
                "specialty": specialty,
                "categories": [
                    {
                        "giò chả": "gio-cha",
                        "cà phê": "cafe",
                        "sắt thép": "vlxd",
                        "tạp hóa": "tap-hoa",
                        "nhà thuốc": "nha-thuoc",
                    }[specialty]
                ]
                if specialty
                in {"giò chả", "cà phê", "sắt thép", "tạp hóa", "nhà thuốc"}
                else [],
                "freshness": "today" if profile.get("freshness_required") else "any",
                "locations": [
                    {
                        "id": str(u.get("key") or u.get("unit_id")),
                        "name": u["name"],
                        "type": u.get("type", "unknown"),
                        "status": u.get("status", "current"),
                        "matched_term": fold(u["name"]),
                        "fuzzy": False,
                    }
                    for u in matched
                ],
                "resolved_current_ids": [
                    str(u.get("key") or u.get("unit_id")) for u in current
                ],
                "transition": transition,
                "compare_targets": None,
                "fuzzy": {"used": False, "notes": []},
            },
            "budget": {
                "name": budget,
                "reason": "deterministic core policy",
                "target_ms": "≤5s" if local else "≤10s",
                "multi_hop": False,
                "read_evidence": budget != "fast",
            },
            "places": {
                "exact": exact[:limit],
                "unverified": unverified[: max(0, limit - len(exact))],
                "related": related[:limit],
                "candidates": [],
            },
            "docs": doc_rows,
            "coverage": {
                "gap": count == 0,
                "reason": "Chưa có kết quả đủ bằng chứng trong phạm vi yêu cầu."
                if not count
                else None,
                "widened": bool(widening),
            },
            "anchor": anchor,
            "scope": {
                "provinces": [
                    str(u.get("key")) for u in current if u.get("admin_level") == 1
                ],
                "communes": [
                    str(u.get("key")) for u in current if u.get("admin_level", 0) >= 2
                ],
            },
            "quality": {
                "confidence": conf,
                "coverage": "good"
                if conf >= 0.7
                else "partial"
                if conf >= 0.35
                else "none",
                "independent_sources": len({d["domain"] for d in doc_rows}),
                "avg_authority": sum(d["authority"] for d in doc_rows)
                / max(1, len(doc_rows)),
            },
            "federation": stages,
            "widening": widening,
            "timings": {
                "total_ms": round(elapsed),
                "retrieve_ms": round((before_rank - started) * 1000),
                "rerank_ms": round((time.monotonic() - before_rank) * 1000),
                "understand_ms": 0,
            },
        }

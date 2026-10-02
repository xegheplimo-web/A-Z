"""Exercise ExistingCoreServices with REAL upstream normalizer/ranker/admin graph.
Only external I/O is stubbed. This catches wrong signatures hidden by a fake facade.
"""

import asyncio
from types import SimpleNamespace

from api import v1
from core.unified_retrieve import ExistingCoreServices, UnifiedRetriever
from models import Source


def test_live_bindings_use_existing_orchestrator(monkeypatch):
    calls = []
    original = v1._get_orchestrator()

    async def web(query, budget, profile, mode, progress=None, overrides=None):
        calls.append(("web", mode, overrides["max_results"]))
        return [
            Source(
                source_id="gov",
                title="Hóa đơn điện tử",
                url="https://vanban.chinhphu.vn/hoa-don",
                domain="vanban.chinhphu.vn",
                description="Hóa đơn điện tử và hộ kinh doanh",
                content="Bằng chứng mẫu từ transport test.",
            )
        ]

    async def reader(top, budget):
        calls.append(("read", len(top)))
        return top

    monkeypatch.setattr(original, "_search_query", web)
    monkeypatch.setattr(original, "_fetch_top", reader)
    monkeypatch.setattr(v1, "_get_orchestrator", lambda: original)

    async def hybrid(q):
        # Same URL in own index: core URL identity must deduplicate it.
        return SimpleNamespace(
            degraded=False,
            to_source_results=lambda top_n: [
                Source(
                    source_id="index",
                    title="Hóa đơn điện tử",
                    url="https://vanban.chinhphu.vn/hoa-don",
                    domain="vanban.chinhphu.vn",
                    content="Nội dung index kiểm thử.",
                )
            ],
        )

    monkeypatch.setattr(v1, "_hybrid_retrieve", hybrid)

    result = asyncio.run(
        UnifiedRetriever(ExistingCoreServices()).retrieve(
            {
                "query": "nghị định hóa đơn điện tử",
                "evidence": "full",
                "max_results": 10,
            }
        )
    )
    assert len(result["docs"]) == 1
    assert result["docs"][0]["domain"] == "vanban.chinhphu.vn"
    assert any(c[0] == "read" for c in calls)
    assert result["backend"] == "search-router"


def test_five_local_queries_route_through_places_without_llm(monkeypatch):
    original = v1._get_orchestrator()
    calls = []

    class PlaceService:
        async def search(self, **kwargs):
            calls.append(kwargs)
            return [], SimpleNamespace(degraded=False)

    monkeypatch.setattr(v1, "_get_places_service", lambda: PlaceService())

    async def no_web(*args, **kwargs):
        return []

    monkeypatch.setattr(original, "_search_query", no_web)
    monkeypatch.setattr(v1, "_get_orchestrator", lambda: original)

    async def hybrid(q):
        return SimpleNamespace(degraded=False, to_source_results=lambda top_n: [])

    monkeypatch.setattr(v1, "_hybrid_retrieve", hybrid)
    services = ExistingCoreServices()

    # Geo anchor service is external I/O. Admin graph resolution remains real.
    async def no_anchor(q):
        return None

    monkeypatch.setattr(services, "anchor", no_anchor)

    async def run():
        for query, specialty in [
            ("quán giò chả Yên Dũng", "giò chả"),
            ("quán cafe Yên Dũng Neo", "cà phê"),
            ("cửa hàng sắt Tân An", "sắt thép"),
            ("cửa hàng bách hóa Yên Dũng", "tạp hóa"),
            ("nhà thuốc gần Neo", "nhà thuốc"),
        ]:
            r = await UnifiedRetriever(services).retrieve({"query": query})
            assert r["understanding"]["intent"] == "local_search"
            assert r["understanding"]["specialty"] == specialty
            assert r["places"]["exact"] == []  # no data => no invented match
        assert len(calls) >= 5

    asyncio.run(run())


def test_quay_thuoc_satisfies_nha_thuoc_specialty(monkeypatch):
    """P-DATA-1B pilot gap: 'Quầy Thuốc …' is the most common pharmacy
    surface form in the wild, but the 'nhà thuốc' evidence forms did not
    cover it — a real pharmacy was silently demoted to 'related'."""
    original = v1._get_orchestrator()

    class PlaceService:
        async def search(self, **kwargs):
            return [
                {
                    "place_id": "qx1",
                    "canonical_name": "Quầy Thuốc Số 30",
                    "name": "Quầy Thuốc Số 30",
                    "canonical_category": "health",
                    "address": "Kiot 30, Thị trấn Nham Biền, Bắc Giang",
                    "status": "open",
                    "confidence": 0.68,
                    "verification_level": "observed",
                    "last_verified_at": None,
                }
            ], SimpleNamespace(degraded=False)

        async def get_place(self, place_id):
            return SimpleNamespace(payload=None)

    monkeypatch.setattr(v1, "_get_places_service", lambda: PlaceService())

    async def no_web(*args, **kwargs):
        return []

    monkeypatch.setattr(original, "_search_query", no_web)
    monkeypatch.setattr(v1, "_get_orchestrator", lambda: original)

    async def hybrid(q):
        return SimpleNamespace(degraded=False, to_source_results=lambda top_n: [])

    monkeypatch.setattr(v1, "_hybrid_retrieve", hybrid)
    services = ExistingCoreServices()

    async def no_anchor(q):
        return None

    monkeypatch.setattr(services, "anchor", no_anchor)

    r = asyncio.run(
        UnifiedRetriever(services).retrieve({"query": "nhà thuốc gần Neo"})
    )
    unverified = {p["name"] for p in r["places"]["unverified"]}
    assert "Quầy Thuốc Số 30" in unverified, r["places"]

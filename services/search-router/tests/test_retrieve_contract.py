"""ASGI contract tests against the real port; external services injected, never live claims."""

import asyncio
import json
from pathlib import Path

import httpx
from fastapi import FastAPI

from api.retrieve import retrieval_service, router
from core.unified_retrieve import UnifiedRetriever
from security.apikeys import require_api_key


class Services:
    def __init__(self, empty=False, fail=False):
        self.calls = []
        self.empty = empty
        self.fail = fail

    def profile(self, q):
        return {"freshness_required": False}

    def resolve(self, q):
        return {
            "matched": [
                {
                    "key": "old:yd",
                    "name": "Yên Dũng",
                    "status": "historical",
                    "type": "huyen",
                    "admin_level": 2,
                }
            ],
            "current": [
                {"key": "new:neo", "unit_id": 1, "name": "Neo", "admin_level": 3}
            ],
            "path": [{"effective_date": "2025-07-01"}],
        }

    async def anchor(self, q):
        return {"lat": 21.21, "lng": 106.21, "label": "Neo"}

    async def canonical(self, q, loc, ids, limit):
        self.calls.append("places")
        if self.empty:
            return [], False

        def p(i, name, area=1, verified=True):
            return {
                "place_id": i,
                "canonical_name": name,
                "canonical_category": "restaurant",
                "admin_unit_id": area,
                "address": "Neo, Yên Dũng",
                "lat": 21.21,
                "lon": 106.21 if area == 1 else 108.0,
                "specialties": ["giò chả"] if name.startswith("Giò chả") else [],
                "confidence": 0.9,
                "last_verified_at": "2026-01-01T00:00:00Z" if verified else None,
                "verification_level": "corroborated" if verified else "observed",
                "verification_method": "multi_source" if verified else None,
            }

        return [
            p(1, "Giò chả A"),
            p(2, "Giò chả B"),
            p(3, "Giò chả xa", 2),
            p(4, "Cơm bình dân"),
            p(5, "Giò chả C", verified=False),
        ], False

    async def web(self, q, mode, limit):
        self.calls.append("web")
        if self.fail:
            raise OSError("provider unavailable")
        return [
            {
                "source_id": "s1",
                "url": "https://example.org/legal",
                "title": "Document",
                "description": "Evidence from fixture.",
            }
        ], False

    async def corpus(self, q, mode, limit):
        self.calls.append("corpus")
        return [], False

    async def finish_documents(self, q, lanes, mode, limit, read):
        self.calls.append("reader" if read else "rank")
        return [r for lane in lanes for r in lane][:limit]


def client_for(services):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_api_key] = lambda: None
    app.dependency_overrides[retrieval_service] = lambda: UnifiedRetriever(
        services, deadline_ms=200
    )
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def test_one_brain_contract_and_no_fanout():
    async def check():
        s = Services()
        async with client_for(s) as c:
            r = await c.post("/v1/retrieve", json={"query": "quán giò chả Yên Dũng"})
        assert r.status_code == 200
        d = r.json()
        assert d["contract_version"] == "1"
        assert len(d["places"]["exact"]) == 2
        assert [p["id"] for p in d["places"]["related"]] == ["4"]
        assert [p["id"] for p in d["places"]["unverified"]] == ["5"]
        assert s.calls == ["places"]
        assert d["budget"]["name"] == "fast"
        assert d["understanding"]["transition"]["to"] == ["Neo"]
        return d

    result = asyncio.run(check())
    # Shared artifact is decoded by the TypeScript adapter in scripts/test-core-port.ts.
    target = (
        Path(__file__).resolve().parents[3] / "reports" / "core-contract-fixture.json"
    )
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


def test_widening_does_not_invent_places():
    async def check():
        s = Services(empty=True)
        async with client_for(s) as c:
            r = await c.post(
                "/v1/retrieve",
                json={"query": "quán giò chả Yên Dũng", "evidence": "off"},
            )
        d = r.json()
        assert d["places"]["exact"] == []
        assert d["coverage"]["gap"] is True
        assert d["coverage"]["widened"] is True
        assert "web" in s.calls and "corpus" in s.calls
        assert "reader" not in s.calls
        assert d["docs"]

    asyncio.run(check())


def test_general_and_provider_failure():
    async def check():
        s = Services(empty=True, fail=True)
        async with client_for(s) as c:
            d = (
                await c.post(
                    "/v1/retrieve", json={"query": "nghị định hóa đơn điện tử"}
                )
            ).json()
        assert "places" not in s.calls
        assert d["understanding"]["intent"] == "legal"
        assert any(f["status"] == "error" for f in d["federation"])
        assert d["quality"]["coverage"] == "none"

    asyncio.run(check())


def test_invalid_requests_and_max_results():
    async def check():
        async with client_for(Services()) as c:
            for body in (
                {"query": " "},
                {"query": "q", "max_results": 100},
                {"query": "q", "location": {"lat": 91, "lng": 0}},
                {"query": "q", "mode": "fake"},
                {"query": "q", "contract_version": "2"},
            ):
                assert (await c.post("/v1/retrieve", json=body)).status_code == 422
            d = (
                await c.post(
                    "/v1/retrieve", json={"query": "giò chả Yên Dũng", "max_results": 1}
                )
            ).json()
            assert len(d["places"]["exact"]) + len(d["places"]["unverified"]) <= 1

    asyncio.run(check())


def test_provider_timeout_returns_bounded_result():
    class Slow(Services):
        async def web(self, *args):
            await asyncio.sleep(2)
            return [], False

    async def check():
        async with client_for(Slow(empty=True)) as c:
            d = (
                await c.post("/v1/retrieve", json={"query": "giò chả Yên Dũng"})
            ).json()
        assert d["timings"]["total_ms"] < 700
        assert any(f["status"] == "timeout" for f in d["federation"])

    asyncio.run(check())


def test_main_mount_and_scope():
    import main
    from security.apikeys import required_scope

    assert "/v1/retrieve" in main.app.openapi()["paths"]
    assert required_scope("/v1/retrieve", "POST") == "search:read"
    main.app.dependency_overrides[retrieval_service] = lambda: UnifiedRetriever(
        Services()
    )

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/retrieve", json={"query": "giò chả Yên Dũng"}
            )
            assert response.status_code == 200
            assert response.json()["backend"] == "search-router"

    try:
        asyncio.run(check())
    finally:
        main.app.dependency_overrides.pop(retrieval_service, None)

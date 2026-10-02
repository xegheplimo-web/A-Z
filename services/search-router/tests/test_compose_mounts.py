"""Production Compose contract for the first-class retrieval brain."""

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE_FILE = REPO_ROOT / "docker-compose.yml"
PRODUCTION_FILE = REPO_ROOT / "docker-compose.production.yml"


def _load(path: Path) -> dict:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict), f"{path} did not parse to a mapping"
    assert isinstance(value.get("services"), dict), f"{path} defines no services"
    return value


def _env(service: dict) -> dict[str, str]:
    raw = service.get("environment") or {}
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    out: dict[str, str] = {}
    for item in raw:
        key, _, value = str(item).partition("=")
        out[key] = value
    return out


def test_embedded_base_and_production_brain_are_explicit():
    base = _load(BASE_FILE)["services"]
    prod = _load(PRODUCTION_FILE)["services"]

    assert "embedded" in _env(base["app"])["RETRIEVAL_BACKEND"]
    app_env = _env(prod["app"])
    assert app_env["RETRIEVAL_BACKEND"] == "search-router"
    assert app_env["RETRIEVAL_FALLBACK"] == ""
    assert app_env["SEARCH_ROUTER_URL"] == "http://search-router:8888"
    assert prod["app"]["depends_on"]["search-router"]["condition"] == "service_healthy"


def test_production_router_wires_real_dependencies():
    services = _load(PRODUCTION_FILE)["services"]
    router = services["search-router"]
    assert router["profiles"] == ["production"]
    assert router["build"]["context"] == "./services/search-router"

    required = {"search-db", "redis", "opensearch", "qdrant", "searxng"}
    assert required <= set(router["depends_on"])
    for dependency in required:
        assert router["depends_on"][dependency]["condition"] == "service_healthy"

    env = _env(router)
    assert env["HUB_DATABASE_URL"].startswith("postgresql://searchhub:")
    assert env["REDIS_URL"].startswith("redis://redis:")
    assert env["SEARXNG_URL"] == "http://searxng:8080"
    assert env["OPENSEARCH_ENABLED"] == "true"
    assert env["OPENSEARCH_HOST"] == "opensearch"
    assert env["QDRANT_ENABLED"] == "true"
    assert env["QDRANT_URL"] == "http://qdrant:6333"


def test_production_images_are_pinned_and_bind_mounts_exist():
    services = _load(PRODUCTION_FILE)["services"]
    for name in ("search-db", "redis", "opensearch", "qdrant", "searxng"):
        image = services[name]["image"]
        assert ":" in image and not image.endswith(":latest"), f"{name} image must be pinned"

    for name, service in services.items():
        for mount in service.get("volumes") or []:
            if not isinstance(mount, str) or not mount.startswith("."):
                continue
            source = mount.split(":", 1)[0]
            assert (REPO_ROOT / source).exists(), f"missing bind source: {name}: {source}"


def test_facade_database_and_brain_database_are_separate():
    """Embedded tables must not collide with search-router PostGIS schemas."""
    prod = _load(PRODUCTION_FILE)["services"]
    app_dsn = _env(prod["app"])["DATABASE_URL"]
    brain_dsn = _env(prod["search-router"])["HUB_DATABASE_URL"]
    assert "@db:" in app_dsn and app_dsn.endswith("/app_db")
    assert "@search-db:" in brain_dsn and brain_dsn.endswith("/searchhub")

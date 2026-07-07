"""CE_MODE deny-by-default route-table tests — the security posture's regression guard.

CE_MODE mounts ONLY the /api facade surface (the Phase 1 allowlist as far as
this PR implements it). Everything else — mosaic, semantic search, unprefixed
engine routers, auth/jobs scaffolds — must be absent. Non-CE mode must keep
serving today's full route set (the .NET tier depends on it).

main.py builds the app at import time, so these tests reload it under a
patched environment.
"""

import importlib
import os
from unittest import mock


def load_app(ce_mode: str | None):
    env = dict(os.environ)
    env.pop("CE_MODE", None)
    if ce_mode is not None:
        env["CE_MODE"] = ce_mode
    with mock.patch.dict(os.environ, env, clear=True):
        import main

        importlib.reload(main)
        return main.app


def teardown_module():
    """Restore the module-level app for other test files."""
    import main

    importlib.reload(main)


def paths(app) -> set[str]:
    # FastAPI ≥0.139 defers include_router (routes sit inside _IncludedRouter
    # wrappers), so app.routes doesn't flatten; the OpenAPI schema does.
    return set(app.openapi()["paths"].keys())


# The /api surface this PR implements (grows in later Phase 2 PRs, and the
# allowlist doc is the target end state).
CE_API_SURFACE = {
    "/api/health",
    "/api/discovery/featured",
    "/api/discovery/suggest-recipes",
    "/api/jwstdata",
    "/api/jwstdata/{data_id}/thumbnail",
    "/api/jwstdata/check-availability",
}

# Bare @app render routes defined in main.py. They remain registered in CE
# (module-level decorators) but are NOT part of the /api surface and are
# unreachable through the CE nginx proxy, which forwards /api/* only.
# Folding them behind CE_MODE is tracked for the next Phase 2 PR.
ENGINE_INTERNAL = {
    "/",
    "/health",
    "/thumbnail",
    "/preview/{data_id}",
    "/histogram/{data_id}",
    "/pixeldata/{data_id}",
    "/cubeinfo/{data_id}",
}


class TestCeMode:
    def test_api_surface_is_exactly_the_allowlist(self):
        app = load_app("true")
        api_paths = {p for p in paths(app) if p.startswith("/api")}
        assert api_paths == CE_API_SURFACE

    def test_denied_routers_not_mounted(self):
        app = load_app("true")
        p = paths(app)
        for denied in (
            "/composite/generate-nchannel",
            "/composite/generate-nchannel-stream",
            "/mosaic/generate",
            "/semantic/search",
            "/discovery/suggest-recipes",  # unprefixed engine route
        ):
            assert denied not in p, f"{denied} must not mount in CE_MODE"

    def test_no_unexpected_routes_outside_api(self):
        app = load_app("true")
        non_api = {p for p in paths(app) if not p.startswith("/api")}
        assert non_api <= ENGINE_INTERNAL, f"unexpected non-api routes: {non_api - ENGINE_INTERNAL}"


class TestCeBareRouteGuard:
    def test_bare_render_routes_404_in_ce(self):
        """The module-level render routes stay registered (decorators) but
        must refuse to answer in CE — they take raw file paths with no
        IsPublic gate."""
        from fastapi.testclient import TestClient

        app = load_app("true")
        client = TestClient(app)
        assert client.get("/preview/abc123").status_code == 404
        assert client.get("/pixeldata/abc123").status_code == 404
        assert client.get("/cubeinfo/abc123").status_code == 404
        assert client.get("/histogram/abc123").status_code == 404
        assert client.post("/thumbnail", json={"file_path": "x.fits"}).status_code == 404


class TestNonCeMode:
    def test_legacy_surface_unchanged(self):
        app = load_app(None)
        p = paths(app)
        for legacy in (
            "/composite/generate-nchannel",
            "/mosaic/generate",
            "/discovery/suggest-recipes",
            "/preview/{data_id}",
            "/health",
        ):
            assert legacy in p, f"{legacy} missing in non-CE mode"

    def test_api_facade_also_available_in_dev(self):
        # additive: the facade mounts in dev too, so it can be exercised
        # against the full stack before the CE cutover
        app = load_app(None)
        assert paths(app) >= CE_API_SURFACE

    def test_ce_mode_falsy_values(self):
        for v in ("0", "false", "", "no"):
            app = load_app(v)
            assert "/composite/generate-nchannel" in paths(app), f"CE_MODE={v!r} must be off"

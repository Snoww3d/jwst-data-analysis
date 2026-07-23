import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.analysis.api_routes import router as analysis_api_router
from app.analysis.routes import router as analysis_router
from app.auth.routes import router as auth_router
from app.composite.api_routes import router as composite_api_router
from app.composite.routes import router as composite_router
from app.db.client import MongoNotConfiguredError, get_database
from app.discovery.api_routes import router as discovery_api_router
from app.discovery.routes import router as discovery_router
from app.exceptions import (
    ProcessingEngineError,
    generic_error_handler,
    processing_engine_error_handler,
    register_api_error_shim,
)
from app.jobs.routes import router as jobs_router
from app.library.routes import router as library_router
from app.mast.api_routes import router as mast_api_router
from app.mosaic.routes import router as mosaic_router
from app.render.routes import router as render_router
from app.semantic.routes import router as semantic_router


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # v1 jobs don't survive restarts; anything still "active" from a previous
    # process is dead. Resume-on-restart is a tracked follow-up. Jobs are
    # full-mode-only, so CE skips reconciliation entirely.
    if os.environ.get("CE_MODE", "").strip().lower() not in {"1", "true", "yes"}:
        from app.jobs.store import COLLECTION_NAME, JobStore

        try:
            store = JobStore(get_database()[COLLECTION_NAME])
            count = await store.reconcile_interrupted()
            if count:
                logger.warning("Marked %d interrupted job(s) as failed after restart", count)
        except MongoNotConfiguredError:
            logger.info("Job reconciliation skipped: MongoDB not configured")
        except Exception:
            logger.exception("Job reconciliation failed (continuing startup)")
    yield


app = FastAPI(title="JWST Data Processing Engine", version="1.0.0", lifespan=_lifespan)

# Exception handlers — domain exceptions become structured JSON responses
app.add_exception_handler(ProcessingEngineError, processing_engine_error_handler)
app.add_exception_handler(Exception, generic_error_handler)

# /api/* error bodies carry both `error` (.NET parity — the frontend's
# ApiError parser reads it) and `detail` (FastAPI convention)
register_api_error_shim(app)

# Community Edition mode: deny-by-default route mounting (ADR 0001 / CE plan).
# When CE_MODE is truthy, ONLY the /api facade surface mounts — no mosaic, no
# semantic search, no unprefixed engine routers, and the auth/jobs scaffolds
# never mount. The route-table test (tests/test_ce_mode_mounting.py) is the
# regression guard for this block.
CE_MODE = os.environ.get("CE_MODE", "").strip().lower() in {"1", "true", "yes"}

if CE_MODE:
    app.include_router(library_router)  # /api/jwstdata reads only
    app.include_router(discovery_api_router)  # /api/discovery facade
    app.include_router(mast_api_router)  # /api/mast search facade (no import/download)
    app.include_router(composite_api_router)  # /api/composite sync render facade
    app.include_router(analysis_api_router)  # /api/analysis reads (table/spectral)

    # True default-deny: any request outside /api/* (plus bare liveness for
    # container healthchecks) is 404'd BEFORE routing/validation. This covers
    # the module-level render routes — which register regardless of CE_MODE —
    # and anything added in the future, uniformly.
    from fastapi.responses import JSONResponse as _JSONResponse

    @app.middleware("http")
    async def ce_deny_non_api(request, call_next):
        path = request.url.path
        if path not in ("/", "/health") and not path.startswith("/api/"):
            # note: also blocks /docs and /openapi.json — CE does not expose
            # interactive API docs publicly
            return _JSONResponse({"detail": "Not Found"}, status_code=404)
        return await call_next(request)

else:
    # Frontend calls the engine directly for /api/jobs (+ upcoming
    # /api/calibration) — cross-origin from the Vite dev server / app host,
    # so CORS is required here. CE is same-origin behind nginx and the .NET
    # gateway proxies everything else, hence full-mode-only.
    from fastapi.middleware.cors import CORSMiddleware as _CORSMiddleware

    _cors_origins = [
        origin.strip()
        for origin in os.environ.get(
            "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"
        ).split(",")
        if origin.strip()
    ]
    # Never set CORS_ALLOWED_ORIGINS to "*": with allow_credentials=True,
    # Starlette would echo any origin back — credentialed wildcard CORS.
    app.add_middleware(
        _CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Full engine surface (the .NET gateway depends on these routes)
    app.include_router(composite_router)
    app.include_router(mosaic_router)
    app.include_router(analysis_router)
    app.include_router(discovery_router)
    app.include_router(semantic_router)
    app.include_router(render_router)  # thumbnail/preview/histogram/pixeldata/cubeinfo

    # Single-backend migration scaffolding (ADR 0001). auth/jobs are empty
    # until their phases land; library now carries the CE read endpoints,
    # mounted in dev too so they can be exercised against the full stack.
    app.include_router(auth_router)
    app.include_router(library_router)
    app.include_router(jobs_router)
    app.include_router(discovery_api_router)
    app.include_router(mast_api_router)
    app.include_router(composite_api_router)
    app.include_router(analysis_api_router)


@app.get("/")
async def root():
    return {"message": "JWST Data Processing Engine", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "jwst-processing-engine"}


@app.get("/api/health")
async def api_health_check():
    """Aggregated health in the .NET HealthChecks response shape.

    In the CE topology the engine IS the backend, so the .NET version's two
    proxy checks collapse to engine liveness + a MongoDB ping. The frontend
    MastStatusPill polls this endpoint.
    """
    checks = [
        {
            "name": "processing_engine",
            "status": "Healthy",
            "description": "Processing engine is reachable",
        }
    ]
    mongo = {"name": "mongodb", "status": "Healthy", "description": "MongoDB ping ok"}
    try:
        await get_database().command("ping")
    except MongoNotConfiguredError:
        mongo = {
            "name": "mongodb",
            "status": "Unhealthy",
            "description": "MONGODB_URI is not configured",
        }
    except Exception as exc:  # noqa: BLE001 -- health endpoints must degrade, never raise
        mongo = {"name": "mongodb", "status": "Unhealthy", "description": str(exc)}
    checks.append(mongo)
    overall = "Healthy" if all(c["status"] == "Healthy" for c in checks) else "Unhealthy"
    return {"status": overall, "checks": checks}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

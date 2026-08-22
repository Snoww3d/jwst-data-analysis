# Setup Guide

## Prerequisites

- **Docker** and **Docker Compose** (recommended — runs everything with one command)
- **Git** (for cloning and version control)

For local development outside Docker, you'll also need:

- **.NET 10 SDK** (backend)
- **Node.js 22+** (frontend)
- **Python 3.10+** (processing engine)

## Quick Start with Docker

### 1. Clone and Configure

```bash
git clone <repository-url>
cd Astronomy
cd docker
cp .env.example .env    # Copy env template (edit if needed)
```text

The default `.env` values work for local development. See [Environment Variables](#environment-variables) below for what's configurable.

### 2. Start All Services

```bash
docker compose up -d
```tsx

This starts five services:

| Service           | Container         | URL                     | Purpose                            |
| ----------------- | ----------------- | ----------------------- | ---------------------------------- |
| Frontend          | `jwst-frontend`   | <http://localhost:3000> | React UI                           |
| Backend API       | `jwst-backend`    | <http://localhost:5001> | .NET 10 REST API                   |
| Processing Engine | `jwst-processing` | <http://localhost:8000> | Python FastAPI for FITS processing |
| MongoDB           | `jwst-mongodb`    | `localhost:27017`       | Database                           |
| Documentation     | `jwst-docs`       | <http://localhost:8001> | MkDocs project documentation       |

### 3. Log In

The application seeds two default users on first startup:

| Username   | Password    | Role   |
| ---------- | ----------- | ------ |
| `admin`    | `Admin123!` | Admin  |
| `demo`     | `Demo1234!` | User   |

Open <http://localhost:3000> and log in with either account. You can also register new accounts from the login page.

### 4. Verify Everything Works

```bash
# Check all containers are running
docker compose ps

# Test backend API
curl http://localhost:5001/api/jwstdata

# Test processing engine health
curl http://localhost:8000/health

# View logs
docker compose logs -f
```text

### 5. Install Git Hooks (Recommended)

```bash
cd ..    # Back to repo root
./scripts/setup-hooks.sh
```bash

This installs a pre-push hook that blocks accidental direct pushes to `main`, enforcing the PR workflow.

## Service Details

### Backend API (.NET 10)

- **Swagger UI**: <http://localhost:5001/swagger> — interactive API documentation
- **Authentication**: JWT Bearer tokens (access token: 15min, refresh token: 7 days)
- **Rate Limiting**: 300 requests/min general, 30/min for MAST imports, 10/min for processing
- **File Upload Limits**: 100MB max, allowed extensions: `.fits`, `.fits.gz`, `.jpg`, `.png`, `.tiff`, `.csv`, `.json`

### Frontend (React + TypeScript + Vite)

The frontend uses a centralized service layer for all API calls:

| Service               | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `apiClient.ts`        | Core HTTP client with JWT auth and error handling |
| `jwstDataService.ts`  | JWST data CRUD operations                         |
| `mastService.ts`      | MAST search and import                            |
| `compositeService.ts` | RGB composite generation                          |
| `mosaicService.ts`    | WCS mosaic generation and footprint               |
| `analysisService.ts`  | Region statistics computation                     |
| `authService.ts`      | Login, register, token refresh                    |

All services are in `frontend/jwst-frontend/src/services/`.

### Processing Engine (Python FastAPI)

- **API Docs**: <http://localhost:8000/docs> — auto-generated FastAPI docs
- **Health Check**: `GET /health`
- **Resource Limits** (DoS protection, configurable via env vars):
  - Max FITS file size: 10GB (`MAX_FITS_FILE_SIZE_MB`)
  - Max array elements: 200M pixels (`MAX_FITS_ARRAY_ELEMENTS`)
  - Max mosaic output: 64M pixels (`MAX_MOSAIC_OUTPUT_PIXELS`)

#### Calibration Recipes (#1709)

The engine can run the official STScI `jwst` calibration pipeline. The ~2GB
`jwst` layer is installed via the Docker build arg `INSTALL_CALIBRATION` (default
`true`; Community Edition builds pass `false`). Runtime is gated by
`CALIBRATION_ENABLED`.

- **First-run slowness**: the first calibration run for a given instrument
  lazily downloads CRDS reference files (several GB) into the `CRDS_PATH` volume
  (`/app/data/crds`). This is a one-time cost per instrument context — do not
  delete the CRDS volume casually.
- **Runs are heavy**: `MAX_CONCURRENT_CALIBRATIONS` (default 1) bounds memory;
  full raw-data reductions download real MAST data and can take hours.
- The frontend calls the engine directly for calibration. In Docker,
  `VITE_ENGINE_URL` is empty so the browser requests `/api/calibration` and
  `/api/jobs` on the page's own origin and the Vite dev server forwards them to
  `ENGINE_PROXY_TARGET` (`http://processing-engine:8000`). Leave it empty unless
  you specifically want the browser to reach the engine directly, in which case
  the engine's `CORS_ALLOWED_ORIGINS` must list the browser's origin.
- **Running Vite on the host** (`npm run dev` instead of Docker): `VITE_ENGINE_URL`
  is unset there, so the bundle falls back to `http://localhost:8000` and the
  proxy is never used. That is fine on your own machine, but to use the proxy
  path — and it is required for LAN testing — export `VITE_ENGINE_URL=` (empty)
  and `ENGINE_PROXY_TARGET=http://localhost:8000` before starting Vite.
- **Production**: production and staging images have no engine proxy —
  `nginx-ssl.conf` sends all of `/api` to the .NET gateway — and
  `VITE_ENGINE_URL` is not a build arg, so deployed bundles still point at
  `http://localhost:8000` and calibration is effectively unavailable there.
  Do **not** "fix" this by setting `VITE_ENGINE_URL=""` in a production build:
  `/api/calibration/*` would 404 and `/api/jobs/*` would hit the .NET job store
  instead of the engine's. Wiring calibration for production is tracked
  separately.

##### Testing from a phone or another machine

The engine leg needs no changes — it is reached same-origin through the proxy,
so no LAN IP is baked into the bundle. The **backend** leg does, because
`VITE_API_URL` is an absolute URL compiled into the bundle. All four steps are
required.

1. Publish the frontend and backend on `0.0.0.0` instead of `127.0.0.1`. Add a
   `docker/docker-compose.lan.yml` — `!override` (Compose v2.24+) replaces the
   base port list rather than appending to it, which would leave the original
   `127.0.0.1` bind in place and fail with "address already in use". Note the
   backend's *container* port is 8080, not 5001:

    ```yaml
    services:
      frontend:
        ports: !override
          - "0.0.0.0:3000:3000"
      backend:
        ports: !override
          - "0.0.0.0:5001:8080"
    ```

2. In `docker/.env`, set `VITE_API_URL=http://<your-lan-ip>:5001`.
3. In `docker/.env`, append your LAN origin to `CORS_ALLOWED_ORIGINS` —
   **keep the existing four entries**, since this one variable is shared by
   both the .NET backend and the engine, and replacing it wholesale breaks
   local development for both:
   `http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,http://<your-lan-ip>:3000`
4. Leave `VITE_ENGINE_URL` empty. If your existing `docker/.env` sets it to an
   absolute URL such as `http://localhost:8000`, blank it — it overrides the
   compose default and reintroduces the bug: the phone resolves `localhost` to
   itself, `getCapabilities()` fails, and calibration silently disables itself
   with no visible error beyond a console warning.

Then start the stack, naming **all three** files. Compose only auto-loads
`docker-compose.override.yml` when no `-f` flag is given, so omitting it here
would silently drop the frontend bind mount (no hot reload), the published
engine port and the dev-only backend settings:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml \
  -f docker-compose.lan.yml up -d
```

Then browse to `http://<your-lan-ip>:3000`.

### Documentation (MkDocs)

Project documentation is served at <http://localhost:8001>. It includes architecture docs, development plan, tech debt tracking, coding standards, and more. The docs auto-reload when you edit files in the `docs/` directory.

## Environment Variables

All configuration lives in `docker/.env` (copied from `.env.example`). Key settings:

```env
# MongoDB
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=changeme_use_strong_password
MONGO_DATABASE=jwst_data_analysis

# Backend
ASPNETCORE_ENVIRONMENT=Development
# Shared by the .NET backend and the engine. Must not contain "*" — the engine
# allows credentialed requests and rejects a wildcard at startup.
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173
JWT_SECRET_KEY=CHANGE_THIS_IN_PRODUCTION_MIN_32_CHARS_SECURE_KEY_HERE  # REQUIRED for production

# Frontend
VITE_API_URL=http://localhost:5001

# Processing Engine
MAST_DOWNLOAD_DIR=/app/data/mast
MAST_DOWNLOAD_TIMEOUT=3600

# MAST download cache — opt-in LRU eviction (disabled by default)
MAST_CACHE_ENABLED=false
MAST_CACHE_MAX_BYTES=64424509440
MAST_CACHE_DRY_RUN=false
# MAST_CACHE_PIN_MANIFEST=/app/data/pinned-files.txt

# Calibration Recipes (#1709)
CALIBRATION_ENABLED=true
MAX_CONCURRENT_CALIBRATIONS=1
CALIBRATION_TIMEOUT_S=14400
CALIBRATION_HEARTBEAT_S=30
CRDS_SERVER_URL=https://jwst-crds.stsci.edu
# Empty = same-origin engine calls via the Vite proxy (works over LAN too)
VITE_ENGINE_URL=
ENGINE_PROXY_TARGET=http://processing-engine:8000
```

The `.env` file is gitignored and should never be committed. Default values in `docker-compose.yml` work for local development if `.env` is missing.

For production deployment (TLS, strong passwords, etc.), see the comments in `.env.example`.

## Local Development (Without Docker)

If you prefer running services directly on your machine:

### Backend

```bash
cd backend
dotnet restore JwstDataAnalysis.sln
dotnet build JwstDataAnalysis.sln
cd JwstDataAnalysis.API
dotnet run                    # Runs on http://localhost:5001
```text

Requires a local MongoDB instance. Update `appsettings.json` connection string if needed.

### Frontend

```bash
cd frontend/jwst-frontend
npm install
npm run dev                   # Runs on http://localhost:3000
```text

### Processing Engine

```bash
cd processing-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt      # runtime only
# To run tests/linters locally, install the dev toolchain instead (pytest, ruff,
# mypy, …) — it includes requirements.txt:  pip install -r requirements-dev.txt
uvicorn main:app --reload     # Runs on http://localhost:8000
```text

## Code Quality Tools

### Frontend

```bash
cd frontend/jwst-frontend
npm run lint          # ESLint
npm run lint:fix      # Auto-fix lint issues
npm run format        # Prettier formatting
npm run format:check  # Check formatting
```text

### Backend

```bash
cd backend
dotnet build JwstDataAnalysis.sln    # Analyzers run during build
dotnet format                         # Auto-format
```text

### Processing Engine

```bash
cd processing-engine
ruff check .          # Lint
ruff check --fix .    # Auto-fix
ruff format .         # Format
```text

## Running Tests

### Backend (.NET)

```bash
dotnet test backend/JwstDataAnalysis.API.Tests --verbosity normal
```text

### Frontend

```bash
cd frontend/jwst-frontend
npm run test              # Unit tests (Vitest)
npm run test:coverage     # Unit tests with coverage
npm run test:e2e          # E2E tests (Playwright, requires backend running)
```text

### Processing Engine

Run via Docker (recommended — local macOS Python may be too old):

```bash
docker exec jwst-processing python -m pytest
```text

## Common Docker Commands

```bash
# Start / stop
docker compose up -d
docker compose down

# Rebuild after code changes
docker compose up -d --build

# View logs (all services)
docker compose logs -f

# View logs (single service)
docker logs jwst-backend
docker logs jwst-frontend
docker logs jwst-processing
docker logs jwst-mongodb
docker logs jwst-docs

# Reset database (removes all data)
docker compose down -v
```text

## Troubleshooting

**Port already in use**

```bash
lsof -i :5001    # Find what's using the port
kill <PID>        # Kill it
```

**MongoDB connection issues**

- Check `docker compose ps` — is `jwst-mongodb` running?
- If you changed `MONGO_ROOT_PASSWORD` after initial setup, you need to remove the volume: `docker compose down -v` (this deletes all data)

**CORS errors in browser**

- Verify `CORS_ALLOWED_ORIGINS` in `.env` includes your frontend URL
- Default allows `http://localhost:3000` and `http://localhost:5173`

**Frontend not loading**

- The frontend service is defined in `docker-compose.yml` with development overrides in `docker-compose.override.yml` (auto-loaded in dev)
- Check `docker logs jwst-frontend` for build errors

**Processing engine errors**

- Files exceeding resource limits return HTTP 413 — check the limits in [Processing Engine](#processing-engine-python-fastapi)
- MAST download timeouts default to 3600s (1 hour) — increase `MAST_DOWNLOAD_TIMEOUT` if needed
- `MAST_DOWNLOAD_DIR` is unbounded by default. Set `MAST_CACHE_ENABLED=true` to cap it at
  `MAST_CACHE_MAX_BYTES` (default 60 GiB): after each completed download, least-recently-accessed
  FITS are evicted until the directory is back within budget. Evicted files are re-downloadable
  from MAST. `.download_state/`, `.part` files, in-flight downloads, and files listed in
  `MAST_CACHE_PIN_MANIFEST` are never evicted.

### Enabling the MAST cache safely

The first real eviction pass on a large existing directory can free hundreds of gigabytes in
one go. Always dry-run first.

1. Set `MAST_CACHE_ENABLED=true` and `MAST_CACHE_DRY_RUN=true` in `docker/.env`.
2. Set `MAST_CACHE_PIN_MANIFEST` if any files must never be evicted.
3. Recreate the engine container: `docker compose up -d processing-engine`.
4. Confirm the startup log line reads `MAST cache is ENABLED in DRY RUN mode`.
5. Complete one download from the MAST Search tab.
6. Read the plan: `docker compose logs processing-engine | grep "WOULD EVICT"`.
   Each line names one file, its size, and the running total freed.
7. Check the summary line. It reports the file count, total bytes, and the resulting
   cache size against the budget.
8. Confirm nothing you need appears in the plan. Widen `MAST_CACHE_MAX_BYTES` or add
   entries to the pin manifest if it does, then repeat from step 5.
9. Only once the plan looks correct, set `MAST_CACHE_DRY_RUN=false` and recreate the
   container again.

Pin manifest entries are paths relative to the **data root** — the parent of
`MAST_DOWNLOAD_DIR` — so they read `mast/<observation>/<file>_i2d.fits`. This is the same
base `scripts/seed-ce.sh` uses with `rsync --files-from`. Entries that resolve outside the
download directory are logged as protecting nothing. If the manifest is configured but
cannot be read, eviction is skipped entirely rather than run with nothing pinned.

## Next Steps

1. **Search MAST** — Use the MAST Search tab to find and import JWST observations
2. **View FITS data** — Open imported observations in the interactive FITS viewer
3. **Explore the API** — Browse endpoints at <http://localhost:5001/swagger>
4. **Read the docs** — Architecture, development plan, and standards at <http://localhost:8001>
5. **Review the development plan** — See `docs/development-plan.md` for roadmap and current phase

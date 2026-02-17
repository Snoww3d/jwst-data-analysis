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
  - Max FITS file size: 4GB (`MAX_FITS_FILE_SIZE_MB`, 2GB for mosaic inputs)
  - Max array elements: 200M pixels (`MAX_FITS_ARRAY_ELEMENTS`)
  - Max mosaic output: 64M pixels (`MAX_MOSAIC_OUTPUT_PIXELS`)

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
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Frontend
VITE_API_URL=http://localhost:5001

# Processing Engine
MAST_DOWNLOAD_DIR=/app/data/mast
MAST_DOWNLOAD_TIMEOUT=3600
```text

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
pip install -r requirements.txt
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

- The frontend container is defined in `docker-compose.override.yml` (auto-loaded in dev)
- Check `docker logs jwst-frontend` for build errors

**Processing engine errors**

- Files exceeding resource limits return HTTP 413 — check the limits in [Processing Engine](#processing-engine-python-fastapi)
- MAST download timeouts default to 3600s (1 hour) — increase `MAST_DOWNLOAD_TIMEOUT` if needed

## Next Steps

1. **Search MAST** — Use the MAST Search tab to find and import JWST observations
2. **View FITS data** — Open imported observations in the interactive FITS viewer
3. **Explore the API** — Browse endpoints at <http://localhost:5001/swagger>
4. **Read the docs** — Architecture, development plan, and standards at <http://localhost:8001>
5. **Review the development plan** — See `docs/development-plan.md` for roadmap and current phase

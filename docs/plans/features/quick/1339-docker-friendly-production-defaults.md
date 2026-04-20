# Plan: Docker-friendly defaults in appsettings.Production.json

**Issue**: #1339
**Complexity**: Quick (config files + env doc)

## Problem

`appsettings.json` hardcodes `ProcessingEngine.BaseUrl=http://localhost:8000` and `MastProxy.BaseUrl=http://localhost:8000`. These defaults work for `dotnet run` on a dev host but not for containerised deploys where services reach each other via service names.

Today, `docker/docker-compose.yml` injects `ProcessingEngine__BaseUrl` and `MastProxy__BaseUrl` env vars to override the defaults. That works for the Compose path but:

- `appsettings.Production.json` is an empty `Seeding.Enabled=false` and inherits the localhost defaults from `appsettings.json`.
- A Kubernetes / bare-Docker / non-Compose deploy has no override source and silently targets localhost.
- `.env.example` documents `ASPNETCORE_ENVIRONMENT` but not the service URL override vars.

Blocks the CE deploy plan (VPS + Docker Compose) because the setup invites silent misconfiguration on first deploy.

## Fix

Two small config changes — no .NET code change required.

1. `appsettings.Production.json`: set `ProcessingEngine.BaseUrl`, `MastProxy.BaseUrl`, and `MongoDB.ConnectionString` to the Docker service names (`processing-engine`, `mast-proxy`, `mongodb`). Production deployments become self-sufficient — set `ASPNETCORE_ENVIRONMENT=Production` and the API wires itself to the neighbouring containers without additional env vars.
2. `docker/.env.example`: annotate `ASPNETCORE_ENVIRONMENT` with what each mode selects and document the `ProcessingEngine__BaseUrl` / `MastProxy__BaseUrl` override syntax for deploys that need different addresses (e.g. Kubernetes with custom service names).

## Files Changed

| File | Change |
|------|--------|
| `backend/JwstDataAnalysis.API/appsettings.Production.json` | Add `ProcessingEngine`, `MastProxy`, `MongoDB` sections with Docker service name defaults |
| `docker/.env.example` | Annotate `ASPNETCORE_ENVIRONMENT` modes; document `ProcessingEngine__BaseUrl` / `MastProxy__BaseUrl` override vars |

## Verification

- `dotnet build` — Production.json parses as valid JSON.
- Unit tests pass (no code changed; this is config-only).
- Local `docker compose up -d` still works because Compose env vars keep overriding — env var precedence is unchanged.
- Production-mode verification: `ASPNETCORE_ENVIRONMENT=Production` with no `ProcessingEngine__BaseUrl` override — app logs should show `Processing engine at http://processing-engine:8000` on first outbound call.

## Risk

- Risk: Low. Config-only, only affects Production environment. Development remains on localhost defaults. Env-var overrides still take precedence (ASP.NET config priority: env vars > appsettings.{Env}.json > appsettings.json), so existing Compose deploys are unaffected.
- Rollback: `git revert`. Services revert to inheriting localhost from `appsettings.json`, which is the current state.

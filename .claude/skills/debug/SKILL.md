---
name: debug
description: Full-stack debugging approach for the JWST application — traces issues through frontend, backend API, processing engine, and MongoDB. Use this skill when investigating errors (401s, 500s, download failures, rendering issues), debugging unexpected behavior, or when the user reports something broken. Also triggers on "debug this", "why is this failing", "trace this error", "investigate this bug".
---

# Full-Stack Debugging

The JWST app has four layers. Errors often manifest in one layer but originate in another. Trace through the full stack — don't stop at the first layer.

## Architecture

```
Frontend (:3000) → Backend API (:5001) → MongoDB (:27017)
                                       → Processing Engine (:8000) → MAST Portal (STScI)
```

## Debugging Protocol

### 1. Check Server Logs First

Before suggesting the user troubleshoot manually, check logs and existing code:

```bash
docker compose -f docker/docker-compose.yml logs --tail=50 backend    # .NET API
docker compose -f docker/docker-compose.yml logs --tail=50 processing # Python FastAPI
docker compose -f docker/docker-compose.yml logs --tail=50 frontend   # Vite dev server
```

### 2. Trace the Request Path

| Symptom | Start here | Then check |
|---------|-----------|------------|
| 401/403 errors | Backend auth middleware → AuthController | Frontend AuthContext, token refresh |
| Download failures | Processing engine MAST client | Backend proxy endpoints, CORS |
| Rendering issues | Frontend component → browser console | Backend API response shape |
| Slow responses | Processing engine logs (timing) | Backend async operations |
| Data missing | MongoDB queries in MongoDBService | Backend DTO mapping (snake_case ↔ camelCase) |

### 3. Common Gotchas

- **JSON casing mismatch**: Backend uses snake_case, frontend uses camelCase. Check DTO mapping for new endpoints.
- **Auth flow is fragile** — be extra careful when touching it.
- **Processing engine** fetches from backend API, not directly from MongoDB.
- **SignalR connections** can silently fail — check hub connection state in frontend.

### 4. Testing the Fix

Run relevant tests via Docker:
```bash
docker exec jwst-processing python -m pytest     # Python tests
docker exec jwst-backend dotnet test              # .NET tests (if available)
```

For frontend, the pre-commit hook catches type errors and test failures automatically.

## Bug Filing

If a bug is found during other work and is outside current scope:
- File a [GitHub Issue](https://github.com/Snoww3d/jwst-data-analysis/issues) with `bug` label
- Don't fix it in the current PR — separate branch/PR
- But don't dismiss it as "pre-existing" either — track it immediately

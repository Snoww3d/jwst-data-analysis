# Versioning Strategy

How services are versioned relative to each other, API compatibility approach, and dependency management.

> **4+1 View**: Development View

## Current State

The application uses **implicit lockstep versioning** — all services are deployed together from the same repository and must be compatible at HEAD.

### Application Versions

| Service | Version | Source |
|---------|---------|--------|
| Frontend | 0.1.0 | `package.json` |
| Processing Engine | 0.1.0 | `pyproject.toml` |
| Backend | (none) | No explicit version in `.csproj` |

These version numbers are not currently used for compatibility checks — they exist as metadata only.

### Language/Runtime Versions

| Runtime | Version | Pinning |
|---------|---------|---------|
| .NET | 10.0 | SDK `10.0.200` in CI; `mcr.microsoft.com/dotnet/aspnet:10.0` in Docker |
| Node.js | 22 | `node:22-alpine` in Docker; Node 22 in CI |
| Python | 3.12 | `python:3.12-slim-bullseye` in Docker; Python 3.12 in CI |
| MongoDB | 8.0 | `mongo:8.0` in Docker |

### Dependency Pinning Strategy

| Service | Strategy | Example |
|---------|----------|---------|
| Backend (NuGet) | Exact versions | `MongoDB.Driver 3.7.1` |
| Frontend (npm) | Caret ranges | `react: ^19.1.0` (minor/patch updates OK) |
| Processing Engine (pip) | Mixed | Critical: exact (`fastapi==0.135.1`), Scientific: range (`photutils>=1.10.0`) |
| Docker base images | Major.minor pinned | `dotnet/aspnet:10.0`, `python:3.12-slim-bullseye` |

## API Versioning

### Current Approach: No Explicit Versioning

API routes use `/api/<resource>` without version prefix (e.g., `/api/composite/generate-nchannel`, not `/api/v1/composite/...`).

**Why this works today**:
- Monorepo — all services deployed together
- Single deployment target — no multiple consumers at different versions
- Pre-1.0 — breaking changes expected and acceptable

### Inter-Service Contract

| Boundary | Contract | Breaking Change Policy |
|----------|---------|----------------------|
| Frontend → Backend | REST endpoints + SignalR events | Update both in same PR |
| Backend → Processing Engine | HTTP routes + JSON schemas | Update both in same PR |
| Backend → MAST Proxy | HTTP routes + JSON schemas | Update both in same PR |
| Backend → MongoDB | Document schemas (C# models) | Migration in same PR; MongoDB schema-less allows gradual changes |

### JSON Schema Compatibility

| Direction | Convention | Compatibility |
|-----------|-----------|--------------|
| Frontend → Backend | camelCase | Must match TypeScript types ↔ C# DTOs |
| Backend → Processing Engine | snake_case | Must match C# serialization ↔ Pydantic models |

Adding new optional fields is always safe. Removing or renaming fields requires coordinated changes across services.

## Docker Image Tagging

### Current: No Tags

Docker images are built locally and not pushed to a registry. Docker Compose builds from source each time.

### CI: Cache-Only

GitHub Actions builds use GHA cache with scope keys (`backend`, `frontend`, `processing`, `mast-proxy`) but does not push tagged images to a registry.

## Upgrade Procedures

### Dependency Updates

| Type | Frequency | Process |
|------|-----------|---------|
| Security patches | As needed | Dependabot PR or manual update |
| Minor versions | Monthly | Batch update, run full test suite |
| Major versions | Per release cycle | Dedicated branch, thorough testing |

### Runtime Version Upgrades

Upgrading a runtime (e.g., .NET 10 → 11) requires:
1. Update Dockerfile base image
2. Update CI matrix
3. Update `.csproj` target framework
4. Run full test suite + E2E
5. Single PR with all changes

### MongoDB Schema Changes

MongoDB's flexible document model allows additive changes without migration:
- **Adding fields**: Default values in C# model; existing documents unchanged
- **Renaming fields**: Requires one-time migration script + code update
- **Removing fields**: Remove from code; orphaned fields in documents are harmless

No formal migration framework is used — changes are handled in application code.

## Future Considerations

When the application reaches 1.0 (Community Edition), consider:

1. **API version prefix** (`/api/v1/...`) if external consumers emerge
2. **Semantic versioning** with Git tags for releases
3. **Docker image registry** (GitHub Container Registry) for reproducible deployments
4. **Changelog generation** from conventional commit messages
5. **Database migration tool** if schema changes become frequent

---

[Back to Architecture Overview](index.md)

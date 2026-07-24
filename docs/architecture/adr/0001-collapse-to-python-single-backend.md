# ADR 0001 — Collapse to a Two-Service Architecture (Python single backend)

- **Status:** Accepted (in progress)
- **Date:** 2026-06-07
- **Supersedes:** the three-tier polyglot architecture described in `system-overview.md`

## Context

The application runs a three-tier polyglot stack:

```
React frontend (31k LOC)
      │  only ever talks to :5001
      ▼
.NET gateway (21k LOC + 23k test)  ──HTTP proxy──►  Python engine (17.5k LOC + 16k test)
  auth · MongoDB · jobs · SignalR ·                   ALL real compute (astropy):
  storage · + proxies Composite/Mosaic/               composite, mosaic, mast,
  Mast/Analysis/Semantic to Python                    analysis, discovery, semantic
      │                                                       │
      ▼                                                       ▼
  MongoDB (2 collections)                          MAST + shared storage (SeaweedFS = 4 containers)
```

A full-stack review surfaced that the `.NET` `CompositeService`, `MosaicService`,
`MastService`, `AnalysisService`, and `SemanticSearchService` are **HTTP proxies**
(`_httpClient` → Python). The Python engine already owns every one of those domains
end-to-end. The `.NET` tier's only *non-duplicated* responsibilities are:

- **Auth** (JWT issue/validate, register/login/refresh)
- **MongoDB persistence** — only two collections: `jwst_data` and `users`
- **Job tracking + SignalR push** (`/hubs/job-progress`) and its background workers
  (composite/mosaic/thumbnail/embedding/scan/reaper)
- **Storage abstraction** — already duplicated by Python's `app/storage/provider.py`

Astropy and the scientific stack must stay in Python. The middle tier therefore adds
a second language, a second service, and a `snake_case ↔ camelCase` boundary while
mostly forwarding requests.

## Decision

Make the **Python FastAPI service the single backend** and **delete the .NET gateway**.
The Python backend absorbs auth, MongoDB persistence, job tracking, and real-time
progress (WebSocket replacing SignalR). The React frontend talks to one backend over
HTTP + WebSocket.

### Target architecture

```
React frontend  ──HTTP + WebSocket──►  Python FastAPI (single backend)
                                          compute + auth + persistence + jobs + WS
                                                │
                                                ▼
                                        MongoDB · storage (volume/real S3) · MAST
```

## Consequences

**Positive**

- One backend instead of two; one language deleted (~44k lines of C# incl. tests).
- No more cross-language DTO/casing boundary.
- Far fewer containers and compose files; simpler local and prod topology.
- Each ported responsibility carries its security fix from the review
  (JWT-secret-from-env, password complexity, no seed passwords, locked job state,
  `asyncio.to_thread` for blocking `fits.open`, no `str(e)` leakage).

**Negative / risks**

- Auth, persistence, and job orchestration must be reimplemented in Python.
- SignalR is replaced by a WebSocket protocol; the frontend client is rewritten once.
- A single frontend cutover (Phase 5) is the riskiest step; it is reversible by
  reverting the API base URL while both backends still run.

## Migration roadmap (strangler-fig)

The system stays shippable after every phase. Phases 1–4 add Python capability behind
the scenes while .NET still serves the frontend; Phase 5 is the one switchover; Phase 6
deletes the gateway.

| Phase | Scope |
|-------|-------|
| 0 | This ADR + Python backend package scaffolding (`auth/`, `db/`, `library/`, `jobs/`) + deps |
| 1 | MongoDB (`motor`) + Auth (`pyjwt`, `passlib`) in Python |
| 2 | Library / persistence endpoints (`jwst_data` CRUD, upload, scan) |
| 3 | Jobs + WebSocket progress + background workers |
| 4 | MAST import + discovery wired to persistence/jobs |
| 5 | Frontend cutover to Python + WebSocket |
| 6 | Delete the `.NET` tier (`backend/`, CI jobs, compose services) |
| 7 | Infrastructure simplification (SeaweedFS → volume/S3, collapse compose files) |
| 8 | In-tier cleanup (god-files, duplication) |

> **Progress note (2026-07, #1709):** Calibration Recipes landed the first real
> slices of Phases 1 and 3 in the engine — a JWT-validation dependency
> (`app/auth/deps.py`, validating .NET-issued tokens) and a Mongo-persisted
> generic **job store** with `/api/jobs` (`app/jobs/`), with calibration as its
> first consumer. Two deliberate divergences from the sketch above: progress is
> delivered by **HTTP polling** of `GET /api/jobs/{id}` rather than the Phase-3
> `/ws/jobs` WebSocket, and the frontend calls the engine **directly**
> (`VITE_ENGINE_URL` + engine CORS) for this surface rather than waiting for the
> full Phase-5 cutover. Token *issuance* and the write persistence layer remain
> in .NET. See [calibration-pipeline-flow](../calibration-pipeline-flow.md).

## References

- `CODEBASE_REVIEW.md` — full-stack review and issue inventory
- `system-overview.md` — current (pre-migration) architecture

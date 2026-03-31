# Quality Attribute Scenarios

Measurable quality attribute scenarios for the JWST Data Analysis Application. Each scenario defines a stimulus, environment, response, and response measure — following the SEI quality attribute scenario format.

> **4+1 View**: +1 Scenarios — quality attributes that constrain and shape all other views.

## Performance

### QA-P1: Composite Rendering Time

| Aspect | Description |
|--------|-------------|
| **Source** | Astronomer |
| **Stimulus** | Requests a 4-channel composite at 4096x4096 output resolution |
| **Environment** | Normal operation, single concurrent job |
| **Response** | Processing Engine renders and returns the composite image |
| **Measure** | Complete in < 30 seconds |

**Architectural Impact**: Processing Engine uses NumPy vectorized operations, not pixel-by-pixel loops. WCS alignment via `reproject` is the bottleneck — `reproject_interp` preferred over `reproject_exact` for speed.

### QA-P2: MAST Import Throughput

| Aspect | Description |
|--------|-------------|
| **Source** | Astronomer |
| **Stimulus** | Imports a full observation (10-20 FITS files, ~2 GB total) |
| **Environment** | Normal operation, stable internet connection |
| **Response** | Files downloaded from STScI, stored, metadata extracted |
| **Measure** | Sustained download at available bandwidth; UI updates every 2 seconds via SignalR |

**Architectural Impact**: Chunked downloads with streaming to storage. Progress tracking at byte level, not just file level. Resumable downloads for interrupted transfers.

### QA-P3: Discovery Page Load

| Aspect | Description |
|--------|-------------|
| **Source** | Visitor or Astronomer |
| **Stimulus** | Opens the Discovery home page |
| **Environment** | Normal operation |
| **Response** | Featured targets displayed with thumbnails and metadata |
| **Measure** | First meaningful paint in < 2 seconds; target cards rendered in < 3 seconds |

**Architectural Impact**: Featured targets are a curated static list (not dynamic MAST query). Thumbnails served from local storage. MAST queries only triggered on user action (target selection or search).

### QA-P4: Data Library Search

| Aspect | Description |
|--------|-------------|
| **Source** | Astronomer |
| **Stimulus** | Searches library with filters (instrument, target, tags) across 500+ records |
| **Environment** | Normal operation |
| **Response** | Filtered results returned with thumbnails |
| **Measure** | Results in < 1 second; pagination for large result sets |

**Architectural Impact**: MongoDB indexes on userId, tags, observationBaseId, processingLevel. Semantic search available for natural-language queries.

---

## Scalability

### QA-S1: Concurrent Users

| Aspect | Description |
|--------|-------------|
| **Source** | Multiple astronomers |
| **Stimulus** | 10 concurrent users performing imports, composites, and analysis |
| **Environment** | Single-node deployment (current architecture) |
| **Response** | All requests served without timeout or resource exhaustion |
| **Measure** | No request queuing beyond 5 seconds; no OOM kills |

**Architectural Impact**: Job queue serializes heavy compute work. FastAPI async handlers allow I/O concurrency. SignalR manages multiple WebSocket connections. Current target is small-team use, not public-scale.

### QA-S2: Data Volume

| Aspect | Description |
|--------|-------------|
| **Source** | System growth over time |
| **Stimulus** | Library grows to 10,000+ records across 50+ users |
| **Environment** | Normal operation |
| **Response** | Search, browse, and metadata operations remain responsive |
| **Measure** | No query exceeds 2 seconds; storage operations scale linearly |

**Architectural Impact**: MongoDB document model with targeted indexes. S3-compatible storage (SeaweedFS or AWS S3) for file storage — decoupled from application tier. Archival flag for soft-deleting old data.

### QA-S3: File Size Limits

| Aspect | Description |
|--------|-------------|
| **Source** | Astronomer uploads or imports large FITS files |
| **Stimulus** | File up to 2 GB processed |
| **Environment** | Normal operation |
| **Response** | File accepted, processed without memory exhaustion |
| **Measure** | MAX_FITS_FILE_SIZE_MB = 2048; MAX_FITS_ARRAY_ELEMENTS = 100M; MAX_MOSAIC_OUTPUT_PIXELS = 64M |

**Architectural Impact**: Processing Engine enforces hard limits at the application level. Streaming file I/O where possible. Docker container memory limits should be sized accordingly (recommend 4+ GB for Processing Engine).

---

## Security

### QA-SEC1: Authentication & Authorization

| Aspect | Description |
|--------|-------------|
| **Source** | Unauthenticated or malicious user |
| **Stimulus** | Attempts to access another user's private data |
| **Environment** | Normal operation |
| **Response** | Request rejected with 401/403 |
| **Measure** | Zero unauthorized data access; all private endpoints require valid JWT |

**Architectural Impact**: JWT-based auth with short-lived access tokens + refresh tokens. User data scoped by `UserId` in all queries. Public data explicitly flagged (`IsPublic = true`). Role-based access (Admin/User).

**Known Limitation**: Auth flow is currently fragile — identified as a risk area requiring careful changes.

### QA-SEC2: Input Validation

| Aspect | Description |
|--------|-------------|
| **Source** | Malicious user |
| **Stimulus** | Submits malformed FITS file or oversized request |
| **Environment** | Normal operation |
| **Response** | Input rejected before processing; no crash or resource exhaustion |
| **Measure** | All file uploads validated; all numeric parameters bounded; DoS limits enforced |

**Architectural Impact**: Backend validates all DTOs with range constraints. Processing Engine enforces file size and array element limits. CORS configured to restrict origins.

### QA-SEC3: Credential Management

| Aspect | Description |
|--------|-------------|
| **Source** | Deployment configuration |
| **Stimulus** | Application starts with credentials configured |
| **Environment** | All environments |
| **Response** | No credentials in code, logs, or client-visible responses |
| **Measure** | All secrets via environment variables; `.env` files gitignored; no plaintext in Docker commands |

**Architectural Impact**: `docker/.env` (from `.env.example`) for local dev. Container env vars for staging/production. Password hashing for user accounts. Refresh tokens stored in DB, not localStorage.

---

## Reliability

### QA-R1: Job Failure Recovery

| Aspect | Description |
|--------|-------------|
| **Source** | Processing Engine or network |
| **Stimulus** | Composite or import job fails mid-execution |
| **Environment** | Normal operation |
| **Response** | Job marked as failed with error details; no orphaned data; user can retry |
| **Measure** | Failed jobs visible in UI within 5 seconds; import jobs are resumable |

**Architectural Impact**: try/catch wrapping in all job execution paths. Job state tracked in MongoDB (survives restarts). Import jobs track byte-level progress for resume. Failed jobs do not leave partial records in the data collection.

### QA-R2: External Service Unavailability

| Aspect | Description |
|--------|-------------|
| **Source** | STScI MAST Portal |
| **Stimulus** | MAST API returns timeout or 5xx error |
| **Environment** | Degraded external service |
| **Response** | Error surfaced to user with actionable message; local functionality unaffected |
| **Measure** | MAST failures do not cascade to non-MAST features; import jobs can be retried |

**Architectural Impact**: MAST operations are isolated to specific endpoints. Failures in MAST queries don't affect local data browsing, compositing, or analysis. Timeouts configured for external HTTP calls.

### QA-R3: Container Restart Resilience

| Aspect | Description |
|--------|-------------|
| **Source** | Docker orchestration |
| **Stimulus** | Processing Engine container restarts during a job |
| **Environment** | Container failure or resource limit hit |
| **Response** | Running jobs marked as failed; no data corruption |
| **Measure** | Jobs in "running" state detected as stale after container restart; data store remains consistent |

**Architectural Impact**: Job state in MongoDB (not in-memory). Storage operations are atomic (write-then-record). Docker health checks enable restart policies. No in-flight state that can't be reconstructed from the database.

---

## Usability

### QA-U1: First-Time User Success

| Aspect | Description |
|--------|-------------|
| **Source** | New astronomer |
| **Stimulus** | User with no prior experience creates their first composite image |
| **Environment** | Normal operation |
| **Response** | Guided Discovery wizard leads user from target selection to finished composite |
| **Measure** | Complete flow in < 10 minutes (including data import); no documentation required |

**Architectural Impact**: Featured targets curated for visual impact. Recipe system pre-fills complex parameters. Presets (auto, natural, NASA) reduce decision points. Progressive disclosure of advanced controls.

### QA-U2: Real-Time Feedback

| Aspect | Description |
|--------|-------------|
| **Source** | Astronomer |
| **Stimulus** | Initiates any long-running operation (import, composite, mosaic) |
| **Environment** | Normal operation |
| **Response** | Progress bar with stage description, percentage, and ETA |
| **Measure** | UI updates at least every 2 seconds; user can cancel at any time |

**Architectural Impact**: SignalR WebSocket connection for push updates. Job stages provide granular progress (not just 0%/100%). Cancel flag checked at processing checkpoints.

---

## Maintainability

### QA-M1: Service Independence

| Aspect | Description |
|--------|-------------|
| **Source** | Developer |
| **Stimulus** | Modifies Processing Engine without touching Backend or Frontend |
| **Environment** | Development |
| **Response** | Change deployed independently; other services unaffected |
| **Measure** | Each service has its own Dockerfile, test suite, and can be rebuilt independently |

**Architectural Impact**: Three separate codebases (React, .NET, Python) communicating via HTTP APIs. No shared code or compiled dependencies between services. Docker Compose manages the stack.

### QA-M2: Test Coverage

| Aspect | Description |
|--------|-------------|
| **Source** | Developer |
| **Stimulus** | Makes a code change to any service |
| **Environment** | Development / CI |
| **Response** | Pre-commit hooks run relevant tests; CI runs full suite |
| **Measure** | Unit tests pass in < 30 seconds per service; E2E tests validate critical paths |

**Architectural Impact**: Pre-commit hooks enforce lint + build + unit tests. CI pipeline runs full matrix. Interfaces (IMongoDBService, IMastService) enable unit testing with mocks. E2E tests validate cross-service flows.

---

## Summary Matrix

| Quality Attribute | Priority | Current State | Key Risk |
|-------------------|----------|---------------|----------|
| **Performance** | High | Good for single-user; untested at scale | Large mosaic memory usage |
| **Scalability** | Medium | Single-node; adequate for 10 users | No horizontal scaling path yet |
| **Security** | High | JWT auth in place; DoS limits set | Auth flow fragility |
| **Reliability** | High | Job recovery works; MAST isolation good | Container restart loses running jobs |
| **Usability** | High | Guided flow complete; presets available | Complex parameter space for advanced users |
| **Maintainability** | High | Good service separation; strong hook enforcement | Three-language stack increases cognitive load |

---

[Back to Architecture Overview](index.md)

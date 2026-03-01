# Processing Engine Scaling

Exploratory analysis of how to scale composite and mosaic processing from a single user to many concurrent users.

**Status**: Brainstorm (Feb 2026) — no decisions made, no implementation planned yet.

## Current Architecture

```
User → .NET API → Background Service → HTTP call → Python container (1 instance)
         ↓                                              ↓
    Job Tracker                                    Process FITS
    SignalR push                                   Return bytes
```

One processing container, one request at a time per worker. The .NET job queue serializes work, which is fine for one user but becomes a bottleneck with concurrent users.

## Scaling Levels

### Level 0: Caching (biggest bang, zero infrastructure)

Before scaling compute, eliminate redundant compute. Most users visiting a popular target will request the same composite with default settings.

**Composite result cache**: hash the inputs (dataIds + color mapping + stretch params + dimensions) → check if result exists → return cached blob. Store in S3, keyed by hash. TTL-based expiry.

100 users looking at M16 = 1 composite generation + 99 cache hits.

**Pre-generation for featured targets**: the 13 featured targets have curated recipes. Generate default composites on deploy or nightly. Users see instant results for the most common paths.

Ties into the "permalinkable viewer state" roadmap item — a cached composite with a stable hash is naturally shareable.

**Effort**: Small. High leverage at every scale level.

### Level 1: Multiple Workers (several users)

Bump uvicorn to N workers matching CPU cores. Combined with caching, handles 5-10 concurrent unique composite requests.

**Effort**: One line change in Docker CMD. Zero architecture change.

### Level 2: SQS + Fargate Auto-Scaling Workers (tens of users)

Decouple job submission from processing. Instead of the .NET background service calling the processing engine via HTTP, it pushes a message to SQS:

```
User → .NET API → SQS queue → Worker containers (auto-scaled)
         ↓                          ↓
    Job Tracker                 Pull job, process,
    SignalR push ←────────────  write result to S3,
                                notify via SNS/callback
```

**Why this fits the project well:**

- The job queue pattern already exists in .NET — `CompositeQueue`, `CompositeBackgroundService`, `JobTracker`, SignalR push. The bounded channel just becomes SQS.
- Workers are the same Python Docker image, running a queue consumer instead of a web server.
- ECS Fargate auto-scales workers based on queue depth (0 workers when idle = $0).
- Each worker processes one job, pulls the next when done. No coordination needed.
- Results go to S3 (already have S3 storage provider).

**What changes:**

- Processing engine gets a queue consumer mode (read SQS, process, write to S3, ack)
- .NET `CompositeBackgroundService` pushes to SQS instead of calling HTTP
- Job completion via SNS → webhook or polling result in S3
- FITS files must be in S3 (not local disk) so workers can access them

**What doesn't change:**

- Frontend (still gets SignalR progress, same job IDs)
- Job tracker (still tracks status, just updated differently)
- Processing Python code (same functions, different entry point)

**Effort**: Medium. Most work is in the SQS/SNS plumbing and Fargate task definitions.

### Level 3: Step Functions for Complex Pipelines (many users)

Large mosaics are multi-step: download sources → reproject each → combine → stretch → encode. With Step Functions, each step is a separate Fargate task:

```
Step Functions:
  1. Fan-out: reproject each source file (parallel Fargate tasks)
  2. Combine reprojected files (single task, needs all outputs)
  3. Stretch + encode (single task)
  4. Write result to S3, notify
```

Parallelizes the expensive reprojection step and handles mosaics that would timeout or OOM a single container.

**Honest assessment**: real engineering effort, only worth it for users generating 10+ source mosaics regularly. For 2-4 source mosaics (the common case), Level 2 handles it fine.

**Effort**: Large.

## Lambda Assessment

Evaluated Lambda as a processing backend. Summary: poor fit for the core workloads.

| Factor | Impact |
|--------|--------|
| Cold starts | 10-30s for numpy/astropy/scipy stack, even with container images |
| File sizes | FITS files are 100MB-5GB; Lambda response limit is 6MB; requires S3 intermediary for everything |
| Execution time | Large mosaics can exceed Lambda's 15-minute limit |
| Memory | 10GB max may be tight for large multi-source mosaics |

**Where Lambda does fit**: thumbnail generation (small input/output, embarrassingly parallel, stateless), recipe suggestions (lightweight, fast), and scheduled tasks (cleanup, metadata refresh).

## Scaling Summary

| Users | Architecture | Effort | Monthly Cost Delta |
|-------|-------------|--------|-------------------|
| 1-5 | Current + caching + multiple workers | Small | ~$0 |
| 5-30 | SQS + Fargate auto-scaling workers | Medium | ~$10-30 (scales to zero) |
| 30-100+ | Above + Step Functions for mosaics, CDN for cached results | Large | ~$30-100 |
| 100+ | Kubernetes, GPU workers, tiered processing | Very large | Varies widely |

## Recommended Path

1. **Now**: Implement composite result caching (Level 0). Highest leverage, works at every scale.
2. **When needed**: Add multiple workers (Level 1). One-line change.
3. **With real users**: SQS + Fargate (Level 2). Natural evolution of existing job queue pattern.
4. **At scale**: Step Functions for mosaics (Level 3). Only if large mosaics become common.

Caching is the prerequisite that makes everything else cheaper. Build it first regardless of which scaling path is chosen.

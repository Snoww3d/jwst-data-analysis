# Architecture Documentation

Architecture documentation for the JWST Data Analysis Application, organized using the [4+1 Architectural View Model](https://en.wikipedia.org/wiki/4%2B1_architectural_view_model).

> **In progress:** the system is migrating from the three-tier polyglot stack to a
> two-service architecture (Python single backend). See
> [ADR 0001 — Collapse to a Python single backend](adr/0001-collapse-to-python-single-backend.md).
> Documents below describe the current (pre-migration) state until each phase lands.

---

## Decisions (ADRs)

- **[ADR 0001 — Collapse to a Python single backend](adr/0001-collapse-to-python-single-backend.md)** — delete the .NET gateway; Python/FastAPI becomes the one backend

---

## +1 Scenarios (Use Cases)

The scenarios tie all views together — start here to understand what the system does.

- **[Use Case Catalog](use-case-catalog.md)** — Primary use cases from discovery to composite creation
- **[Quality Attributes](quality-attributes.md)** — Performance, scalability, security, and reliability scenarios

## Logical View

Structure of the system: domain model, API boundaries, and component responsibilities.

- **[System Overview](system-overview.md)** — High-level microservices architecture and communication patterns
- **[Domain Model](domain-model.md)** — Entity relationships (User, JwstData, Job, Composite, Mosaic, Target, Recipe)
- **[API Contracts](api-contracts.md)** — Service-to-service API boundary map with all endpoints
- **[Backend Service Layer](backend-service-layer.md)** — .NET repository pattern and service architecture
- **[Frontend Architecture](frontend-architecture.md)** — Route structure and component hierarchy
- **[Processing Engine](processing-engine.md)** — Python FastAPI scientific computing modules
- **[MongoDB Documents](mongodb-document.md)** — Flexible document schema for JWST data records
- **[Storage Layer](storage-layer.md)** — Storage abstraction across .NET and Python
- **[Data Lineage](data-lineage.md)** — JWST data processing levels and observation grouping
- **[Security & Authorization Model](security-model.md)** — User roles, data visibility, and access control

## Process View

Runtime behavior: concurrency, async jobs, real-time communication, and error handling.

- **[Concurrency Model](concurrency-model.md)** — Job queues, worker threading, SignalR lifecycle, rate limiting
- **[Error Recovery](error-recovery.md)** — Failure modes, Polly retry/circuit-breaker, resumable downloads
- **[Job Queue & SignalR](job-queue-signalr.md)** — Async job pattern for composite, mosaic, and thumbnails
- **[Authentication Flow](authentication-flow.md)** — JWT-based authentication with access and refresh tokens

### Data Flows

- **[Discovery & Recipe Flow](discovery-recipe-flow.md)** — Browsing featured targets, searching MAST, and recipe suggestions
- **[GuidedCreate Flow](guidedcreate-flow.md)** — End-to-end user journey from recipe selection to composite result
- **[MAST Import Flow](mast-import-flow.md)** — Searching and importing data from the MAST portal with chunked downloads
- **[Local Upload Flow](local-upload-flow.md)** — Uploading JWST data files directly to the application
- **[Calibration Pipeline Flow](calibration-pipeline-flow.md)** — Running the STScI `jwst` pipeline via declarative recipes as tracked engine jobs (#1709)

## Development View

Code organization, build pipeline, dependencies, and versioning.

- **[Module Dependencies](module-dependencies.md)** — Package and module dependency diagrams per service
- **[Build Pipeline](build-pipeline.md)** — CI/CD flow from pre-commit hooks through GitHub Actions to deploy
- **[Versioning Strategy](versioning-strategy.md)** — Service versioning, dependency pinning, and upgrade paths

## Physical View

Deployment topology, networking, and infrastructure.

- **[Deployment Architecture](deployment-architecture.md)** — Dev, staging, and production topology with scaling path
- **[Network Topology](network-topology.md)** — All ports, protocols, firewall rules, and TLS configuration
- **[Docker Compose](docker-compose.md)** — Application stack orchestration details

---

## See Also

- [Development Plan](../development-plan.md) — Project roadmap
- [Key Files](../key-files.md) — Important file locations
- [Quick Reference](../quick-reference.md) — API and CLI cheat sheet
- [Backend Development Standards](../standards/backend-development.md)
- [Frontend Development Standards](../standards/frontend-development.md)
- [Database Models](../standards/database-models.md)

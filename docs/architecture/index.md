# Architecture Documentation

Visual diagrams of the JWST Data Analysis Application architecture using Mermaid. Each diagram has its own page for full-width rendering.

## Diagrams

- **[System Overview](system-overview.md)** — High-level microservices architecture and communication patterns

### Data Flows

- **[Local Upload Flow](local-upload-flow.md)** — Uploading JWST data files directly to the application
- **[MAST Import Flow](mast-import-flow.md)** — Searching and importing data from the MAST portal with chunked downloads
- **[Discovery & Recipe Flow](discovery-recipe-flow.md)** — Browsing featured targets, searching MAST, and recipe suggestions
- **[GuidedCreate Flow](guidedcreate-flow.md)** — End-to-end user journey from recipe selection to composite result
- **[Authentication Flow](authentication-flow.md)** — JWT-based authentication with access and refresh tokens
- **[Security & Authorization Model](security-model.md)** — User roles, data visibility, endpoint authorization matrix, and access control patterns
- **[Job Queue & SignalR](job-queue-signalr.md)** — Async job pattern for composite export, mosaic, and thumbnails

### System Components

- **[Data Lineage](data-lineage.md)** — JWST data processing levels and observation grouping
- **[Frontend Architecture](frontend-architecture.md)** — Route structure and component hierarchy
- **[Storage Layer](storage-layer.md)** — Storage abstraction across .NET and Python
- **[MongoDB Documents](mongodb-document.md)** — Flexible document schema for JWST data records
- **[Backend Service Layer](backend-service-layer.md)** — .NET repository pattern and service architecture
- **[Processing Engine](processing-engine.md)** — Python FastAPI scientific computing modules
- **[Docker Compose](docker-compose.md)** — Application stack orchestration

---

## See Also

- [Development Plan](../development-plan.md) — Project roadmap
- [Backend Development Standards](../standards/backend-development.md)
- [Frontend Development Standards](../standards/frontend-development.md)
- [Database Models](../standards/database-models.md)

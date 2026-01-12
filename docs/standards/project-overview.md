# JWST Data Analysis Project Overview

This is a microservices-based application for analyzing James Webb Space Telescope (JWST) data with advanced computer science capabilities.

## Architecture

- **Frontend**: React TypeScript application in [frontend/jwst-frontend/](../../frontend/jwst-frontend/)
- **Backend**: .NET 8 Web API in [backend/JwstDataAnalysis.API/](../../backend/JwstDataAnalysis.API/)
- **Processing Engine**: Python FastAPI service in [processing-engine/](../../processing-engine/)
- **Database**: MongoDB (document database)
- **Containerization**: Docker Compose in [docker/docker-compose.yml](../../docker/docker-compose.yml)

## Development Phases

See [docs/development-plan.md](../development-plan.md) for detailed phase breakdown:

- ✅ Phase 1: Foundation & Architecture (Complete)
- 🔄 Phase 2: Core Infrastructure (Current)
- ⏳ Phase 3: Data Processing Engine
- ⏳ Phase 4: Frontend Development
- ⏳ Phase 5: Integration & Advanced Features
- ⏳ Phase 6: Testing & Deployment

## Key Files

- Main README: [README.md](../../README.md)
- Docker configuration: [docker/docker-compose.yml](../../docker/docker-compose.yml)
- Development plan: [docs/development-plan.md](../development-plan.md)

## Current Status

All services are running and healthy:

- Frontend: <http://localhost:3000>
- Backend API: <http://localhost:5001>
- Processing Engine: <http://localhost:8000>
- MongoDB: localhost:27017

---

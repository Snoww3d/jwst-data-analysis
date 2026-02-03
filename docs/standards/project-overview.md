# JWST Data Analysis Project Overview

This is a microservices-based application for analyzing James Webb Space Telescope (JWST) data with advanced computer science capabilities.

## Architecture

- **Frontend**: React TypeScript application in [frontend/jwst-frontend/](https://github.com/Snoww3d/jwst-data-analysis/tree/main/frontend/jwst-frontend)
- **Backend**: .NET 10 Web API in [backend/JwstDataAnalysis.API/](https://github.com/Snoww3d/jwst-data-analysis/tree/main/backend/JwstDataAnalysis.API)
- **Processing Engine**: Python FastAPI service in [processing-engine/](https://github.com/Snoww3d/jwst-data-analysis/tree/main/processing-engine)
- **Database**: MongoDB (document database)
- **Containerization**: Docker Compose in [docker/docker-compose.yml](https://github.com/Snoww3d/jwst-data-analysis/blob/main/docker/docker-compose.yml)

## Development Phases

See [docs/development-plan.md](../development-plan.md) for detailed phase breakdown:

- ✅ Phase 1: Foundation & Architecture (Complete)
- ✅ Phase 2: Core Infrastructure (Complete)
- 🔄 Phase 3: Data Processing Engine (MAST integration complete, algorithms in progress)
- 🔄 Phase 4: Frontend Development (API service layer complete, visualization in progress)
- ⏳ Phase 5: Integration & Advanced Features
- ⏳ Phase 6: Testing & Deployment

## Key Files

- Main README: [README.md](https://github.com/Snoww3d/jwst-data-analysis/blob/main/README.md)
- Docker configuration: [docker/docker-compose.yml](https://github.com/Snoww3d/jwst-data-analysis/blob/main/docker/docker-compose.yml)
- Development plan: [docs/development-plan.md](../development-plan.md)

## Current Status

All services are running and healthy:

- Frontend: <http://localhost:3000>
- Backend API: <http://localhost:5001>
- Processing Engine: <http://localhost:8000>
- MongoDB: localhost:27017

## Recent Features

- **Centralized API Service Layer**: Type-safe service layer (`src/services/`) replacing inline fetch calls with consistent error handling
- **MAST Portal Integration**: Search and import JWST data from STScI archive
- **Processing Level Tracking**: L1/L2a/L2b/L3 pipeline stage identification
- **Lineage Visualization**: Tree view showing file relationships across processing levels

---

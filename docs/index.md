# JWST Data Analysis Platform

Welcome to the documentation for the JWST Data Analysis Application - a microservices-based platform for analyzing James Webb Space Telescope data with advanced scientific computing capabilities.

## Quick Links

- [Setup Guide](setup-guide.md) - Get started with the application
- [Architecture](architecture.md) - System design and data flows
- [Development Plan](development-plan.md) - Roadmap and current phase
- [Tech Debt](tech-debt.md) - Known issues and improvements

## Architecture Overview

```
User Browser
    ↓
React Frontend (port 3000)
    ↓ HTTP/REST
.NET Backend API (port 5001)
    ↓ MongoDB.Driver          ↓ HTTP POST
MongoDB (port 27017)    Python Processing Engine (port 8000)
                              ↓                    ↓
                        Scientific Libraries    MAST Portal
                        (NumPy, Astropy, SciPy) (astroquery.mast)
```

## Service URLs (Docker)

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:5001 |
| Processing Engine | http://localhost:8000 |
| MongoDB | localhost:27017 |

## Getting Started

```bash
# Start all services
cd docker
docker compose up -d

# View logs
docker compose logs -f
```

See the [Setup Guide](setup-guide.md) for detailed instructions.

## Development Standards

- [Backend Development](standards/backend-development.md) - .NET API standards
- [Frontend Development](standards/frontend-development.md) - React/TypeScript standards
- [Processing Engine](standards/processing-engine.md) - Python/FastAPI standards
- [Database Models](standards/database-models.md) - MongoDB schema design
- [Docker Deployment](standards/docker-deployment.md) - Container configuration

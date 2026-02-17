
# Docker and Deployment Rules

## Architecture

- Multi-service Docker Compose setup
- Separate containers for each service
- Shared network for inter-service communication
- Volume mounting for data persistence

## Key Files

- Docker Compose: [docker/docker-compose.yml](https://github.com/Snoww3d/jwst-data-analysis/blob/main/docker/docker-compose.yml)
- Backend Dockerfile: [backend/JwstDataAnalysis.API/Dockerfile](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Dockerfile)
- Frontend Dockerfile: [frontend/jwst-frontend/Dockerfile](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/Dockerfile)
- Processing Engine Dockerfile: [processing-engine/Dockerfile](https://github.com/Snoww3d/jwst-data-analysis/blob/main/processing-engine/Dockerfile)

## Services

- mongodb: Database service (port 27017)
- backend: .NET API service (port 5001)
- frontend: React application (port 3000)
- processing-engine: Python service (port 8000)
- docs: MkDocs documentation (port 8001)
- seaweedfs: S3-compatible object storage for local dev (port 8333, `s3` profile only)

## Configuration

- Use environment variables for service configuration
- Implement proper health checks
- Use restart policies for production readiness
- Configure proper networking between services

## Development vs Production

- Current setup is for development
- Use proper secrets management for production
- Implement proper logging and monitoring
- Use production-grade MongoDB configuration

## Security Considerations

- Default MongoDB credentials are for development only
- Implement proper authentication in production
- Use secrets management for sensitive data
- Configure proper network security

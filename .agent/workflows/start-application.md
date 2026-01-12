---
description: Start the full Astronomy application stack using Docker
---

## Prerequisites
- Docker and Docker Compose installed
- No conflicting services running on ports 3000, 5001, 8000, or 27017

## Start the Application

// turbo
1. Check for any running containers:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   docker ps --filter "name=jwst" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
   ```

2. Stop any existing JWST containers if running:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   docker-compose down
   ```

// turbo
3. Build and start all services:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   docker-compose up --build -d
   ```

// turbo
4. Verify all containers are running:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   docker-compose ps
   ```

// turbo
5. Check logs for any startup errors:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   docker-compose logs --tail=20
   ```

## Service Endpoints

| Service           | URL                         | Port  |
|-------------------|----------------------------|-------|
| Frontend          | http://localhost:3000       | 3000  |
| Backend API       | http://localhost:5001       | 5001  |
| Processing Engine | http://localhost:8000       | 8000  |
| MongoDB           | mongodb://localhost:27017   | 27017 |

## Health Checks

// turbo
6. Verify backend API is responding:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   curl -s http://localhost:5001/api/health || echo "Backend not ready yet"
   ```

// turbo
7. Verify processing engine is responding:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   curl -s http://localhost:8000/health || echo "Processing engine not ready yet"
   ```

8. Open the frontend in browser at http://localhost:3000

## Troubleshooting

### Port Conflicts
If you get port conflict errors, check what's using the ports:
```bash
lsof -i :3000 -i :5001 -i :8000 -i :27017
```

### View Service Logs
To view logs for a specific service:
```bash
# cwd: /Users/shanon/Source/Astronomy/docker
docker-compose logs -f frontend    # Frontend logs
docker-compose logs -f backend     # Backend logs
docker-compose logs -f processing-engine  # Processing engine logs
docker-compose logs -f mongodb     # MongoDB logs
```

### Restart a Single Service
```bash
# cwd: /Users/shanon/Source/Astronomy/docker
docker-compose restart <service-name>
```

### Full Rebuild
If things aren't working, try a full rebuild:
```bash
# cwd: /Users/shanon/Source/Astronomy/docker
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

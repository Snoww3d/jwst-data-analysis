---
description: Start the full Astronomy application stack using Docker
---
1. Stop any currently running manual instances of the services (frontend, backend, processing engine).
2. Run the docker compose command from the docker directory:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   docker-compose up --build
   ```

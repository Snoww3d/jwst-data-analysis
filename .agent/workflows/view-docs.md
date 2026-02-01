---
description: Open the project documentation site in your browser
---

## Ensure Documentation Server is Running

// turbo
1. Start the docs container if not already running:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   docker compose up -d docs
   ```

## Determine Target URL

2. **Check the user's Active Document** from the metadata. Map it to the docs URL:

   | Active Document Path | Docs URL |
   |---------------------|----------|
   | `docs/tech-debt.md` | `http://localhost:8001/content/tech-debt/` |
   | `docs/bugs.md` | `http://localhost:8001/content/bugs/` |
   | `docs/architecture.md` | `http://localhost:8001/content/architecture/` |
   | `docs/standards/*.md` | `http://localhost:8001/content/standards/<filename>/` |
   | `.agent/workflows/fix-bug.md` | `http://localhost:8001/workflows/fix-bug/` |
   | `.agent/workflows/create-feature.md` | `http://localhost:8001/workflows/create-feature/` |
   | `.agent/workflows/resolve-tech-debt.md` | `http://localhost:8001/workflows/resolve-tech-debt/` |
   | `.agent/workflows/start-application.md` | `http://localhost:8001/workflows/start-application/` |
   | `README.md` | `http://localhost:8001/` |
   | (any other or none) | `http://localhost:8001/` |

// turbo
3. Open the mapped URL in the user's default browser:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   open <mapped-url>
   ```

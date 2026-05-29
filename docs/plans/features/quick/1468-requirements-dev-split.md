# Chore #1468 — Move test/lint tooling out of production requirements.txt

**Branch**: `chore/1468-requirements-dev-split`
**Type**: Chore (dependency hygiene), processing-engine, priority: medium
**Complexity**: Low–medium (packaging + Docker + CI wiring)

## Problem

`processing-engine/requirements.txt` (installed directly by the production
`Dockerfile`) carried a `# Testing` block — `pytest`, `pytest-asyncio`,
`pytest-cov`, `httpx`, `ruff` — so every production image shipped test runners
and a linter. `requirements-dev.txt` re-declared some of these as floors but the
pinned versions in `requirements.txt` silently won (drift).

## Constraint the issue missed

The local `jwst-processing` container builds from the **same** production
`Dockerfile` (base `docker-compose.yml`), and the documented local test workflow
is `docker exec jwst-processing python -m pytest`. Simply deleting the test tools
from `requirements.txt` (as the issue suggested, "no Dockerfile change needed")
would break local testing after a rebuild. So the Dockerfile needs an opt-in.

## Fix

1. **`requirements.txt`** — remove the `# Testing` block (left a pointer comment).
2. **`requirements-dev.txt`** — single source of truth for test/lint tooling;
   pin `pytest==9.0.3`, `pytest-asyncio==1.3.0`, `pytest-cov==7.1.0`,
   `httpx==0.28.1`, `ruff==0.15.12` (the versions previously in requirements.txt,
   killing the drift). Still `-r requirements.txt` for prod deps.
3. **`Dockerfile`** — `ARG INSTALL_DEV=false`; when `true`, install
   `requirements-dev.txt` instead of `requirements.txt`. Default `false` → plain
   builds and the production stack stay lean.
4. **`docker-compose.override.yml`** (local-only) — set
   `processing-engine.build.args.INSTALL_DEV: "true"` so local images keep pytest/ruff.
   Prod (`docker-compose.prod.yml`) sets no arg → lean image.
5. **CI** — `ci.yml` (Python Tests) and `composite-memory-test.yml` now
   `pip install -r requirements-dev.txt` (+ cache-dependency-path + path trigger).

## Consumer matrix (verified)

| Consumer | Builds/installs | Gets test tools? | Correct |
|---|---|---|---|
| Local stack (base+override) | `INSTALL_DEV=true` | yes | ✓ keeps `docker exec ... pytest` |
| Prod stack (base+prod) | no arg → false | no | ✓ lean |
| CI Docker Build job | plain build, no arg | no | ✓ validates lean image |
| CI Python Tests / memory-test | `pip -r requirements-dev.txt` | yes | ✓ |
| E2E | mock processing-engine image | n/a | ✓ unaffected |

## Verification

- `pip install --dry-run -r requirements-dev.txt` resolves cleanly (no conflicts).
- `docker compose config` confirms `INSTALL_DEV=true` merges locally and is absent in prod.
- Dev image build (`--build-arg INSTALL_DEV=true`) ships pytest + ruff.
- CI Docker Build validates the lean (default) image builds.

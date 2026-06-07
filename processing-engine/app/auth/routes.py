"""Authentication routes (scaffold).

Endpoints land in Phase 1 of the single-backend migration
(docs/architecture/adr/0001-collapse-to-python-single-backend.md):
``/api/auth/register``, ``/api/auth/login``, ``/api/auth/refresh``.

The router is intentionally empty for now so the import graph and OpenAPI tag
are established without changing runtime behavior.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/auth", tags=["Auth"])

"""Library routes (scaffold).

Endpoints land in Phase 2 of the single-backend migration
(docs/architecture/adr/0001-collapse-to-python-single-backend.md):
``/api/jwstdata`` CRUD, ``/api/jwstdata/upload``, ``/api/upload``,
``/api/datamanagement/import/scan``.

The router is intentionally empty for now so the import graph and OpenAPI tag
are established without changing runtime behavior.
"""

from fastapi import APIRouter


router = APIRouter(prefix="/api", tags=["Library"])

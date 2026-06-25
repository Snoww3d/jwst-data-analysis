"""Jobs routes (scaffold).

Endpoints land in Phase 3 of the single-backend migration
(docs/architecture/adr/0001-collapse-to-python-single-backend.md):
``/api/jobs`` status queries plus the ``/ws/jobs`` WebSocket that replaces the
``.NET`` SignalR ``/hubs/job-progress`` hub.

The router is intentionally empty for now so the import graph and OpenAPI tag
are established without changing runtime behavior.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])

"""Custom exception hierarchy and error handlers for the processing engine."""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------


class ProcessingEngineError(Exception):
    """Base exception for all processing engine errors.

    Attributes:
        status_code: HTTP status code for the error response.
        error_type: Machine-readable error classification (class name).
    """

    status_code: int = 500
    error_type: str = "ProcessingEngineError"

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        if status_code is not None:
            self.status_code = status_code


class FITSProcessingError(ProcessingEngineError):
    status_code = 500
    error_type = "FITSProcessingError"


class CompositeError(ProcessingEngineError):
    status_code = 500
    error_type = "CompositeError"


class MosaicError(ProcessingEngineError):
    status_code = 500
    error_type = "MosaicError"


class AnalysisError(ProcessingEngineError):
    status_code = 500
    error_type = "AnalysisError"


class StorageError(ProcessingEngineError):
    status_code = 500
    error_type = "StorageError"


class StoragePermissionError(StorageError):
    status_code = 403
    error_type = "StoragePermissionError"


class StorageNotFoundError(StorageError):
    status_code = 404
    error_type = "StorageNotFoundError"


class EmbeddingError(ProcessingEngineError):
    status_code = 500
    error_type = "EmbeddingError"


# MAST-specific exceptions (#959 PR 2):
# class MASTServiceError(ProcessingEngineError): status_code = 502
#   class MASTTimeoutError(MASTServiceError): status_code = 504
#   class MASTNotFoundError(MASTServiceError): status_code = 404
#   class MASTRateLimitError(MASTServiceError): status_code = 429


# ---------------------------------------------------------------------------
# FastAPI exception handlers
# ---------------------------------------------------------------------------


async def processing_engine_error_handler(
    request: Request, exc: ProcessingEngineError
) -> JSONResponse:
    """Convert ProcessingEngineError (and subclasses) to structured JSON."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.error_type,
            "detail": str(exc),
            "status_code": exc.status_code,
        },
    )


async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions — no internals leaked."""
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "InternalServerError",
            "detail": "An internal error occurred",
            "status_code": 500,
        },
    )

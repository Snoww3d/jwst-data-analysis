# Plan: #959 Exception Handling Overhaul (PR 1 of 2)

## Context

The processing engine has 71 `except Exception` handlers across 15 files — no custom exceptions, no exception middleware, no structured error responses. This causes silent bug masking, unhelpful error messages, and makes debugging nearly impossible.

PR 1 covers the infrastructure (exception classes, middleware) plus ~40 narrowings in the processing/analysis/mosaic/composite/semantic layers and main.py routes. PR 2 (separate) covers the MAST layer (~34 instances).

Closes #959

## Step 1: Create exception hierarchy

**New file: `processing-engine/app/exceptions.py`**

```
ProcessingEngineError (base, status_code=500)
├── FITSProcessingError (500)
├── CompositeError (500)
├── MosaicError (500)
├── AnalysisError (500)
├── StorageError (500)
│   ├── StoragePermissionError (403)
│   └── StorageNotFoundError (404)
└── EmbeddingError (500)
```

- MASTServiceError + subtypes are stubs/comments only — implemented in PR 2
- Each class has `status_code` (int) and `error_type` (str, class name) attributes
- Base `__init__(self, message: str, status_code: int | None = None)` allows per-instance override
- Also define handler functions here: `processing_engine_error_handler()` and `generic_error_handler()`

## Step 2: Register middleware on both FastAPI apps

**Modify: `processing-engine/main.py`** (after line 67 `app = FastAPI(...)`)
**Modify: `processing-engine/main_mast.py`** (after app creation)

```python
from app.exceptions import (
    ProcessingEngineError,
    processing_engine_error_handler,
    generic_error_handler,
)

app.add_exception_handler(ProcessingEngineError, processing_engine_error_handler)
app.add_exception_handler(Exception, generic_error_handler)
```

Handler response format (MUST include `detail` field for .NET backend compat):
```json
{"error": "CompositeError", "detail": "message here", "status_code": 500}
```

Catch-all handler returns generic message — no internal details leaked:
```json
{"error": "InternalServerError", "detail": "An internal error occurred", "status_code": 500}
```

FastAPI's built-in HTTPException handler takes precedence — existing `raise HTTPException(...)` calls unaffected.

## Step 3: Remove top-level route boilerplate

Remove the `except HTTPException: raise / except Exception: raise HTTPException(500)` pattern from all route handlers. The middleware handles it now.

| File | Lines to remove | Count |
|------|----------------|-------|
| `main.py` | ~189-193, ~491-495, ~709-715, ~858-862, ~968-972 | 5 |
| `composite/routes.py` | 903-909 | 1 |
| `analysis/routes.py` | 214-220, 405-409, 475-479, 607-611, 777-783 | 5 |
| `mosaic/routes.py` | 500-504, 637-643, 755-762 | 3 |
| **Total** | | **14** |

## Step 4: Convert domain re-raises to MosaicError

**`mosaic/mosaic_engine.py`:**
- Line 128-129: `raise ValueError(...)` → `raise MosaicError(...)` 
- Line 163-164: `raise ValueError(...)` → `raise MosaicError(...)`

## Step 5: Narrow inner exception handlers

| File | Line | Current | Replace with |
|------|------|---------|-------------|
| **composite/routes.py** | 304 | `except Exception` (stretch fallback) | `(ValueError, RuntimeError)` |
| | 349 | `except Exception` (overall stretch) | `(ValueError, RuntimeError)` |
| | 448 | `except Exception` (instrument detect) | `(ValueError, OSError)` |
| | 490 | `except Exception` (WCS) → HTTPException | Keep as HTTPException(400) — client input issue |
| | 589 | `except Exception` (combine) → HTTPException | Keep as HTTPException(400) — client input issue |
| **analysis/routes.py** | 79, 87, 98 | `_serialize_cell()` 3× | `(ValueError, TypeError, OverflowError, UnicodeDecodeError)` |
| | 119, 123 | `_safe_str()` 2× | `(ValueError, TypeError, UnicodeDecodeError)` |
| | 311 | background fallback | `(ValueError, RuntimeError)` |
| | 561 | search filter | `(ValueError, TypeError)` |
| | 572 | sort | `(ValueError, TypeError)` |
| | 655 | array serialize | `(ValueError, TypeError, UnicodeDecodeError)` |
| **mosaic/routes.py** | 320 | stretch fallback | `(ValueError, RuntimeError)` |
| **semantic/embedding_service.py** | 79 | index loading | `(OSError, json.JSONDecodeError)` |
| | 138 | encoding | `(ValueError, RuntimeError)` |
| **processing/detection.py** | 154 | deblend | `(ValueError, RuntimeError)` |
| **processing/analysis.py** | 68 | full analysis | `(ValueError, TypeError, OSError)` |
| **main.py** | ~166 | thumbnail zscale | `(ValueError, RuntimeError)` |
| | ~372, ~619 | smooth fallbacks | `(ValueError, RuntimeError)` |
| | ~392, ~651 | stretch fallbacks | `(ValueError, RuntimeError)` |

## Step 6: Files NOT touched (intentional)

- `processing/utils.py:47,79` — broad catches kept per #961 decision
- `processing/pipeline.py:193` — generic executor, steps can raise anything
- `processing/background.py:87` — already a re-raise, correct as-is
- `storage/temp_cache.py:115` — `suppress(OSError)` is correct
- All `mast/` files — deferred to PR 2

## Step 7: Tests

**New: `tests/test_exceptions.py`** — unit tests for hierarchy:
- Each class has correct `status_code` and `error_type`
- Inheritance chain works (`StoragePermissionError` isinstance `StorageError` and `ProcessingEngineError`)
- Message passthrough and status_code override

**New: `tests/test_error_middleware.py`** — integration tests with synthetic FastAPI app:
- `ProcessingEngineError` → structured JSON 500
- `StorageNotFoundError` → structured JSON 404
- `StoragePermissionError` → structured JSON 403
- Unhandled `RuntimeError` → generic 500, no leaked internals
- `HTTPException(400)` → passes through unchanged (backward compat)
- `detail` field always present (critical for .NET backend)

## Step 8: Docs

- `docs/key-files.md` — add `processing-engine/app/exceptions.py`

## Implementation order

1. Create `app/exceptions.py` (hierarchy + handlers)
2. Create `tests/test_exceptions.py`
3. Register middleware in `main.py` and `main_mast.py`
4. Create `tests/test_error_middleware.py`
5. Remove top-level route boilerplate (14 blocks)
6. Convert `mosaic_engine.py` re-raises to MosaicError
7. Narrow all inner handlers (Steps 5 table)
8. Run full test suite
9. Update docs

## Verification

```bash
docker compose -f docker/docker-compose.yml up -d --build --force-recreate processing-engine
docker exec jwst-processing python -m pytest -v
```

- All existing tests pass (no behavior change at HTTP level)
- New test files pass
- `grep -c "except Exception" processing-engine/app/` count drops from 71 to ~34 (MAST layer remaining)

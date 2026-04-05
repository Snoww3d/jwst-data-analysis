# Plan: #959 PR 2 — MAST Layer Exception Narrowing

## Context

PR 1 (#983) landed the exception hierarchy and middleware. 37 broad `except Exception` handlers remain in the MAST layer across 5 files. This PR completes #959 by adding MAST-specific exception subtypes and narrowing all 37 catches.

## Step 1: Add MAST exception subtypes to exceptions.py

Uncomment and implement the MAST stubs in `processing-engine/app/exceptions.py`:

```python
class MASTServiceError(ProcessingEngineError):
    status_code = 502
    error_type = "MASTServiceError"

class MASTTimeoutError(MASTServiceError):
    status_code = 504
    error_type = "MASTTimeoutError"

class MASTNotFoundError(MASTServiceError):
    status_code = 404
    error_type = "MASTNotFoundError"

class MASTRateLimitError(MASTServiceError):
    status_code = 429
    error_type = "MASTRateLimitError"
```

Add tests to existing `tests/test_exceptions.py` and `tests/test_error_middleware.py`.

## Step 2: Narrow mast_service.py (16 instances)

This file uses `astroquery.mast.Observations` which internally uses `requests`.

**LOG-AND-RE-RAISE (5 — wrap in MASTServiceError):**
- Lines 259, 303, 341, 375, 433 — search methods that log + `raise`
- Change: `except Exception as e:` → `except Exception as e:` + wrap: `raise MASTServiceError(str(e)) from e`
- Keep the catch broad here since astroquery can raise anything (`requests.ConnectionError`, `ValueError`, `KeyError`, etc.) — the value is wrapping in `MASTServiceError` so the middleware returns structured 502

**SILENT/FALLBACK (1):**
- Line 193: `_resolve_target_coordinates` — tries name variants, logs debug, continues loop
- Change: `except Exception as exc:` → `except (ValueError, KeyError, OSError) as exc:` (astropy name resolution failures)

**LOG-AND-RETURN (10):**
- Lines 513, 566, 659: download methods returning `{"status": "failed"}` dicts
- Change: `except Exception as e:` → `except Exception as e:` — keep broad, but set error in return dict (these are background operations where we need to capture ALL errors). The return dict is the error channel, not exceptions.
- Line 642: inner download loop, logs warning, continues — `except Exception as e:` → keep broad (per-file download, must not crash the loop)
- Line 681: `get_product_count` returns 0 — `except Exception as e:` → keep broad (convenience counter)
- Lines 807, 838, 949, 995: verify these exist and classify

**Actually, let me recount.** The audit found these remaining:
- 807: `get_download_urls` — keep broad (URL building)
- 838: `_get_s3_uri` — narrower context, `(ValueError, KeyError)`
- 949: `_extract_downloaded_files` — file I/O, `(OSError, ValueError)`
- 995: `_safe_obs_dir` — path validation, `(OSError, ValueError)`

## Step 3: Remove route boilerplate from mast/routes.py (7 top-level handlers)

Routes already catch `asyncio.TimeoutError` → HTTPException(504). The residual `except Exception` → HTTPException(500) is boilerplate now that middleware handles it.

Remove the `except Exception as e: raise HTTPException(500, ...)` blocks AND the `try:` from:
- Line 169: `search_by_target`
- Line 209: `search_by_coordinates`
- Line 241: `search_by_observation_id`
- Line 273: `search_by_program_id`
- Line 328: `search_recent_releases`
- Line 350: `get_data_products`
- Line 407: `download_observation`

**Keep the `asyncio.TimeoutError` catches** — these provide user-friendly 504 messages. Convert them from `raise HTTPException(504, ...)` to `raise MASTTimeoutError(...)` so the middleware handles them consistently.

## Step 4: Narrow mast/routes.py background task catches (4 instances)

These are NOT route handlers — they're background `asyncio.create_task` functions:
- Line 489: `_run_download_job` — `except Exception as e:` → keep broad (background job, must capture all errors to `download_tracker.fail_job()`)
- Line 942: `_run_chunked_download_job` — same reasoning, keep broad
- Line 961: cleanup block — `except Exception as cleanup_error:` → `(OSError, json.JSONDecodeError, ValueError)`
- Line 1144: `_run_s3_download_job` — same as 489, keep broad

## Step 5: Narrow download_state_manager.py (7 instances)

All JSON file I/O:
- Lines 145, 196, 216: save/load/delete state — `(OSError, json.JSONDecodeError, ValueError)`
- Line 260: `get_resumable_jobs` — `(OSError, ValueError)`
- Line 325: cleanup inner loop — `(json.JSONDecodeError, OSError, ValueError)`
- Line 328: cleanup outer — `(OSError,)`
- Line 374: orphan cleanup — `(OSError,)`

## Step 6: Narrow chunked_downloader.py (2 instances)

- Line 222: `get_file_size` — `(aiohttp.ClientError, asyncio.TimeoutError, ValueError)`
- Line 372: `download_file_chunked` — `(aiohttp.ClientError, asyncio.TimeoutError, OSError)`

## Step 7: Narrow s3_downloader.py (1 instance)

- Line 198: per-file download — keep broad. Already has a specific `botocore.exceptions.ClientError` catch above it. The residual `except Exception` is for truly unexpected errors in the S3 download path. Similar reasoning to background job catches.

## Files NOT touched

- `processing/utils.py`, `processing/pipeline.py`, `processing/background.py`, `storage/temp_cache.py` — per PR 1 decisions

## Summary of approach

| Category | Count | Action |
|----------|-------|--------|
| Top-level route boilerplate | 7 | Remove (middleware handles) |
| Log-and-re-raise (service) | 5 | Wrap in MASTServiceError |
| File I/O (state manager) | 7 | Narrow to `(OSError, json.JSONDecodeError, ValueError)` |
| HTTP helpers (downloader) | 2 | Narrow to `(aiohttp.ClientError, asyncio.TimeoutError, ...)` |
| Background job catches | 3 | Keep broad (must capture all to tracker) |
| Download returns | ~10 | Keep broad where return dict is error channel |
| Silent fallbacks | 3 | Narrow to specific types |
| **Total** | **37** | |

**Net narrowed**: ~17 of 37. The remaining ~20 are intentionally broad (background jobs, download error returns, astroquery wrapping).

## Verification

```bash
docker compose -f docker/docker-compose.yml up -d --build --force-recreate processing-engine
docker exec jwst-processing python -m pytest -v
```

- All existing tests pass
- New MAST exception tests pass
- `grep -c "except Exception" processing-engine/app/` drops to ~28 (intentionally broad: 20 MAST + 8 from PR 1)

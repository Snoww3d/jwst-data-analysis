# Plan: Bounded LRU cache for `data/mast` (feature/mast-cache-lru-eviction)

## Context

`data/mast` grows without bound. `Observations.download_products(..., cache=True)` and
the chunked/S3 downloaders accumulate FITS forever; a dev laptop reached ~195 GB / 95%
disk. `STATE_RETENTION_DAYS = 7` in `app/mast/download_state_manager.py` prunes only the
`.download_state/` JSON, never the science data.

A working atime-LRU evictor with a byte budget already exists in
`app/storage/temp_cache.py` (`TempFileCache.evict_if_needed`), but it is reachable only
under `STORAGE_PROVIDER=s3`, while the deployment default is `local`
(`app/storage/factory.py`). The algorithm is sound; only its reach is wrong.

## Approach

Extract the algorithm once, then apply it to the MAST download dir with a stronger
protection story (pins + in-flight files). No second evictor, no background thread.

### 1. `app/storage/lru_evictor.py` (new) — the shared algorithm

- `EvictionResult` dataclass: `evicted_count`, `bytes_freed`, `remaining_bytes`,
  `max_bytes`, `failed_count`, `within_budget`.
- `evict_to_budget(candidates, max_bytes, *, is_protected=None, label="cache")`.
  - Stats every candidate once. Protected files still count toward the budget (they
    occupy disk) but are never unlinked.
  - Sorts evictable files by `st_atime`, oldest first.
  - Logs each eviction at INFO with path + size, then a summary (count, bytes freed,
    resulting size, budget).
- `TempFileCache.evict_if_needed()` delegates to it and keeps its `bool` return, so S3
  behaviour is unchanged.

### 2. `app/mast/cache.py` (new) — `MastCache`

Env-driven, read at construction:

| Var | Default | Meaning |
|-----|---------|---------|
| `MAST_CACHE_ENABLED` | `false` | Opt-in. Disabled is a true no-op — no stat, no walk. |
| `MAST_CACHE_MAX_BYTES` | `64424509440` (60 GB) | Byte budget for FITS under the download dir. |
| `MAST_CACHE_PIN_MANIFEST` | *(unset)* | Path to a newline-separated list of paths that must never be evicted. |

Candidate selection — evict only FITS data files under the MAST download dir:

- must resolve inside `download_dir`
- suffix in `.fits` / `.fit` / `.fits.gz` / `.fits.bz2` (a `.part` file therefore never
  qualifies — its suffix is `.part`)
- no path component starting with `.` (excludes `.download_state/` and every other
  hidden bookkeeping dir)

Protection predicates, applied on top:

- `is_pinned(path)` — **the extension point.** Initial implementation: the path is
  listed in the manifest at `MAST_CACHE_PIN_MANIFEST`. The rule will soon become "all
  data referenced by any CE recipe"; that is a one-function change, flagged in a comment.
- in-flight: any `local_path` (and its `.part` sibling) currently registered by a live
  downloader.

### 3. In-flight visibility

`ChunkedDownloader` and `S3Downloader` gain `self._job_state`, set at the top of
`download_files`, exposed as a read-only `job_state` property. `routes.py` builds the
in-flight set from `_active_downloaders` / `_active_s3_downloaders` and passes it to
`MastCache` as a callable, so the set is read fresh at each eviction.

### 4. Trigger

In the `finally` of `_run_chunked_download_job` and `_run_s3_download_job`, next to the
existing state cleanup, via `asyncio.to_thread` so the event loop is not blocked. No
timer thread.

### 5. Docs

`docker/.env.example` and `docs/setup-guide.md` gain the three new vars, documented as
opt-in with the re-downloadable caveat.

## Safety

Everything evicted is re-downloadable from MAST. Never touched: `.download_state/`,
`.part` files, in-flight downloads, pinned files, non-FITS. Tests run against tmp dirs
only — the real `data/mast` is never a test subject.

## Tests — `tests/test_mast_cache.py`

- disabled by default is a true no-op (nothing deleted, directory not even walked)
- budget respected once enabled
- LRU order is by access time, oldest evicted first
- pinned files (manifest) survive even when they are the oldest
- `.part` files, `.download_state/` contents, and in-flight `local_path`s never evicted
- non-FITS files ignored
- eviction never escapes the download dir
- `EvictionResult` summary numbers are accurate

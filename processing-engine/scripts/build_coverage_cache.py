"""
Build the JWST sky-coverage snapshot (MAST Search v2 Phase 5) ahead of time.

The engine builds it lazily on the first `GET /mast/coverage` (≈45 s of
paged MAST queries) and refreshes it once a day. Running this at image
build time (CE: `PREFETCH_COVERAGE=true`) or on a host with network gives
an instant, offline-capable empty-state map; the engine then serves the
file (stale-flagged after 24 h) and refreshes in the background when it can.

Usage (inside the processing-engine container, or with its requirements):
    python scripts/build_coverage_cache.py --out /app/coverage/mast-coverage.json
    python scripts/build_coverage_cache.py            # writes MAST_COVERAGE_FILE / data/mast-coverage.json
    python scripts/build_coverage_cache.py --allow-failure   # exit 0 even if MAST is unreachable

Exit status: 0 on success; 1 on failure unless --allow-failure (Docker builds
must not fail because MAST is down).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.mast.coverage import CoverageStore, default_coverage_file  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger("build_coverage_cache")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--out", type=Path, default=None, help="snapshot path (default: MAST_COVERAGE_FILE)"
    )
    parser.add_argument(
        "--allow-failure",
        action="store_true",
        help="exit 0 when MAST is unreachable (image builds)",
    )
    args = parser.parse_args(argv)
    out = args.out or default_coverage_file()
    try:
        snap = CoverageStore(path=out).refresh_now()
    except Exception as exc:  # noqa: BLE001 — CLI: report and choose the exit code
        logger.error("coverage snapshot NOT built: %s", exc)
        return 0 if args.allow_failure else 1
    size = out.stat().st_size if out.exists() else 0
    logger.info(
        "coverage snapshot written: %s (%d rows, %d cells, %.1f MB)",
        out,
        len(snap.rows),
        len(snap.cells),
        size / 1e6,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Shared diagnostics utilities for memory monitoring and debugging."""

import logging
import sys

import psutil


logger = logging.getLogger(__name__)


def log_memory(stage: str) -> None:
    """Log current process memory usage and flush immediately.

    When the process is OOM-killed, buffered logs are lost. Flushing after
    each memory log ensures we can see the last known memory state before
    the kill.
    """
    proc = psutil.Process()
    rss_mb = proc.memory_info().rss / (1024 * 1024)
    logger.info(f"[memory] {stage}: RSS={rss_mb:.0f} MB")
    sys.stdout.flush()
    sys.stderr.flush()

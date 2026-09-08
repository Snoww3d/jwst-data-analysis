"""Shared diagnostics utilities for memory monitoring and debugging."""

import logging
import sys
from pathlib import Path

import numpy as np
import psutil


logger = logging.getLogger(__name__)


def available_memory_bytes() -> int:
    """Return host availability capped by remaining cgroup v2 memory, if limited."""
    available = psutil.virtual_memory().available
    try:
        limit = int(Path("/sys/fs/cgroup/memory.max").read_text().strip())
        used = int(Path("/sys/fs/cgroup/memory.current").read_text().strip())
        if limit >= 0 and used >= 0:
            available = min(available, max(0, limit - used))
    except (OSError, ValueError):
        # Non-Linux hosts, unlimited ("max") cgroups, or unavailable counters.
        pass
    return available


def check_zoom_memory(data: np.ndarray) -> None:
    """Budget input, output and working arrays for downsampling with 20% headroom.

    This is a conservative snapshot, not a reservation against concurrent work.
    """
    required = data.size * data.itemsize * 3
    available = available_memory_bytes()
    if required > 0.8 * available:
        raise MemoryError(
            f"Downsampling needs an estimated {required} bytes; "
            f"available memory is {available} bytes"
        )


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

"""
Resolve MAST observation metadata into S3 key paths.

The STScI public S3 bucket mirrors MAST at::

    s3://stpubdata/jwst/public/{program_id}/{obs_id}/{filename}

where *program_id* is the 5-digit proposal/program number (zero-padded).
"""

from __future__ import annotations

import logging
import re
from typing import Any


logger = logging.getLogger(__name__)

# S3 key prefix for JWST public data
S3_PREFIX = "jwst/public"

# Pattern to extract program id from a JWST filename (e.g. jw02733...)
_PROGRAM_FROM_FILENAME = re.compile(r"^jw(\d{5})", re.IGNORECASE)

# Pattern to extract program id from an obs_id (e.g. jw02733-o001_t001_nircam...)
_PROGRAM_FROM_OBS_ID = re.compile(r"^jw(\d{5})", re.IGNORECASE)


def resolve_s3_key(
    filename: str, obs_id: str | None = None, program_id: str | None = None
) -> str | None:
    """Build an S3 key for a single FITS file.

    Args:
        filename: The product filename (e.g. ``jw02733-o001_t001_nircam_clear-f090w_i2d.fits``).
        obs_id: MAST observation ID. Used to build the directory component.
        program_id: Numeric program / proposal ID (e.g. ``"2733"`` or ``"02733"``).
            If not provided it is extracted from the filename.

    Returns:
        The S3 key string, or ``None`` if the program ID cannot be determined.
    """
    # Determine program_id
    pid = _extract_program_id(program_id, obs_id, filename)
    if pid is None:
        logger.warning("Cannot determine program ID for file %s", filename)
        return None

    # Zero-pad to 5 digits
    pid_padded = pid.zfill(5)

    # Build key: jwst/public/{program_id}/{filename}
    # Note: STScI uses a flat structure per program -- the filename itself is unique.
    s3_key = f"{S3_PREFIX}/{pid_padded}/{filename}"
    return s3_key


def resolve_s3_keys_from_products(product_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Resolve S3 keys for a list of MAST data products.

    Each product dict should contain at least ``productFilename``.
    It may also contain ``obs_id`` and ``proposal_id``.

    Args:
        product_list: List of product dicts from MAST.

    Returns:
        A new list of dicts, each augmented with an ``s3_key`` field.
        Products where the key cannot be resolved are excluded.
    """
    resolved: list[dict[str, Any]] = []
    for product in product_list:
        filename = product.get("productFilename") or product.get("filename", "")
        obs_id = product.get("obs_id", "")
        proposal_id = product.get("proposal_id", "")

        s3_key = resolve_s3_key(
            filename=filename,
            obs_id=obs_id,
            program_id=str(proposal_id) if proposal_id else None,
        )

        if s3_key is not None:
            resolved.append({**product, "s3_key": s3_key})
        else:
            logger.warning("Skipping product without resolvable S3 key: %s", filename)

    logger.info(
        "Resolved %d / %d products to S3 keys",
        len(resolved),
        len(product_list),
    )
    return resolved


def _extract_program_id(
    program_id: str | None,
    obs_id: str | None,
    filename: str,
) -> str | None:
    """Try to determine the program ID from multiple sources."""
    # Explicit program_id takes priority
    if program_id:
        # Strip any non-digit prefix (e.g. "jw02733" -> "02733")
        digits = re.sub(r"\D", "", program_id)
        if digits:
            return digits

    # Try to extract from obs_id
    if obs_id:
        m = _PROGRAM_FROM_OBS_ID.match(obs_id)
        if m:
            return m.group(1)

    # Try to extract from filename
    m = _PROGRAM_FROM_FILENAME.match(filename)
    if m:
        return m.group(1)

    return None

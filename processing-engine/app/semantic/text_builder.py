"""Transform structured FITS metadata into natural language text for embedding.

The key insight: we embed prose, not raw headers. This means semantic queries
like "deep exposure" match high exposure_time, "raw data" matches L1, and
"infrared" matches the right wavelength ranges.
"""

from .models import FileMetadata


# Mapping from filter prefixes to human-readable descriptions
FILTER_DESCRIPTIONS: dict[str, str] = {
    "F070W": "0.7 micron wide-band",
    "F090W": "0.9 micron wide-band",
    "F115W": "1.15 micron wide-band",
    "F150W": "1.5 micron wide-band",
    "F200W": "2.0 micron wide-band",
    "F277W": "2.77 micron wide-band",
    "F356W": "3.56 micron wide-band",
    "F444W": "4.44 micron wide-band",
    "F560W": "5.6 micron wide-band",
    "F770W": "7.7 micron wide-band",
    "F1000W": "10 micron wide-band",
    "F1130W": "11.3 micron wide-band",
    "F1280W": "12.8 micron wide-band",
    "F1500W": "15 micron wide-band",
    "F1800W": "18 micron wide-band",
    "F2100W": "21 micron wide-band",
    "F2550W": "25.5 micron wide-band",
}

INSTRUMENT_DESCRIPTIONS: dict[str, str] = {
    "NIRCAM": "Near-Infrared Camera",
    "MIRI": "Mid-Infrared Instrument",
    "NIRSPEC": "Near-Infrared Spectrograph",
    "NIRISS": "Near-Infrared Imager and Slitless Spectrograph",
    "FGS": "Fine Guidance Sensor",
}

PROCESSING_LEVEL_DESCRIPTIONS: dict[str, str] = {
    "L1": "raw uncalibrated detector readout",
    "L2a": "count rate image (partially processed)",
    "L2b": "fully calibrated individual exposure",
    "L3": "combined/mosaicked science product",
    "unknown": "unclassified processing level",
}

WAVELENGTH_DESCRIPTIONS: dict[str, str] = {
    "INFRARED": "infrared wavelength",
    "NEAR-IR": "near-infrared wavelength",
    "MID-IR": "mid-infrared wavelength",
    "OPTICAL": "optical/visible wavelength",
    "UV": "ultraviolet wavelength",
}


def _describe_exposure(seconds: float | None) -> str:
    """Describe exposure time in human-readable terms."""
    if seconds is None:
        return ""
    if seconds < 10:
        return f"Short exposure ({seconds:.1f}s)."
    if seconds < 120:
        return f"Medium exposure ({seconds:.0f}s)."
    if seconds < 600:
        return f"Long exposure ({seconds:.0f}s)."
    return f"Very long/deep exposure ({seconds:.0f}s)."


def build_text(metadata: FileMetadata) -> str:
    """Build natural language description from FITS metadata.

    Example output:
        "NIRCam (Near-Infrared Camera) image of NGC-6804 through F444W
        (4.44 micron wide-band) filter. Very long/deep exposure (1200s).
        Infrared wavelength. Calibration level 3: combined/mosaicked
        science product. Observed 2023-07-15. PI: Dr. Smith.
        Program: Pillars of Creation Survey."
    """
    parts: list[str] = []

    # Instrument + target
    instrument = metadata.instrument or ""
    instrument_desc = INSTRUMENT_DESCRIPTIONS.get(instrument.upper(), "")
    target = metadata.target_name or "unknown target"

    if instrument and instrument_desc:
        parts.append(f"{instrument} ({instrument_desc}) image of {target}")
    elif instrument:
        parts.append(f"{instrument} image of {target}")
    else:
        parts.append(f"Image of {target}")

    # Filter
    filter_name = metadata.filter_name or ""
    if filter_name:
        filter_upper = filter_name.upper()
        filter_desc = FILTER_DESCRIPTIONS.get(filter_upper, "")
        if filter_desc:
            parts.append(f"through {filter_name} ({filter_desc}) filter")
        else:
            parts.append(f"through {filter_name} filter")

    # Join instrument/target/filter as one sentence
    sentence = " ".join(parts) + "."
    sentences = [sentence]

    # Exposure time
    exp_desc = _describe_exposure(metadata.exposure_time)
    if exp_desc:
        sentences.append(exp_desc)

    # Wavelength
    wr = (metadata.wavelength_range or "").upper()
    wr_desc = WAVELENGTH_DESCRIPTIONS.get(wr, "")
    if wr_desc:
        sentences.append(f"{wr_desc.capitalize()}.")

    # Processing level / calibration
    pl = metadata.processing_level or ""
    pl_desc = PROCESSING_LEVEL_DESCRIPTIONS.get(pl, "")
    if pl_desc:
        cal = metadata.calibration_level
        if cal is not None:
            sentences.append(f"Calibration level {cal}: {pl_desc}.")
        else:
            sentences.append(f"Processing level {pl}: {pl_desc}.")

    # Data type
    dt = metadata.data_type or ""
    if dt and dt not in ("image",):
        sentences.append(f"Data type: {dt}.")

    # Observation date
    if metadata.observation_date:
        sentences.append(f"Observed {metadata.observation_date}.")

    # PI
    if metadata.proposal_pi:
        sentences.append(f"PI: {metadata.proposal_pi}.")

    # Program / proposal
    if metadata.observation_title:
        sentences.append(f"Program: {metadata.observation_title}.")
    elif metadata.proposal_id:
        sentences.append(f"Proposal ID: {metadata.proposal_id}.")

    # File name (can help with specific file searches)
    if metadata.file_name:
        sentences.append(f"File: {metadata.file_name}.")

    return " ".join(sentences)

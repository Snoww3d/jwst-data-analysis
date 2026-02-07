"""AVM (Astronomy Visualization Metadata) XMP embedding for exported images.

Implements the AVM 1.2 standard for embedding astronomical metadata into
PNG and JPEG images. This allows exported images to carry WCS coordinates,
observation details, and instrument information that tools like
WorldWide Telescope and Aladin can read.

Reference: https://www.virtualastronomy.org/avm_metadata.php
"""

import io
import json
import logging
import math
import xml.etree.ElementTree as ET

from PIL import Image, PngImagePlugin


logger = logging.getLogger(__name__)

# AVM 1.2 XMP namespace URIs
NS_X = "adobe:ns:meta/"
NS_RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
NS_DC = "http://purl.org/dc/elements/1.1/"
NS_AVM = "http://www.communicatingastronomy.org/avm/1.0/"
NS_PHOTOSHOP = "http://ns.adobe.com/photoshop/1.0/"


def _build_xmp_packet(metadata: dict) -> str:
    """Build an XMP packet string conforming to AVM 1.2.

    Args:
        metadata: Dictionary with optional keys:
            - ra: float, reference RA in degrees
            - dec: float, reference Dec in degrees
            - scale_x: float, pixel scale in degrees/pixel (axis 1)
            - scale_y: float, pixel scale in degrees/pixel (axis 2)
            - rotation: float, image rotation in degrees
            - coordinate_frame: str, e.g. "ICRS", "FK5"
            - target_name: str, astronomical object name
            - instrument: str, instrument name
            - filter: str, filter name
            - facility: str, telescope/facility name
            - description: str, image description
            - publisher: str, publisher/creator name
            - spectral_band: str, e.g. "Infrared", "Optical"

    Returns:
        XMP packet as a string ready for embedding.
    """
    # Register namespaces to avoid ns0/ns1 prefixes
    ET.register_namespace("x", NS_X)
    ET.register_namespace("rdf", NS_RDF)
    ET.register_namespace("dc", NS_DC)
    ET.register_namespace("avm", NS_AVM)
    ET.register_namespace("photoshop", NS_PHOTOSHOP)

    # Root xpacket wrapper
    xmpmeta = ET.Element(f"{{{NS_X}}}xmpmeta")
    rdf = ET.SubElement(xmpmeta, f"{{{NS_RDF}}}RDF")
    desc = ET.SubElement(rdf, f"{{{NS_RDF}}}Description")

    # Dublin Core: title / description
    if metadata.get("target_name"):
        title_elem = ET.SubElement(desc, f"{{{NS_DC}}}title")
        alt = ET.SubElement(title_elem, f"{{{NS_RDF}}}Alt")
        li = ET.SubElement(alt, f"{{{NS_RDF}}}li")
        li.set("xml:lang", "x-default")
        li.text = metadata["target_name"]

    if metadata.get("description"):
        desc_elem = ET.SubElement(desc, f"{{{NS_DC}}}description")
        alt = ET.SubElement(desc_elem, f"{{{NS_RDF}}}Alt")
        li = ET.SubElement(alt, f"{{{NS_RDF}}}li")
        li.set("xml:lang", "x-default")
        li.text = metadata["description"]

    if metadata.get("publisher"):
        creator = ET.SubElement(desc, f"{{{NS_DC}}}creator")
        seq = ET.SubElement(creator, f"{{{NS_RDF}}}Seq")
        li = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li.text = metadata["publisher"]

    # AVM Spatial fields
    coord_frame = metadata.get("coordinate_frame", "ICRS")
    ET.SubElement(desc, f"{{{NS_AVM}}}Spatial.CoordinateFrame").text = coord_frame
    ET.SubElement(desc, f"{{{NS_AVM}}}Spatial.Equinox").text = "J2000"
    ET.SubElement(desc, f"{{{NS_AVM}}}Spatial.CoordsystemProjection").text = "TAN"

    if metadata.get("ra") is not None and metadata.get("dec") is not None:
        ref_val = ET.SubElement(desc, f"{{{NS_AVM}}}Spatial.ReferenceValue")
        seq = ET.SubElement(ref_val, f"{{{NS_RDF}}}Seq")
        li_ra = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li_ra.text = str(float(metadata["ra"]))
        li_dec = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li_dec.text = str(float(metadata["dec"]))

    if metadata.get("scale_x") is not None and metadata.get("scale_y") is not None:
        scale = ET.SubElement(desc, f"{{{NS_AVM}}}Spatial.Scale")
        seq = ET.SubElement(scale, f"{{{NS_RDF}}}Seq")
        li_x = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li_x.text = str(float(metadata["scale_x"]))
        li_y = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li_y.text = str(float(metadata["scale_y"]))

    if metadata.get("rotation") is not None:
        ET.SubElement(desc, f"{{{NS_AVM}}}Spatial.Rotation").text = str(float(metadata["rotation"]))

    # AVM Subject fields
    if metadata.get("target_name"):
        subj_name = ET.SubElement(desc, f"{{{NS_AVM}}}Subject.Name")
        seq = ET.SubElement(subj_name, f"{{{NS_RDF}}}Seq")
        li = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li.text = metadata["target_name"]

    # AVM Observation fields
    if metadata.get("facility"):
        fac = ET.SubElement(desc, f"{{{NS_AVM}}}Facility")
        seq = ET.SubElement(fac, f"{{{NS_RDF}}}Seq")
        li = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li.text = metadata["facility"]

    if metadata.get("instrument"):
        inst = ET.SubElement(desc, f"{{{NS_AVM}}}Instrument")
        seq = ET.SubElement(inst, f"{{{NS_RDF}}}Seq")
        li = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li.text = metadata["instrument"]

    if metadata.get("filter"):
        filt = ET.SubElement(desc, f"{{{NS_AVM}}}Spectral.CentralWavelength")
        seq = ET.SubElement(filt, f"{{{NS_RDF}}}Seq")
        li = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li.text = metadata["filter"]

    if metadata.get("spectral_band"):
        band = ET.SubElement(desc, f"{{{NS_AVM}}}Spectral.Band")
        seq = ET.SubElement(band, f"{{{NS_RDF}}}Seq")
        li = ET.SubElement(seq, f"{{{NS_RDF}}}li")
        li.text = metadata["spectral_band"]

    # Photoshop: credit / source
    if metadata.get("publisher"):
        ET.SubElement(desc, f"{{{NS_PHOTOSHOP}}}Credit").text = metadata["publisher"]
    ET.SubElement(desc, f"{{{NS_PHOTOSHOP}}}Source").text = "James Webb Space Telescope"

    # Serialize to string
    xml_bytes = ET.tostring(xmpmeta, encoding="unicode", xml_declaration=False)

    # Wrap in standard XMP packet processing instructions
    xmp_packet = (
        '<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        + xml_bytes
        + "\n<?xpacket end='w'?>"
    )
    return xmp_packet


def embed_avm_xmp(
    image_bytes: bytes,
    image_format: str,
    metadata: dict,
) -> bytes:
    """Embed AVM XMP metadata into a PNG or JPEG image.

    Args:
        image_bytes: The raw image bytes (PNG or JPEG).
        image_format: "png" or "jpeg".
        metadata: AVM metadata dictionary (see _build_xmp_packet for keys).

    Returns:
        New image bytes with AVM XMP metadata embedded.
    """
    xmp_packet = _build_xmp_packet(metadata)
    logger.info(f"Embedding AVM metadata: {list(metadata.keys())}")

    img = Image.open(io.BytesIO(image_bytes))

    output = io.BytesIO()

    if image_format == "png":
        # For PNG, add XMP as a tEXt chunk with key "XML:com.adobe.xmp"
        png_info = PngImagePlugin.PngInfo()
        png_info.add_text("XML:com.adobe.xmp", xmp_packet)
        # Preserve existing PNG metadata if present
        if hasattr(img, "info"):
            for key, value in img.info.items():
                if key != "XML:com.adobe.xmp" and isinstance(value, str):
                    png_info.add_text(key, value)
        img.save(output, format="PNG", pnginfo=png_info)
    elif image_format == "jpeg":
        # For JPEG, embed XMP via the xmp keyword argument
        xmp_bytes = xmp_packet.encode("utf-8")
        # Ensure RGB mode for JPEG
        if img.mode == "RGBA":
            background = Image.new("RGB", img.size, (0, 0, 0))
            background.paste(img, mask=img.split()[3])
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.save(output, format="JPEG", quality=95, xmp=xmp_bytes)
    else:
        logger.warning(f"AVM embedding not supported for format: {image_format}")
        return image_bytes

    result = output.getvalue()
    logger.info(f"AVM embedded: {len(image_bytes)} -> {len(result)} bytes ({image_format})")
    return result


def extract_wcs_for_avm(
    header: dict,
    original_width: int,
    original_height: int,
    output_width: int,
    output_height: int,
) -> dict:
    """Extract and scale WCS parameters from a FITS header for AVM embedding.

    The preview image is typically resized from the original FITS dimensions,
    so we need to adjust CRPIX and CDELT/CD matrix values accordingly.

    Args:
        header: FITS header (dict-like).
        original_width: Original FITS image width in pixels.
        original_height: Original FITS image height in pixels.
        output_width: Output preview image width in pixels.
        output_height: Output preview image height in pixels.

    Returns:
        Dictionary with AVM-ready WCS fields, or empty dict if WCS not available.
    """
    try:
        crpix1 = float(header.get("CRPIX1", 0))
        crval1 = float(header.get("CRVAL1", 0))
        crval2 = float(header.get("CRVAL2", 0))

        # Check we have meaningful WCS
        if crpix1 == 0 and crval1 == 0:
            return {}

        # Get pixel scale from CD matrix or CDELT
        cd1_1 = float(header.get("CD1_1", header.get("CDELT1", 0)))
        cd2_1 = float(header.get("CD2_1", 0))
        cd2_2 = float(header.get("CD2_2", header.get("CDELT2", 0)))

        if cd1_1 == 0 and cd2_2 == 0:
            return {}

        # Compute scale ratios for the resize
        scale_x = original_width / output_width if output_width > 0 else 1.0
        scale_y = original_height / output_height if output_height > 0 else 1.0

        # Adjust pixel scale (degrees/pixel becomes larger when image is smaller)
        scaled_cd1_1 = cd1_1 * scale_x
        scaled_cd2_1 = cd2_1 * scale_x
        scaled_cd2_2 = cd2_2 * scale_y

        # Compute rotation from CD matrix (degrees, measured N through E)
        rotation = math.degrees(math.atan2(-scaled_cd2_1, scaled_cd2_2))

        # Coordinate frame from CTYPE
        ctype1 = str(header.get("CTYPE1", ""))
        coord_frame = "ICRS"
        if "FK5" in ctype1.upper():
            coord_frame = "FK5"
        elif "FK4" in ctype1.upper():
            coord_frame = "FK4"
        elif "GAL" in ctype1.upper():
            coord_frame = "GAL"

        return {
            "ra": crval1,
            "dec": crval2,
            "scale_x": scaled_cd1_1,
            "scale_y": scaled_cd2_2,
            "rotation": rotation,
            "coordinate_frame": coord_frame,
        }

    except (ValueError, KeyError, TypeError) as e:
        logger.warning(f"Could not extract WCS for AVM: {e}")
        return {}


def parse_avm_metadata_json(avm_metadata_json: str) -> dict:
    """Parse AVM metadata from JSON string passed via query parameter.

    Args:
        avm_metadata_json: JSON string with observation metadata from the backend.

    Returns:
        Dictionary with AVM-compatible keys.
    """
    if not avm_metadata_json:
        return {}

    try:
        raw = json.loads(avm_metadata_json)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Could not parse avm_metadata JSON")
        return {}

    result = {}

    # Map backend metadata fields to AVM keys
    if raw.get("target_name"):
        result["target_name"] = raw["target_name"]
    if raw.get("instrument"):
        result["instrument"] = raw["instrument"]
    if raw.get("filter"):
        result["filter"] = raw["filter"]
    if raw.get("description"):
        result["description"] = raw["description"]
    if raw.get("facility"):
        result["facility"] = raw["facility"]
    else:
        result["facility"] = "JWST"
    if raw.get("spectral_band"):
        result["spectral_band"] = raw["spectral_band"]
    if raw.get("publisher"):
        result["publisher"] = raw["publisher"]

    return result

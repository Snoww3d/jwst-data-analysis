# Color Mapping Research — Chromatic Ordering vs Wavelength-to-Hue

## Origin

Prompted by NASA's Feb 25, 2026 release of the Cranium Nebula (PMR 1) — [blog post](https://science.nasa.gov/missions/webb/nasas-webb-examines-cranium-nebula/). User downloaded all 8 FITS files (4 NIRCam + 4 MIRI) and attempted to recreate the composite. Result was recognizable but far from the NASA quality.

## The NASA Release

**Program 9224** (PI: M. Garcia Marin), observed March 30-31, 2025.
Image Processing: **Joseph DePasquale (STScI)** — same person behind most iconic Webb releases.

### Filter → Color assignments (from NASA)

| Filter | Wavelength | Instrument | Assigned Color |
|--------|-----------|------------|---------------|
| F150W | 1.50 µm | NIRCam | Blue |
| F187N | 1.87 µm | NIRCam | Green |
| F444W | 4.42 µm | NIRCam | Orange |
| F470N | 4.71 µm | NIRCam | Red |
| F1000W | 10.0 µm | MIRI | Blue |
| F1130W | 11.3 µm | MIRI | Green |
| F1280W | 12.8 µm | MIRI | Orange |
| F1800W | 18.0 µm | MIRI | Red |

Three images released: NIRCam-only, MIRI-only, and side-by-side comparison.

### Other observation details
- Object: PMR 1 / PN G272.8+01.0 (Exposed Cranium Nebula), planetary nebula in Vela
- Distance: 5,000 light-years
- Image size: ~2.2 arcmin (~3.2 light-years)
- Scale bar: 0.5 ly / 20 arcsec

---

## The Problem: Absolute Wavelength→Hue Mapping

Our current `wavelengthToHue()` (in both Python and TypeScript) uses a log-scale mapping across the full JWST range (0.6–28 µm). Shorter wavelengths → hue 270° (blue), longer → hue 0° (red).

### What this produces for Cranium Nebula NIRCam:

| Filter | Wavelength | Auto-Hue | Resulting Color |
|--------|-----------|----------|-----------------|
| F150W | 1.50 µm | ~204° | Cyan-blue |
| F187N | 1.87 µm | ~192° | Cyan |
| F444W | 4.42 µm | ~139° | Teal-green |
| F470N | 4.71 µm | ~135° | Green |

**Problem**: All four filters land in a narrow cyan-to-green band. The 1.5–4.7 µm range is compressed because it's a small fraction of the full 0.6–28 µm log-scale range. Result: muddy, low-contrast, greenish image.

### What this produces for Cranium Nebula MIRI:

| Filter | Wavelength | Auto-Hue | Resulting Color |
|--------|-----------|----------|-----------------|
| F1000W | 10.0 µm | ~94° | Yellow-green |
| F1130W | 11.3 µm | ~80° | Yellow |
| F1280W | 12.8 µm | ~68° | Orange-yellow |
| F1800W | 18.0 µm | ~42° | Orange |

**Problem**: Even worse clustering. All four filters land in yellow-orange. No blue, no strong red. Looks washed out.

### What NASA assigns:

NASA uses **blue, green, orange, red** in both cases — a full spectral spread regardless of absolute wavelength.

---

## The Solution: Chromatic Ordering

STScI image processors use **relative chromatic ordering** within each filter set:

1. Sort filters by wavelength (ascending)
2. Map the **shortest** to blue, **longest** to red
3. Middle filters get evenly-spaced intermediate colors
4. The specific color palette is: blue → cyan → green → yellow → orange → red

This is a **relative** mapping — it doesn't matter whether the filters span 1–5 µm or 10–18 µm. The visual spread is always the full blue-to-red range.

### Standard chromatic ordering palette (N filters)

| N | Colors |
|---|--------|
| 2 | Blue, Red |
| 3 | Blue, Green, Red |
| 4 | Blue, Green, Orange, Red |
| 5 | Blue, Cyan, Green, Orange, Red |
| 6 | Blue, Cyan, Green, Yellow, Orange, Red |
| 7 | Blue, Indigo, Cyan, Green, Yellow, Orange, Red |
| 8+ | Evenly space hues from 240° (blue) to 0° (red) |

### Suggested hue values

| N | Hues (degrees) |
|---|----------------|
| 2 | 240, 0 |
| 3 | 240, 120, 0 |
| 4 | 240, 120, 30, 0 |
| 5 | 240, 180, 120, 30, 0 |
| 6 | 240, 180, 120, 60, 30, 0 |
| N | Evenly space from 240 → 0 |

---

## Additional Quality Gaps (Beyond Color Mapping)

### Per-component normalization flattens dynamic range

`combine_channels_to_rgb()` normalizes R, G, B independently by dividing each by its max. This prevents color dominance but **flattens relative brightness** between channels. NASA images have bright white edges (all channels saturated) and strong color gradients in interiors. Our normalization compresses this.

**Potential fix**: Optional "preserve relative brightness" mode that normalizes by the global max across all three components rather than per-component.

### Stretch tuning per filter

DePasquale almost certainly uses:
- **Per-channel asinh** with different softening parameters per filter
- **Different black points per channel** to control color balance
- **Post-composite tone mapping** (S-curve on the final RGB)
- **Star treatment** — managing star halos in NIRCam wide-band filters

Our defaults (log stretch, same params for all channels) produce reasonable but untuned results.

**Potential fix for v1**: The suggestion engine recipes should include per-channel stretch presets (not just color assignments). E.g., narrowband filters (F187N, F470N) often benefit from more aggressive stretch than broadband (F150W, F444W).

### Background subtraction timing

Our `neutralize_raw_backgrounds()` does sigma-clipped median subtraction before stretch — this is correct and matches professional workflows. No gap here.

---

## Implementation Plan

### Files to modify:
- `processing-engine/app/composite/color_mapping.py` — add `chromatic_order_colors(n)` function
- `frontend/.../wavelengthUtils.ts` — add `chromaticOrderHues(n)` function, update `autoAssignNChannels()` to use it as default
- `frontend/.../CompositeTypes.ts` — add color assignment mode toggle (chromatic vs scientific/wavelength)

### Keep existing mode available
The current wavelength-to-hue mapping is still useful as a "scientific" mode — it shows actual wavelength relationships. But chromatic ordering should be the **default** for auto-assignment and all recipe presets.

### Mixed-instrument sets (NIRCam + MIRI combined)
When filters span both instruments, still sort by wavelength and apply chromatic ordering across the full set. This naturally produces the right result — NIRCam filters get the bluer end, MIRI filters get the redder end.

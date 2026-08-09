# S3 — Replace hand-rolled WCS with `astropy.wcs.WCS`

**Branch**: `fix/s3-astropy-wcs`
**Track**: S (Science) — Simplification & Science Plan, item S3
**Effort**: <1 hr · **Risk**: Low

## Problem

`render/routes.py` builds the `wcs` payload for the viewer's RA/Dec readout by
hand-reading twelve FITS keywords. It only understands the `CD` matrix and
`CDELT`; it never looks at `PC_i_j`.

Real JWST `_i2d` products carry `PC` + `CDELT` and **no `CD` keywords at all**.
Verified against `jw01192-o010_t002_miri_f560w_i2d.fits`:

```
CDELT1 = CDELT2 = 3.0808e-05
PC1_1 = -0.29512   PC1_2 = 0.95546
PC2_1 =  0.95546   PC2_2 = 0.29512     (~107 deg rotation)
```

The current code emits `cd1_1 = CDELT1`, `cd1_2 = cd2_1 = 0`,
`cd2_2 = CDELT2` — an unrotated matrix with the wrong sign on axis 1.
The correct matrix (astropy `pixel_scale_matrix`) is:

```
[[-9.0919e-06, 2.9436e-05],
 [ 2.9436e-05, 9.0919e-06]]
```

So the viewer's sky readout is wrong for every JWST image in the library — the
error grows with distance from the reference pixel and is tens of arcseconds
across a typical frame, in the wrong direction.

`processing/avm.py:extract_wcs_for_avm` has the identical defect from the same
hand-rolled parse: it derives `rotation = atan2(-cd2_1, cd2_2)`, which is always
`0` when `cd2_1` falls back to `0`. Every AVM-embedded preview claims north-up.
Same root cause, same fix — repaired in this PR rather than left next to a
correct helper.

## Approach

Add `app/science/wcs.py` — astropy parses the header, we marshal the result.
`app/science/` is the home S2a's `ScienceImage` loader will grow into.

- `celestial_wcs(header) -> WCS | None` — `WCS(header).celestial`, warnings
  suppressed, `None` when `has_celestial` is false.
- `wcs_params_from_header(header) -> dict | None` — the viewer payload, with
  `cd1_1..cd2_2` taken from `pixel_scale_matrix` (astropy resolves
  `PC`+`CDELT`, `CD`, or `CDELT`-only into one matrix) and `cdelt1/2` from
  `proj_plane_pixel_scales` (true on-sky scale magnitudes).

The payload keeps its existing shape, so `coordinateUtils.pixelToWCS` and the
`WCSParams` type are untouched. The client keeps doing the TAN inverse — hover
readout has to be interactive — it just finally gets correct inputs.

## Changes

| File | Change |
|------|--------|
| `processing-engine/app/science/__init__.py` | new package |
| `processing-engine/app/science/wcs.py` | new — `celestial_wcs`, `wcs_params_from_header` |
| `processing-engine/app/render/routes.py` | replace the 15-line hand-rolled block with `wcs_params_from_header(header)` |
| `processing-engine/app/processing/avm.py` | `extract_wcs_for_avm` derives scale + rotation from `celestial_wcs` |
| `processing-engine/tests/test_science_wcs.py` | new — helper unit tests |
| `processing-engine/tests/test_avm_embedding.py` | add PC-matrix rotation cases |

## Out of scope

- **SIP distortion.** `WCS(header)` reads SIP, but a 6-number affine cannot
  carry it. JWST `_i2d` products have no SIP; `_cal` products may, where the
  readout error is sub-pixel. Not addressed here.
- **Non-TAN projections.** The client's inverse is TAN-only. `CTYPE` is in the
  payload; nothing reads it yet.
- The other 10 "first HDU with data" sites — that is S2a.

## Test plan

1. `test_science_wcs.py` red before the helper exists, green after.
2. Regression: PC+CDELT header yields the rotated matrix, not the diagonal.
3. Regression for #1235: `CTYPE1=RA---TAN`, `CRVAL1=0`, `CRPIX1=0` still
   returns params (not `None`).
4. Header with no celestial keywords returns `None`.
5. Live check against a real `_i2d` file in the running container: payload
   matrix matches astropy's `pixel_scale_matrix` to float precision.

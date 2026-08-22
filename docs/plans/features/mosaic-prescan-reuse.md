# Mosaic Pre-scan: Reuse Background Medians (and why the pre-scan stays full-res)

**Area**: `processing-engine/app/mosaic/mosaic_engine.py` —
`streaming_reproject_and_combine()`
**Risk**: Low — output is bitwise identical on real data; no contract changes.
**Complexity**: Low — one list threaded from pass 1 into pass 2.

---

## Problem

When `background_match=True` and more than one tile is supplied,
`streaming_reproject_and_combine()` runs two passes over every tile:

1. **Pre-scan** — `load_fn(path)` → `subtract_tile_background(data)` →
   `_compute_tile_signal(data)`, keeping one float per tile, discarding the
   array. Needed because gain normalization uses
   `ref_signal = median(signal levels of ALL tiles)`, a global reduction that
   cannot be known until every tile has been seen.
2. **Main loop** — `load_fn(path)` again, then `subtract_tile_background(data)`
   again, then reproject and accumulate.

So each tile is read twice and sigma-clipped twice. The second sigma-clip is
pure waste: pass 1 already computed exactly the number pass 2 recomputes.

The two-pass structure itself is inherent and stays. The goal is to make pass 1
cheaper, not to remove it.

## Change 1 — reuse the pre-scan background median (implemented)

Have the pre-scan retain each tile's `bg_median` alongside its signal level,
and have the main loop subtract that stored median instead of calling
`subtract_tile_background()` a second time.

Correctness rests on `subtract_tile_background` being a pure function of the
tile's own data:

```python
valid = data[data > 0]
if valid.size == 0:
    return data.copy(), 0.0
_, median, _ = sigma_clipped_stats(valid, sigma=3.0, maxiters=5)
result = data - median
np.clip(result, 0, None, out=result)
```

No RNG, no global state, no cross-tile coupling, and both passes feed it the
identical array (same `load_fn`, same path). Verified empirically: the coadd
output is bitwise identical (`np.array_equal` → `True`, max abs diff `0.0`) on
both real datasets measured below.

A shared `_apply_tile_background()` helper performs the
subtract-and-clip so the reuse path and `subtract_tile_background()` cannot
drift apart.

`background_match=False` never enters the pre-scan and is untouched.

## Change 2 — reduced-resolution pre-scan (investigated, REJECTED)

The proposal: read pass 1 at a strided subsample (`[::4, ::4]`) on the theory
that a 90th-percentile signal level is a robust statistic and should survive
subsampling.

It does not survive well enough. Measured against the current full-resolution
gains on real MAST tiles (read-only):

| Dataset | Tiles | Native tile | Max rel gain diff `[::2]` | Max rel gain diff `[::4]` |
|---------|-------|-------------|---------------------------|---------------------------|
| MIRI F1130W `jw02733-o002_t001` | 16 | 1019×1029 (1.0M px) | 3.03e-03 | 7.47e-03 |
| NIRCam F115W `jw06675-o007_t008` | 8 | 4518×4539 (20.5M px) | 3.35e-02 | 3.83e-02 |

Resulting shift in final coadd pixels when `[::4]` gains are used:

| Dataset | Max rel pixel diff | Median rel pixel diff | Pixels moved >1e-6 rel |
|---------|--------------------|-----------------------|------------------------|
| MIRI F1130W | 7.47e-03 | 1.77e-03 | 915,471 / 915,549 |
| NIRCam F115W | 3.83e-02 | 2.03e-02 | 3,250,547 / 3,250,555 |

Essentially every output pixel moves, by a median of 0.2% (MIRI) to 2.0%
(NIRCam) and up to 3.8%. Reusing the subsampled *background* as well is far
worse: median 2.4% and >100% on faint pixels, because a background median
shifted by even 0.05% relocates the clip-at-zero boundary.

Why the larger tiles fare worse is the interesting part: `load_fn` already
calls `downscale_for_composite`, which resamples with `scipy.zoom(order=1)` —
an averaging-flavoured operation. A strided subsample is a *different*
estimator of the same field, not a cheaper version of the same one. It drops
the averaging, so the 90th-percentile of the surviving pixels sits higher and
noisier, and the discrepancy grows with the decimation factor that
`downscale_for_composite` was applying.

The payoff would not have justified it in any case. Timing the two passes
separately:

| Dataset | Pre-scan (full) | Pre-scan `[::4]` | Main loop | Pre-scan share of total |
|---------|-----------------|------------------|-----------|-------------------------|
| MIRI F1130W (16 tiles) | 1.51s | 0.21s | 20.84s | 6.8% |
| NIRCam F115W (8 tiles) | 2.29s | 0.52s | 52.51s | 4.2% |

The strided read is 4.4–7.2x faster, not 16x — `fits.open(memmap=True)` reads
whole pages, so `[::4, ::4]` still touches every fourth *row's* pages, and the
saved `scipy.zoom` is a larger share of the win than the saved I/O. Even at
zero cost, deleting the entire pre-scan would buy 4–7% of wall time. The coadd
(`reproject_interp`) dominates, and that is where any future work belongs.

**Decision: not implemented.** The premise that "each tile is read twice" is a
large cost does not survive measurement, and the accuracy cost is real.

## Change 1 measured effect

| Dataset | Main loop, recompute bg | Main loop, reuse bg | Saving | Total pipeline |
|---------|-------------------------|---------------------|--------|----------------|
| MIRI F1130W (16 tiles) | 20.84s | 20.23s | 0.62s | 2.8% faster |
| NIRCam F115W (8 tiles) | 52.51s | 52.11s | 0.40s | 0.7% faster |

Small, but free and bitwise-identical: it deletes redundant work without
trading anything away.

## Out of scope

- Collapsing the two passes into one — impossible; `ref_signal` is a global
  reduction over all tiles.
- Changing the `load_fn` contract or its call sites.
- Any change to the coadd math (footprint-weighted accumulation).
- Speeding up `reproject_interp`, which is where the time actually goes.

## Testing

Extends `processing-engine/tests/test_streaming_reproject.py`:

- Gains and full output match the pre-change implementation on a fixture set.
- Reused-median path is bitwise identical to a recompute-per-pass reference.
- `background_match=False` still loads each tile exactly once and never
  computes a background.
- `background_match=True` loads each tile exactly twice — no more, no fewer —
  and calls `subtract_tile_background` exactly once per tile instead of twice.
- O(1) memory preserved: no tile array outlives its loop iteration.

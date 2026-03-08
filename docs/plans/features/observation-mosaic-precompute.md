# Pre-Compute Observation Mosaics for Large Targets

**Status**: In Progress
**Created**: 2026-03-08
**Related Issues**: PR #730 (stopgap), NGC 3324 OOM

## Context

NGC 3324 composite creation crashes the processing engine (OOM) because MAST doesn't provide a combined observation-level `_i2d.fits` for observation jw02731. Instead, it has **158 per-detector `_i2d.fits` files** for F090W alone. The composite pipeline tries to load all 158 files → 19 GB RAM → OOM at 4 GB.

PR #730 provides a stopgap (filter to `_i2d.fits` + scale per-file budget), but the result is low-resolution because each file gets only ~100K pixels. The real fix: **pre-compute observation-level mosaics at import time** so the composite pipeline gets 1 file instead of 158.

Most observations already have a MAST-provided combined product (1 file). This only triggers for large survey programs where MAST only provides per-detector products.

## Approach: Post-Import Observation Mosaic Generation

### Detection (Backend — after import completes)

At the end of `MastController.ExecuteImportAsync()`, after `EstablishLineageRelationships()`:

1. Query MongoDB: all records with same `ObservationBaseId`, `ProcessingLevel == "L3"`, `FileName` ending in `_i2d.fits`, **excluding** records tagged `observation-mosaic`
2. Group by `ImageInfo.Instrument` + `ImageInfo.Filter` (grouping key)
3. If any group has > **4 files** (configurable threshold), queue a mosaic job for that group
4. Skip if a `observation-mosaic`-tagged record already exists for that group

### Job Queue (Backend)

Extend existing `MosaicJobItem` with:
```csharp
public bool IsObservationMosaic { get; init; }
public List<string>? SourceDataIds { get; init; }  // for observation mosaic only
```

When `IsObservationMosaic`, the `MosaicBackgroundService` calls a new `MosaicService.GenerateObservationMosaicAsync()` method that:
- Builds a `MosaicRequestDto` from the source data IDs (FITS output, default stretch, mean combine)
- Calls the existing `GenerateAndSaveMosaicAsync()` with extra tags `["observation-mosaic"]`
- The generated record gets: `Tags = ["mosaic-generated", "observation-mosaic", "fits"]`, `ProcessingLevel = "L3"`, `ObservationBaseId` from sources, `DerivedFrom = sourceDataIds`

`GenerateAndSaveMosaicAsync` needs one change: accept optional `IEnumerable<string>? additionalTags` parameter.

### Memory-Bounded Processing (Python)

New endpoint: `POST /mosaic/generate-observation`

For large file counts (>20), uses **hierarchical batched mosaicking**:
1. Split files into batches of 8-12
2. Downscale each file to `per_file_budget = max_output_pixels / total_files` before loading
3. Mosaic each batch → intermediate array
4. Mosaic all intermediates → final output
5. Save as FITS, return response

This stays within 4 GB because:
- 12 files × ~2M px × 8 bytes = ~192 MB per batch
- 20 intermediate results × ~3M px × 8 bytes = ~480 MB for final combine
- Total peak: ~700 MB

For small file counts (≤20), use the existing `generate_mosaic()` with per-file downscaling — no batching needed.

### Composite Pipeline Preference (Backend)

In `CompositeService.ResolveDataIdsToFilePathsAsync()`, after the existing `_i2d` filtering:

1. Group remaining file paths by `ObservationBaseId`
2. For groups with > 4 files, query MongoDB for an `observation-mosaic`-tagged record with matching `ObservationBaseId` + filter
3. If found, substitute the group's N paths with the single mosaic path
4. Log the substitution

This is the safety net — even if the frontend sends 158 IDs, the backend returns 1 mosaic path.

## Files to Change

| File | Change |
|------|--------|
| `backend/.../Controllers/MastController.cs` | Detection logic after `EstablishLineageRelationships()` |
| `backend/.../Services/MosaicQueue.cs` | Add `IsObservationMosaic`, `SourceDataIds` to `MosaicJobItem` |
| `backend/.../Services/MosaicBackgroundService.cs` | Route observation mosaic jobs to new handler |
| `backend/.../Services/MosaicService.cs` | Add `GenerateObservationMosaicAsync()`, add `additionalTags` param to `GenerateAndSaveMosaicAsync()` |
| `backend/.../Services/IMosaicService.cs` | Interface update |
| `backend/.../Services/CompositeService.cs` | Observation-mosaic substitution in `ResolveDataIdsToFilePathsAsync()` |
| `backend/.../Configuration/ObservationMosaicSettings.cs` | New config class |
| `backend/.../appsettings.json` | `ObservationMosaic` section |
| `processing-engine/app/mosaic/routes.py` | New `POST /mosaic/generate-observation` endpoint |
| `processing-engine/app/mosaic/mosaic_engine.py` | New `generate_mosaic_batched()` function |
| `processing-engine/app/mosaic/models.py` | New `ObservationMosaicRequest` model |
| Docs: `key-files.md`, `backend-development.md`, `quick-reference.md` | New endpoint + config |

## Phased Implementation

**Phase 1**: Detection + queue + existing mosaic endpoint (works for ≤20 files)
**Phase 2**: Batched mosaic engine (handles 158+ files within 4 GB)
**Phase 3**: Composite pipeline substitution (backend auto-prefers mosaic)

Each phase is a separate PR. Phase 1 is useful on its own for moderate-size observations. Phase 2 handles the NGC 3324 case. Phase 3 provides the seamless UX.

## Edge Cases

- **Import interrupted**: No mosaic queued — next import triggers detection
- **Mosaic already exists**: Skip (check by `ObservationBaseId` + filter + `observation-mosaic` tag)
- **Re-import adds files**: Compare `DerivedFrom.Count` on existing mosaic vs current file count; re-generate if stale
- **Mosaic fails**: Job fails gracefully. PR #730 stopgap still works (low-res but no crash)
- **Mixed instruments**: Group by instrument+filter, not just filter

## Related: Background Job Dashboard (separate issue)

The observation mosaic, thumbnail generation, composite export, and future background jobs all need a user-facing queue/status dashboard. Currently these are invisible to the user — jobs run silently and either succeed or fail with no visibility. Create a tracked issue for this before implementation starts.

## Verification

1. Import an observation with many per-detector `_i2d.fits` → verify mosaic job is queued
2. Check `docker logs jwst-backend` for detection + queue messages
3. Check `docker logs jwst-processing` for batched mosaic progress + memory logs
4. Verify new MongoDB record with `observation-mosaic` tag appears
5. Create composite for same target → verify backend substitutes mosaic path (check logs)
6. Compare composite quality: pre-computed mosaic vs PR #730 stopgap

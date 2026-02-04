# MAST Search & Import Guide

This guide covers searching and importing JWST data from the MAST (Mikulski Archive for Space Telescopes) portal.

## Calibration Levels

JWST data products come in different calibration levels:

| Level | Description | Files |
|-------|-------------|-------|
| 1 | Minimally processed | `*_uncal.fits` |
| 2 | Calibrated individual exposures | `*_rate.fits`, `*_cal.fits`, `*_crf.fits` |
| 3 | Combined/mosaic images | `*_i2d.fits`, `*_s2d.fits` |

By default, searches return **Level 3 only** (combined/mosaic images) which are typically what users want for analysis. Toggle "Show all calibration levels" to include Level 1-3 products.

**Import filtering**: When importing, only files matching your selected calibration level are downloaded. If you searched with Level 3 only, only Level 3 files are imported.

## Frontend Walkthrough

1. Click "Search MAST" button in the dashboard header
2. Select search type:
   - **Target Name**: Enter astronomical object name (e.g., "NGC 3132", "Carina Nebula")
   - **Coordinates**: Enter RA/Dec in degrees with search radius
   - **Observation ID**: Enter MAST observation ID (e.g., "jw02733-o001_t001_nircam_clear-f090w")
   - **Program ID**: Enter JWST program number (e.g., "2733")
3. (Optional) Toggle "Show all calibration levels" to include Level 1-3 products
4. Click "Search MAST" to query the archive
5. Review results in the table (shows target, instrument, filter, exposure time)
6. Click "Import" on individual observations or select multiple and use "Import Selected"
7. Imported files appear in the main data dashboard

## API Examples

### Search by Target Name

```bash
curl -X POST http://localhost:5001/api/mast/search/target \
  -H "Content-Type: application/json" \
  -d '{"targetName": "NGC 3132", "radius": 0.1}'
```

### Search by Coordinates

```bash
curl -X POST http://localhost:5001/api/mast/search/coordinates \
  -H "Content-Type: application/json" \
  -d '{"ra": 151.755, "dec": -40.437, "radius": 0.1}'
```

### Import Observation

```bash
curl -X POST http://localhost:5001/api/mast/import \
  -H "Content-Type: application/json" \
  -d '{"obsId": "jw02733-o001_t001_nircam_clear-f090w", "productType": "SCIENCE"}'
```

### Check Import Progress

```bash
curl http://localhost:5001/api/mast/import-progress/{jobId}
```

### Resume Failed Import

```bash
curl -X POST http://localhost:5001/api/mast/import/resume/{jobId}
```

### Import from Existing Files

If download completed but the request timed out:

```bash
curl -X POST http://localhost:5001/api/mast/import/from-existing/{obsId}
```

### Refresh Metadata

Re-fetch metadata from MAST for a single observation:

```bash
curl -X POST http://localhost:5001/api/mast/refresh-metadata/{obsId}
```

Re-fetch metadata for ALL MAST imports:

```bash
curl -X POST http://localhost:5001/api/mast/refresh-metadata-all
```

## Metadata Preservation

When importing observations from MAST, all metadata fields (~30+) are preserved with `mast_` prefix in the record's `metadata` dictionary.

### Typed Fields (in ImageInfo)

| Field | Description |
|-------|-------------|
| `observationDate` | Converted from MJD (t_min) with fallback to t_max, t_obs_release |
| `targetName` | Target name from MAST |
| `instrument` | Instrument used (NIRCam, MIRI, etc.) |
| `filter` | Filter used |
| `exposureTime` | Exposure time in seconds |
| `calibrationLevel` | MAST calib_level (0-4) |
| `proposalId` | JWST proposal/program ID |
| `proposalPi` | Principal investigator |
| `observationTitle` | Observation title |
| `wavelengthRange` | e.g., "INFRARED", "OPTICAL" |
| `wcs` | World coordinate system (CRVAL1, CRVAL2) |

### Raw MAST Fields (in Metadata with `mast_` prefix)

- `mast_obs_id`, `mast_target_name`, `mast_instrument_name`
- `mast_t_min`, `mast_t_max`, `mast_t_exptime`
- `mast_proposal_id`, `mast_proposal_pi`, `mast_obs_title`
- `mast_s_ra`, `mast_s_dec`, `mast_s_region`
- `mast_dataURL`, `mast_jpegURL`
- And many more...

### Refresh Metadata Button

Click "Refresh Metadata" in the dashboard to re-fetch metadata from MAST for all existing imports. This is useful after updates that add new metadata fields.

## FITS File Types

The dashboard displays file type indicators to show which files are viewable.

### Viewable Image Files (blue badge)

| Pattern | Description |
|---------|-------------|
| `*_uncal.fits` | Uncalibrated raw data |
| `*_rate.fits` / `*_rateints.fits` | Count rate images |
| `*_cal.fits` / `*_calints.fits` | Calibrated images |
| `*_i2d.fits` | 2D resampled/combined images |
| `*_s2d.fits` | 2D spectral images |
| `*_crf.fits` | Cosmic ray flagged images |

### Non-Viewable Table Files (amber badge)

| Pattern | Description |
|---------|-------------|
| `*_asn.fits` | Association tables |
| `*_x1d.fits` / `*_x1dints.fits` | 1D extracted spectra |
| `*_cat.fits` | Source catalogs |
| `*_pool.fits` | Association pools |

The View button is disabled for table files to prevent errors.

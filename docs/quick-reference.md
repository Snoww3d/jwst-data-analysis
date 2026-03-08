# Quick Reference

Common patterns, API endpoints, troubleshooting, and MAST usage tips.

## Common Patterns

### Adding a New API Endpoint

1. Add method to `MongoDBService.cs` if database operation needed
2. Add controller action in appropriate controller (JwstDataController or DataManagementController)
3. Use async/await pattern
4. Return appropriate HTTP status codes (200, 201, 404, 500)
5. Add error handling with try-catch
6. Update Swagger documentation (automatic via annotations)

### Adding Processing Algorithm

1. Create a module under `processing-engine/app/` (e.g., `app/myfeature/routes.py`, `models.py`)
2. Register the FastAPI router in `main.py`
3. Add a backend service in `backend/.../Services/` that proxies to the processing engine
4. Add a backend controller in `backend/.../Controllers/`
5. Add a frontend service in `frontend/.../services/` and integrate into the UI

### Updating Data Models

1. Modify `JwstDataModel.cs` in backend
2. Mirror changes in `frontend/jwst-frontend/src/types/JwstDataTypes.ts`
3. Update MongoDB queries in `MongoDBService.cs` if new fields need indexing/filtering
4. No migration needed (MongoDB schema-less)

## API Endpoints Quick Reference

**Base URL**: http://localhost:5001/api | **Swagger UI**: http://localhost:5001/swagger

**Health** (anonymous):
- `GET /api/health` - JSON response with component health status (includes processing engine connectivity). Returns `Healthy`/`Degraded`.

**Authentication** (JWT Bearer):
- `POST /auth/register` - Create new account (returns tokens)
- `POST /auth/login` - Login with username/password (returns tokens)
- `POST /auth/refresh` - Refresh access token using refresh token
- `POST /auth/logout` - Revoke refresh token (requires auth)
- `GET /auth/me` - Get current user info (requires auth)

> **Note**: Most GET endpoints and some read-only POST endpoints (e.g. search, check-availability) allow anonymous access. Write operations (POST/PUT/DELETE) require `Authorization: Bearer <token>` header.

**Main Data Operations**:
- `GET /jwstdata` - List all | `GET /jwstdata/{id}` - Get one | `POST /jwstdata` - Create
- `PUT /jwstdata/{id}` - Update | `DELETE /jwstdata/{id}` - Delete
- `GET /jwstdata/type/{dataType}` - Filter by type | `GET /jwstdata/status/{status}` - Filter by status

**Availability & Thumbnails**:
- `POST /jwstdata/check-availability` - Check if observations have existing data (AllowAnonymous)
- `POST /jwstdata/thumbnails/generate` - Queue thumbnail generation for viewable records without thumbnails (background queue)
- `GET /jwstdata/{id}/thumbnail` - Get thumbnail image for a record

**Viewer Operations** (FITS preview):
- `GET /jwstdata/{id}/preview` - Generate preview image
  - `cmap`: inferno, magma, viridis, plasma, grayscale, hot, cool, rainbow
  - `stretch`: zscale, asinh, log, sqrt, power, histeq, linear
  - `width`, `height`: 10-8000 (default 1000) | `gamma`: 0.1-5.0 | `format`: png/jpeg
  - `smoothMethod`: gaussian, median, box, astropy_gaussian, astropy_box, or "" (disabled)
  - `smoothSigma`: 0.1-10.0 (default 1.0) | `smoothSize`: 1-25 odd (default 3)
- `GET /jwstdata/{id}/histogram` - Histogram data (same smoothing params as preview) | `/pixeldata` - Pixel array | `/cubeinfo` - 3D cube metadata | `/file` - Download FITS

**Other Endpoints** (see Swagger for details):
- **Lineage**: `GET /jwstdata/lineage` - Groups by observation
- **Data Management**: `/datamanagement/search`, `/statistics`, `/export`, `/bulk/tags`, `/bulk/status`, `POST /datamanagement/migrate-storage-keys` (admin, one-time migration)
- **Data Scan**: `POST /datamanagement/import/scan` - Manual disk scan to sync database with filesystem (admin use; automatic startup scan runs on backend startup)
- **Composite**:
  - `POST /composite/generate-nchannel` - N-channel composite with hue/RGB color mapping (anonymous for public data, auth for private/shared access)
  - `POST /composite/export-nchannel` - Async N-channel export via job queue (requires auth, returns 202 + jobId, result via `/api/jobs/{jobId}/result`)
  - Each channel: `dataIds`, `color` (`{hue: 0-360}`, `{rgb: [r,g,b]}`, or `{luminance: true}`), `stretch`, `blackPoint`, `whitePoint`, `gamma`, `asinhA`, `curve`, `weight` (0.0–2.0)
  - Luminance channel: at most one; blends detail via HSL into the combined color channels (LRGB technique). `weight` controls blend strength (0–1).
  - Optional: `label` (filter name), `wavelength_um` (for metadata)
  - Optional global params: `overall.stretch`, `overall.blackPoint`, `overall.whitePoint`, `overall.gamma`, `overall.asinhA`
- **Mosaic**:
  - `POST /mosaic/generate` - WCS-aware mosaic from 2+ FITS files (output: png/jpeg/fits)
    - FITS output includes provenance cards in the primary header and a `SRCMETA` extension with source header metadata
  - `POST /mosaic/generate-and-save` - Generate native FITS mosaic server-side and save as a new data record (recommended for large mosaics)
  - `POST /mosaic/export` - Async mosaic image export via job queue (requires auth, returns 202 + jobId, result via `/api/jobs/{jobId}/result`)
  - `POST /mosaic/save` - Async mosaic FITS save-to-library via job queue (requires auth, returns 202 + jobId, creates new data record)
  - `POST /mosaic/footprint` - WCS footprint polygons
  - Observation mosaics are auto-generated post-import when per-detector file groups exceed the `ObservationMosaic:FileThreshold` config (default 4). Composite pipeline auto-substitutes these.
- **Discovery**:
  - `GET /api/discovery/featured` - Get featured targets (12 curated JWST targets with metadata)
  - `POST /api/discovery/suggest-recipes` - Generate composite recipe suggestions from observations (proxies to Python recipe engine)
- **Semantic Search**:
  - `GET /api/search/semantic?q=...&topK=20&minScore=0.3` - Natural language search over FITS metadata (anonymous, access-controlled results)
  - `POST /api/search/reindex` - Trigger full semantic re-index (admin only, returns 202 + jobId)
  - `GET /api/search/index-status` - Semantic index health (total indexed, model status)
- **Analysis**: `POST /analysis/region-statistics` - Compute statistics for rectangle/ellipse regions (mean, median, std, min, max, sum, pixel count)
  - `POST /analysis/detect-sources` - Detect astronomical sources (params: thresholdSigma, fwhm, method, npixels, deblend)
  - `GET /analysis/table-info?dataId=` - Get table HDU metadata for a FITS file
  - `GET /analysis/table-data?dataId=&hduIndex=&page=&pageSize=&sortColumn=&sortDirection=&search=` - Get paginated table data
  - `GET /analysis/spectral-data?dataId=&hduIndex=1` - Get spectral column arrays for chart rendering (wavelength, flux, error)
- **Jobs** (unified, requires auth):
  - `GET /api/jobs` - List jobs (query: `status`, `type`)
  - `GET /api/jobs/{jobId}` - Job status (ownership enforced)
  - `POST /api/jobs/{jobId}/cancel` - Cancel job
  - `GET /api/jobs/{jobId}/result` - Stream blob result or data ID (extends TTL)
- **SignalR Hub**: `/hubs/job-progress` - WebSocket push (JWT via `?access_token=`)
  - Client methods: `SubscribeToJob(jobId)`, `UnsubscribeFromJob(jobId)`
  - Server events: `JobProgress`, `JobCompleted`, `JobFailed`, `JobSnapshot`
- **MAST Search**: `/mast/search/target`, `/coordinates`, `/observation`, `/program`
- **MAST Import**: `/mast/import` (supports `downloadSource`: "auto"/"s3"/"http"), `/import-progress/{jobId}`, `/import/resume/{jobId}`, `/import/cancel/{jobId}`, `/refresh-metadata`

## Troubleshooting

**MongoDB Connection Issues**:
- Ensure MongoDB is running (Docker: `docker compose ps`)
- Check connection string in `appsettings.json` matches your setup
- Default: `mongodb://admin:password@localhost:27017`

**Frontend Can't Reach Backend**:
- Verify backend is running on expected port
- Check CORS configuration in `Program.cs`
- Confirm `VITE_API_URL` environment variable

**Processing Engine Not Working**:
- Virtual environment activated?
- All dependencies installed? (`pip install -r requirements.txt`)
- Check Python version (requires 3.10+)

**Docker Issues**:
- Rebuild images: `docker compose up -d --build`
- Check logs: `docker compose logs -f [service-name]`
- Reset volumes: `docker compose down -v` (WARNING: deletes data)

**MAST Search Issues**:
- Ensure processing engine is running: `docker compose logs processing-engine`
- Check internet connectivity (MAST requires external access)
- Target-name search normalizes common variants (for example: `NGC 3132`, `NGC-3132`, `NGC3132`)
- If JSON serialization errors occur, NaN values from MAST are being handled
- Large downloads may timeout; increase `HttpClient.Timeout` if needed
- Downloaded files stored in `data/mast/{obs_id}/` directory
- Backend performs automatic disk scan on startup to sync database with any MAST files already on disk

## Using MAST Search

See [`docs/mast-usage.md`](mast-usage.md) for detailed API examples, metadata field mappings, and FITS file type reference.

**Quick Start**: Click "Search MAST" in dashboard -> Select search type (target/coordinates/observation/program) -> Search -> Import selected observations.

**FITS File Types**: Image files (`*_cal`, `*_i2d`, `*_rate`) are viewable; table files (`*_asn`, `*_x1d`, `*_cat`) show data badge only.

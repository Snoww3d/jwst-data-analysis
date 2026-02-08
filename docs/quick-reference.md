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

1. Define algorithm in `processing-engine/main.py` algorithms dict
2. Implement processing function (accept data, parameters, return results)
3. Update frontend `JwstDataDashboard.tsx` with new action button
4. Add algorithm name to type definitions if needed

### Updating Data Models

1. Modify `JwstDataModel.cs` in backend
2. Mirror changes in `frontend/jwst-frontend/src/types/JwstDataTypes.ts`
3. Update MongoDB queries in `MongoDBService.cs` if new fields need indexing/filtering
4. No migration needed (MongoDB schema-less)

## API Endpoints Quick Reference

**Base URL**: http://localhost:5001/api | **Swagger UI**: http://localhost:5001/swagger

**Authentication** (JWT Bearer):
- `POST /auth/register` - Create new account (returns tokens)
- `POST /auth/login` - Login with username/password (returns tokens)
- `POST /auth/refresh` - Refresh access token using refresh token
- `POST /auth/logout` - Revoke refresh token (requires auth)
- `GET /auth/me` - Get current user info (requires auth)

> **Note**: GET allows anonymous access. POST/PUT/DELETE require `Authorization: Bearer <token>` header.

**Main Data Operations**:
- `GET /jwstdata` - List all | `GET /jwstdata/{id}` - Get one | `POST /jwstdata` - Create
- `PUT /jwstdata/{id}` - Update | `DELETE /jwstdata/{id}` - Delete | `POST /jwstdata/{id}/process` - Process
- `GET /jwstdata/type/{dataType}` - Filter by type | `GET /jwstdata/status/{status}` - Filter by status

**Viewer Operations** (FITS preview):
- `GET /jwstdata/{id}/preview` - Generate preview image
  - `cmap`: inferno, magma, viridis, plasma, grayscale, hot, cool, rainbow
  - `stretch`: zscale, asinh, log, sqrt, power, histeq, linear
  - `width`, `height`: 10-8000 (default 1000) | `gamma`: 0.1-5.0 | `format`: png/jpeg
- `GET /jwstdata/{id}/histogram` - Histogram data | `/pixeldata` - Pixel array | `/cubeinfo` - 3D cube metadata | `/file` - Download FITS

**Other Endpoints** (see Swagger for details):
- **Lineage**: `GET /jwstdata/lineage` - Groups by observation
- **Data Management**: `/datamanagement/search`, `/statistics`, `/export`, `/bulk/tags`, `/bulk/status`
- **Composite**: `POST /composite/generate` - WCS-aware RGB from 3 FITS files (anonymous for public data, auth for private/shared access)
  - Channel params: `stretch`, `blackPoint`, `whitePoint`, `gamma`, `asinhA`, `curve` (`linear`, `s_curve`, `inverse_s`, `shadows`, `highlights`)
  - Optional global params: `overall.stretch`, `overall.blackPoint`, `overall.whitePoint`, `overall.gamma`, `overall.asinhA`
- **Mosaic**:
  - `POST /mosaic/generate` - WCS-aware mosaic from 2+ FITS files (output: png/jpeg/fits)
    - FITS output includes provenance cards in the primary header and a `SRCMETA` extension with source header metadata
  - `POST /mosaic/generate-and-save` - Generate native FITS mosaic server-side and save as a new data record (recommended for large mosaics)
  - `POST /mosaic/footprint` - WCS footprint polygons
- **Analysis**: `POST /analysis/region-statistics` - Compute statistics for rectangle/ellipse regions (mean, median, std, min, max, sum, pixel count)
- **MAST Search**: `/mast/search/target`, `/coordinates`, `/observation`, `/program`
- **MAST Import**: `/mast/import`, `/import-progress/{jobId}`, `/import/resume/{jobId}`, `/refresh-metadata`

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
- Note: Many algorithms are TODO/stubs in Phase 3

**Docker Issues**:
- Rebuild images: `docker compose up -d --build`
- Check logs: `docker compose logs -f [service-name]`
- Reset volumes: `docker compose down -v` (WARNING: deletes data)

**MAST Search Issues**:
- Ensure processing engine is running: `docker compose logs processing-engine`
- Check internet connectivity (MAST requires external access)
- Target name searches are case-insensitive but must match MAST naming
- If JSON serialization errors occur, NaN values from MAST are being handled
- Large downloads may timeout; increase `HttpClient.Timeout` if needed
- Downloaded files stored in `data/mast/{obs_id}/` directory

## Using MAST Search

See [`docs/mast-usage.md`](mast-usage.md) for detailed API examples, metadata field mappings, and FITS file type reference.

**Quick Start**: Click "Search MAST" in dashboard -> Select search type (target/coordinates/observation/program) -> Search -> Import selected observations.

**FITS File Types**: Image files (`*_cal`, `*_i2d`, `*_rate`) are viewable; table files (`*_asn`, `*_x1d`, `*_cat`) show data badge only.

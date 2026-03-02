# Security & Authorization Model

Comprehensive reference for the JWST Data Analysis application's security model: user roles, data visibility, endpoint authorization, and access control patterns.

> **Last updated**: 2026-03-02 (PR #573 authorization gap fixes #565-#570)

---

## User Roles

| Role | How Assigned | Description |
|------|-------------|-------------|
| **Admin** | `Role` claim = `"Admin"` in JWT | Full access to all data and operations. Can bypass ownership checks. |
| **Authenticated User** | Valid JWT with `sub` / `NameIdentifier` claim | Can create, own, and manage their own data. Can read public and shared data. |
| **Anonymous** | No JWT / unauthenticated | Read-only access to public data. Cannot create, modify, or delete anything. |

---

## Data Access Control Fields

Each `JwstDataRecord` in MongoDB has four fields that determine who can access it:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `UserId` | `string?` | `null` | Owner of the record. Set at import/upload time. |
| `IsPublic` | `bool` | `true` | When true, readable by everyone including anonymous users. |
| `SharedWith` | `List<string>` | `[]` | Additional user IDs granted read access to private data. |
| `IsArchived` | `bool` | `false` | Soft-delete flag. Hidden from default listings but still accessible by ID. |

**Design decision**: `IsPublic` defaults to `true` because JWST data is public domain. Users must explicitly make data private.

---

## Access Control Matrix

### Data Read Access

Who can **view/read** a record (GET by ID, preview, histogram, pixel data, thumbnail, file download, spectral data, analysis):

| Data State | Admin | Owner | Shared User | Other Auth User | Anonymous |
|------------|-------|-------|-------------|-----------------|-----------|
| Public (`IsPublic=true`) | Yes | Yes | Yes | Yes | Yes |
| Private, shared (`IsPublic=false`, in `SharedWith`) | Yes | Yes | Yes | No | No |
| Private, not shared (`IsPublic=false`, empty `SharedWith`) | Yes | Yes | No | No | No |
| Archived + Public | Yes | Yes | Yes | Yes | Yes |
| Archived + Private | Yes | Yes | Shared only | No | No |

**Response for denied access**: Most endpoints return `404 Not Found` (not `403 Forbidden`) to prevent ID enumeration.

### Data Mutation Access

Who can **modify** a record (update metadata, share/publish, archive, unarchive):

| Action | Admin | Owner | Shared User | Other Auth User | Anonymous |
|--------|-------|-------|-------------|-----------------|-----------|
| Update metadata (PUT) | Yes | Yes | No (403) | No (403) | No (401) |
| Share / change visibility | Yes | Yes | No (403) | No (403) | No (401) |
| Archive | Yes | Yes | No (403) | No (403) | No (401) |
| Unarchive | Yes | Yes | No (403) | No (403) | No (401) |

### Data Deletion Access

Who can **delete** data:

| Action | Admin | Owner | Shared User | Other Auth User | Anonymous |
|--------|-------|-------|-------------|-----------------|-----------|
| Delete single record | Yes | Yes | No (403) | No (403) | No (401) |
| Delete entire observation | Yes | Yes (all files must be owned) | No (403) | No (403) | No (401) |
| Delete observation level | Yes | Yes (all files must be owned) | No (403) | No (403) | No (401) |
| Archive observation level | Yes | Yes (all files must be owned) | No (403) | No (403) | No (401) |

### Data Creation Access

| Action | Admin | Auth User | Anonymous |
|--------|-------|-----------|-----------|
| Upload FITS file | Yes | Yes (becomes owner) | No (401) |
| Import from MAST | Yes | Yes (becomes owner) | No (401) |
| Create via POST | Yes | Yes (becomes owner) | No (401) |

### Computed/Generated Data

| Action | Admin | Auth User (accessible inputs) | Auth User (inaccessible inputs) | Anonymous (public inputs) | Anonymous (private inputs) |
|--------|-------|-------------------------------|--------------------------------|--------------------------|---------------------------|
| Generate mosaic | Yes | Yes | 403 | Public inputs only | No |
| Generate composite | Yes | Yes | 404 | Public inputs only | No |
| Run analysis | Yes | Yes | 403 | Public inputs only | No |
| Export (mosaic/composite) | Yes | Yes | — | No (401) | No (401) |

---

## Authorization Helpers

All controllers inherit from `ApiControllerBase`, which provides identity extraction. Access control helpers are in individual controllers:

### Base Class (`ApiControllerBase`)

| Method | Returns | Logic |
|--------|---------|-------|
| `GetCurrentUserId()` | `string?` | Reads `NameIdentifier` or `sub` claim from JWT. Returns `null` for unauthenticated. |
| `GetRequiredUserId()` | `string` | Same, but throws `UnauthorizedAccessException` if null. Use in `[Authorize]` endpoints. |
| `IsCurrentUserAdmin()` | `bool` | `User.IsInRole("Admin")` |

### Controller-Level Helpers

| Method | Location | Logic |
|--------|----------|-------|
| `IsDataAccessible(record)` | JwstDataController, AnalysisController | Unauthenticated → `IsPublic` only. Authenticated → `IsPublic OR owner OR SharedWith OR admin`. |
| `CanModifyData(record)` | JwstDataController | `owner OR admin`. Shared users cannot modify. |
| `CanAccessData(record)` | JwstDataController | Authenticated-only variant: `IsPublic OR owner OR SharedWith OR admin`. |
| `FilterAccessibleData(list)` | JwstDataController, DataManagementController | Filters a list to only records the current user can access. |

### Service-Level Helpers

| Method | Location | Logic |
|--------|----------|-------|
| `CanAccessData(record, userId, isAuthenticated, isAdmin)` | MosaicService, CompositeService | Same logic as controller version, but accepts explicit user context (for background jobs). |

---

## Endpoint Authorization Reference

### Legend

- **Open**: No authentication required (`[AllowAnonymous]`)
- **Auth**: Requires valid JWT (`[Authorize]`)
- **Admin**: Requires admin role (`[Authorize(Policy="AdminOnly")]`)
- **+ Access Check**: Endpoint performs per-record authorization beyond the attribute

### AuthController (`/api/auth`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `POST /login` | Open | None | |
| `POST /register` | Open | None | |
| `POST /refresh` | Open | None | |
| `POST /logout` | Auth | UserId null-check | |
| `GET /me` | Auth | UserId null-check | |
| `POST /change-password` | Auth | UserId null-check | Own password only |

### JwstDataController (`/api/jwstdata`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `GET /` | Open | + FilterAccessibleData | Anon → public; Auth → own+public+shared; Admin → all |
| `GET /{id}` | Open | + IsDataAccessible | 404 if inaccessible |
| `GET /{id}/preview` | Open | + IsDataAccessible | |
| `GET /{id}/histogram` | Open | + IsDataAccessible | |
| `GET /{id}/pixeldata` | Open | + IsDataAccessible | |
| `GET /{id}/cubeinfo` | Open | + IsDataAccessible | |
| `GET /{id}/file` | Open | + IsDataAccessible | |
| `GET /{id}/processing-results` | Open | + IsDataAccessible | |
| `GET /{id}/thumbnail` | Open | + IsDataAccessible | Returns 404 (not 403) to prevent enumeration |
| `GET /type/{dataType}` | Open | + FilterAccessibleData | |
| `GET /status/{status}` | Open | + FilterAccessibleData | |
| `GET /tags/{tags}` | Open | + FilterAccessibleData | |
| `GET /statistics` | Open | None | Aggregate counts only |
| `GET /public` | Open | None | DB query for public records |
| `GET /validated` | Open | + FilterAccessibleData | |
| `GET /format/{fileFormat}` | Open | + FilterAccessibleData | |
| `GET /tags` | Open | None | Tag list only |
| `GET /lineage/{obsBaseId}` | Open | + FilterAccessibleData | |
| `GET /lineage` | Open | + FilterAccessibleData | |
| `GET /archived` | Auth | + FilterAccessibleData | |
| `GET /user/{userId}` | Auth | Own userId or admin | Non-admin gets 403 for other users |
| `POST /` | Auth | Sets UserId to current | |
| `POST /upload` | Auth | Sets UserId to current | |
| `POST /search` | Auth | Non-admin filtered to own+public | |
| `POST /{id}/share` | Auth | + CanModifyData | Owner or admin |
| `POST /{id}/archive` | Auth | + CanModifyData | Owner or admin |
| `POST /{id}/unarchive` | Auth | + CanModifyData | Owner or admin |
| `POST /check-availability` | Open | + FilterAccessibleData | |
| `PUT /{id}` | Auth | + CanModifyData | Owner or admin |
| `DELETE /{id}` | Auth | + CanModifyData | Owner or admin |
| `DELETE /observation/{obsBaseId}` | Auth | All records must be owned (or admin) | |
| `DELETE /observation/{obsBaseId}/level/{level}` | Auth | All records must be owned (or admin) | |
| `POST /observation/{obsBaseId}/level/{level}/archive` | Auth | All records must be owned (or admin) | |
| `POST /generate-thumbnails` | Admin | Admin policy | |
| `POST /bulk/tags` | Admin | Admin policy | |
| `POST /bulk/status` | Admin | Admin policy | |
| `POST /migrate/processing-levels` | Admin | Admin policy | |
| `POST /migrate/data-types` | Admin | Admin policy | |

### AnalysisController (`/api/analysis`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `POST /region-statistics` | Open | + IsDataAccessible | Returns 403 if inaccessible |
| `POST /detect-sources` | Open | + IsDataAccessible | |
| `GET /table-info` | Open | + IsDataAccessible | |
| `GET /table-data` | Open | + IsDataAccessible | |
| `GET /spectral-data` | Open | + IsDataAccessible | |

### MosaicController (`/api/mosaic`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `POST /generate` | Open | + Service-level CanAccessData per input | Anon: public data only, returns 404 (not 403) for inaccessible |
| `POST /generate-and-save` | Auth | + Service-level CanAccessData per input | |
| `POST /footprint` | Open | + Service-level CanAccessData per input | Anon: public data only, returns 404 (not 403) for inaccessible |
| `POST /export` | Auth | UserId null-check | Operates on generated output |
| `POST /save` | Auth | UserId null-check | |
| `GET /limits` | Open | None | Configuration values only |

### CompositeController (`/api/composite`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `POST /generate-nchannel` | Open | + Service-level access check per input | 404 if inaccessible to anon |
| `POST /export-nchannel` | Auth | UserId null-check | |

### MastController (`/api/mast`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `POST /search/target` | Open | None | MAST catalog query |
| `POST /search/coordinates` | Open | None | |
| `POST /search/observation` | Open | None | |
| `POST /search/program` | Open | None | |
| `POST /whats-new` | Open | None | |
| `POST /products` | Open | None | |
| `POST /download` | Auth | None | Downloads to server storage |
| `POST /import` | Auth | Sets UserId to current | |
| `GET /import-progress/{jobId}` | Auth | Owner or admin (404 for others) | |
| `POST /import/cancel/{jobId}` | Auth | Passes userId to cancel | |
| `POST /import/resume/{jobId}` | Auth | Owner or admin (404 for others) | |
| `POST /import/from-existing/{obsId}` | Auth | Sets UserId | |
| `GET /import/check-files/{obsId}` | Auth | None (filesystem check) | |
| `GET /import/resumable` | Auth | User-scoped via job tracker (admin sees all) | |
| `DELETE /import/resumable/{jobId}` | Auth | Owner or admin (404 for others) | |
| `POST /refresh-metadata/{obsId}` | Auth | Owner-scoped (admin refreshes all) | |
| `POST /refresh-metadata-all` | Admin | Admin policy | |

### DataManagementController (`/api/datamanagement`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `POST /search` | Open | + FilterAccessibleData (includes SharedWith) | |
| `GET /statistics` | Open | None (aggregates) | |
| `GET /public` | Open | None (public query) | |
| `GET /validated` | Open | + FilterAccessibleData | |
| `GET /format/{fileFormat}` | Open | + FilterAccessibleData | |
| `GET /tags` | Open | None (tag list) | |
| `POST /export` | Auth | + FilterAccessibleData | |
| `GET /export/{exportId}` | Auth | Owner or admin (404 for others) | Legacy exports without metadata remain accessible |
| `POST /import/scan` | Auth | None | |
| `POST /claim-orphaned` | Auth | Sets UserId | |
| `POST /bulk/tags` | Admin | Admin policy | |
| `POST /bulk/status` | Admin | Admin policy | |
| `POST /migrate-storage-keys` | Admin | Admin policy | |

### DiscoveryController (`/api/discovery`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `GET /featured` | Open | None | Curated content |
| `POST /suggest-recipes` | Open | None | AI suggestions |

### JobsController (`/api/jobs`)

| Endpoint | Auth | Internal Check | Notes |
|----------|------|----------------|-------|
| `GET /` | Auth | User-scoped query | Only own jobs (even for admin) |
| `GET /{jobId}` | Auth | Owner check (404) | |
| `POST /{jobId}/cancel` | Auth | Owner check | |
| `GET /{jobId}/result` | Auth | Owner check (404) | |

### Python Processing Engine (internal)

The processing engine runs as an internal service behind the .NET API gateway. It has **no authentication layer** — all requests are trusted as pre-authorized by the .NET layer.

Routes: `/mast/*`, `/analysis/*`, `/composite/*`, `/mosaic/*`, `/discovery/*`

---

## Known Gaps

| Issue | Description | Severity |
|-------|-------------|----------|
| [#571](https://github.com/Snoww3d/jwst-data-analysis/issues/571) | Deduplicate IsDataAccessible / FilterAccessibleData (tech debt) | Low |

Previously tracked gaps #565-#570 were resolved in PR #573.

---

## Design Decisions & Rationale

1. **`IsPublic` defaults to `true`**: JWST data is public domain. Import from MAST creates public records unless the user explicitly makes them private.

2. **404 over 403 for read access**: Most read endpoints return `404 Not Found` for inaccessible data rather than `403 Forbidden`. This prevents ID enumeration attacks — an attacker cannot distinguish "exists but private" from "does not exist".

3. **Processing engine has no auth**: The Python processing engine is an internal service not exposed to the internet. The .NET API acts as the auth gateway. This is a trust boundary — if the processing engine were ever exposed directly, it would need its own auth layer.

4. **Service-level auth for background jobs**: Mosaic and composite generation can run as background jobs. Since background jobs have no HTTP context, user identity is serialized into the job payload (`UserId`, `IsAuthenticated`, `IsAdmin`) and checked at the service layer.

5. **Owner-only mutations, admin bypass**: Only the record owner can modify or delete data. Admin can bypass all ownership checks. Shared users get read access only — they cannot modify shared data.

6. **Observation-level deletes require full ownership**: Deleting an entire observation or processing level requires that ALL records in the set belong to the requesting user. This prevents partial-ownership situations where one user could delete another's records in a shared observation.

---

[Back to Architecture Overview](index.md)

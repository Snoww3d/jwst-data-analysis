# CE Route Inventory → `CE_MODE` Allowlist

**Date:** 2026-07-06 · **Spike:** CE plan Phase 1 (route inventory) · Epic #1403
Traced from each CE page component through its service modules and child
components. An anonymous CE user has no stored token, so AuthContext fires no
`/api/auth/*` calls at all.

This list is the Phase 2 deny-by-default mounting spec and the target of the
CE route-table pytest.

## ALLOWLIST — mounted under `CE_MODE`

**Global (SharedLayout on every page)**

| Route | Consumer |
|---|---|
| `GET /api/health` | MastStatusPill poll |

**DiscoveryHome `/`**

| Route | Consumer |
|---|---|
| `GET /api/discovery/featured` | featured target grid |

**TargetDetail `/target/:name` + GuidedCreate `/create` (anonymous branch)**

| Route | Consumer |
|---|---|
| `POST /api/mast/search/target` | recipe resolution |
| `POST /api/discovery/suggest-recipes` | recipe suggestions |
| `POST /api/jwstdata/check-availability` | matches recipe filters against the seed library |
| `POST /api/composite/generate-nchannel` | **the CE compositing path** (sync, anonymous). CE variant must resolve `dataIds → FilePath` via the read repo and reject `allow_force_downscale` (see spike report) |

**ArchivePage `/archive`**

| Route | Consumer |
|---|---|
| `POST /api/mast/search/target` / `coordinates` / `observation` / `program` | MastSearch (4 modes) |
| `POST /api/mast/whats-new` | WhatsNewPanel |
| `POST /api/jwstdata/check-availability` | "already in library" badges |

**Library `/library` (public read-only view — review decision 2026-07-06)**

| Route | Consumer |
|---|---|
| `GET /api/jwstdata?includeArchived=…` | library grid |
| `GET /api/jwstdata/{id}/thumbnail` | cards |
| `GET /api/jwstdata/{id}/preview?cmap=&width=&height=` | image viewers |
| `GET /api/jwstdata/{id}/pixeldata?maxSize=&sliceIndex=` | ImageViewer |
| `GET /api/jwstdata/{id}/cubeinfo` | ImageViewer |
| `GET /api/jwstdata/{id}/histogram` | ImageViewer stretch histogram (fetched unconditionally — missed by the original inventory, added during Phase 2 PR4 review) |
| `GET /api/analysis/table-info` / `table-data` | TableViewer |
| `GET /api/analysis/spectral-data` | SpectralViewer |

## PENDING PHASE 3 DECISIONS (from the inventory)

1. `/library` sits under `ProtectedRoute` (`App.tsx:98`) — Phase 3 moves it to
   the public layout, read-only (decided at review; this is the code note).
2. **`/search` page gating:** the SearchPage route is mounted in the public
   layout (`App.tsx:86`) even though `/api/search/*` is excluded — Phase 3's
   `VITE_CE_MODE` must hide the `/search` page itself, or it renders against a
   dead API.
3. **Analysis compute POSTs** (`POST /api/analysis/region-statistics`,
   `POST /api/analysis/detect-sources`): recommendation — **exclude from CE v1**
   and hide their buttons in the CE build. They're secondary analysis tools and
   the only other anonymous compute surface besides the composite render; the
   capability gate can enable them later. If kept instead, they need their own
   rate limit.

## EXCLUDED — never mounted in CE

- **Auth:** `POST /api/auth/{login,register,refresh,logout}`, `GET /api/auth/me` (router never mounts)
- **Import machinery:** `POST /api/mast/import` (+ `cancel/resume/from-existing/resumable` variants, `GET import-progress`), `POST /api/mast/refresh-metadata-all`
- **Jobs/async compositing:** `POST /api/composite/generate-nchannel-async`, `POST /api/composite/export-nchannel`, `GET /api/jobs/{id}/result`, SignalR `JobProgressHub`
- **Library writes:** `POST /api/jwstdata/upload`, `archive`/`unarchive`, `DELETE /api/jwstdata/observation/...` (+ level variants + previews), `POST .../level/{level}/archive`, `POST /api/datamanagement/import/scan`
- **Not in the CE page set:** `/api/search/*` (semantic search — dropped from CE v1 by review decision), `/api/mosaic/*` (ProtectedRoute pages), `/api/composite/estimate` + `analyze-channels` (not imported by GuidedCreate; `estimate` is used by seed tooling only, server-side)

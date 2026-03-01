# Guided Discovery Experience — Design Sketch

## Vision

Turn the app from a **tool-first** data dashboard into a **content-first** discovery experience.

The core loop: **Discover → Create → Share**

Target user: someone who thinks JWST images are cool but doesn't know target names, catalog IDs, or what a FITS file is. They want to end up with a composite image they're proud to share.

---

## Current Flow (tool-first)

```
Login → Empty dashboard → ??? → (user has to figure out MAST search,
download, maybe mosaic, then composite wizard, then export)
```

Problem: requires prior knowledge of the workflow, target names, and tool purpose.

## Proposed Flow (content-first)

```
Landing → Browse/discover targets → Pick one → App handles the rest →
Tweak if you want → Export/download
```

---

## Page Structure

### 1. Home — Discovery Page (`/`)

The landing page after login. Not a dashboard — a discovery feed.

```
┌─────────────────────────────────────────────────────┐
│  JWST Data Analysis Platform            [My Library] │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  🔍 Search targets (Carina Nebula, M31, ...)   │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ── Featured Targets ──────────────────────────────  │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░ │  │
│  │ ░ thumb ░ │ │ ░ thumb ░ │ │ ░ thumb ░ │ │ ░thum░ │  │
│  │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░ │  │
│  │ Carina   │ │ Pillars  │ │ Southern │ │ Stephan│  │
│  │ Nebula   │ │ of Crea. │ │ Ring     │ │ Quintet│  │
│  │ 6 filters│ │ 4 filters│ │ 8 filters│ │ 5 filt.│  │
│  │ NIRCam   │ │ NIRCam   │ │ NIR+MIRI │ │ NIRCam │  │
│  │ [Create] │ │ [Create] │ │ [Create] │ │[Create]│  │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
│                                                      │
│  ── New from JWST (last 30 days) ──────────────────  │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░ │  │
│  │  (auto   │ │  (auto   │ │  (auto   │ │ (auto  │  │
│  │ thumb or │ │ thumb or │ │ thumb or │ │  thumb │  │
│  │ generic) │ │ generic) │ │ generic) │ │  or    │  │
│  │ IC 2944  │ │ NGC 346  │ │ WR 124   │ │generic)│  │
│  │ Released  │ │ Released  │ │ Released  │ │ Abell  │  │
│  │ 3 days   │ │ 1 week   │ │ 2 weeks  │ │ 2744   │  │
│  │ 6 filters│ │ 3 filters│ │ 5 filters│ │ 4 filt.│  │
│  │ ⭐ Great  │ │ 🟢 Good  │ │ ⭐ Great  │ │ 🟢 Good│  │
│  │ [Create] │ │ [Create] │ │ [Create] │ │[Create]│  │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
│                                                      │
│  ── Browse by Category ────────────────────────────  │
│                                                      │
│  [Nebulae]  [Galaxies]  [Star Clusters]  [Planetary] │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Card contents:**
- Thumbnail — from MAST preview image if available, or a generic placeholder by category
- Target name (common name if known, otherwise catalog ID)
- Instrument(s) available
- Number of usable filters
- Composite potential score: Great (5+ filters, multi-instrument) / Good (3-4 filters) / Limited (1-2)
- "Create" button → enters guided flow

**"New from JWST" logic:**
- Query MAST for observations released in last 30-90 days
- Group by target/program
- Score each group by composite potential (filter count, spatial coverage, instrument diversity)
- Show top N, sorted by score then recency
- Auto-refresh daily or on page load

**Featured targets:**
- Curated list of known-good targets (maintained as JSON/config)
- Each entry: target name, MAST search params, example composite thumbnail, description
- Start with ~10-15 iconic targets (the ones NASA already made press releases for)
- Users will discover these produce great results since the data quality is proven

**Categories:**
- Map from MAST `target_classification` or `dataproduct_type`
- Top-level: Nebulae, Galaxies, Star Clusters, Planetary/Solar System
- Clicking a category shows a filtered discovery feed

---

### 2. Target Detail Page (`/target/:name` or `/target/:programId`)

After clicking a card or searching, show what's available for this target.

```
┌─────────────────────────────────────────────────────┐
│  ← Back                                [My Library]  │
│                                                      │
│  Carina Nebula (NGC 3372)                            │
│  Program 2731 · NIRCam · Released 2022-07-12         │
│                                                      │
│  ── Suggested Composites ──────────────────────────  │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ ⭐ Recommended: 6-filter NIRCam                  │ │
│  │                                                   │ │
│  │ F090W · F187N · F200W · F335M · F444W · F470N    │ │
│  │ [color swatch for each filter's mapped hue]      │ │
│  │                                                   │ │
│  │ Uses all available filters for maximum detail.    │ │
│  │ Estimated processing time: ~45 seconds.           │ │
│  │ Mosaic needed: No (single pointing)               │ │
│  │                                                   │ │
│  │              [ Create This Composite ]            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Classic 3-color                                   │ │
│  │ F090W (blue) · F200W (green) · F444W (red)       │ │
│  │ Quick & simple. ~15 seconds.                      │ │
│  │              [ Create This Composite ]            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Narrowband Highlight                              │ │
│  │ F187N (H-alpha) · F335M (PAH) · F470N ([ArIII]) │ │
│  │ Emphasizes gas and emission features. ~15 sec.    │ │
│  │              [ Create This Composite ]            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ── Or customize ──────────────────────────────────  │
│  [ Advanced: Choose your own filters → ]             │
│                                                      │
│  ── Available Observations (12 files) ─────────────  │
│  (collapsible table of individual FITS files)        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Suggestion engine logic:**
- Takes the set of available observations for a target
- Groups by instrument
- For each instrument, generates recipes:
  1. "All available" — use every filter, N-channel composite
  2. "Classic 3-color" — pick 3 well-separated wavelengths (short=blue, mid=green, long=red)
  3. "Narrowband" — if narrowband filters present (N suffix), group them
  4. "Broadband" — if broadband (W suffix) available, clean wide-field composite
- Each recipe includes: filter list, auto-assigned colors, estimated time, mosaic requirement
- Rank by "visual impact" — more filters and wider wavelength spread = higher rank
- "Recommended" = highest-ranked recipe

**Mosaic detection:**
- Check if multiple observations per filter share spatial overlap (compare RA/Dec + FOV)
- If yes, note "Mosaic needed" and handle transparently in the creation flow
- If observations don't overlap, they're separate pointings — offer each independently

---

### 3. Creation Flow (`/create`)

After user clicks "Create This Composite" — a guided, mostly-automatic flow.

```
Step 1: Download          Step 2: Processing        Step 3: Your Composite
━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━○━━━━━━━━━━━━━━━━━━━━○━━━

┌─────────────────────────────────────────────────────┐
│                                                      │
│  Downloading Carina Nebula data...                   │
│                                                      │
│  ████████████████████░░░░░  4 of 6 files             │
│                                                      │
│  F090W  ✓ complete     (42 MB)                       │
│  F187N  ✓ complete     (42 MB)                       │
│  F200W  ✓ complete     (42 MB)                       │
│  F335M  ████████░░░░   67% (28/42 MB)               │
│  F444W  waiting...                                   │
│  F470N  waiting...                                   │
│                                                      │
│  Using S3 direct access (faster)                     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

```
Step 1: Download          Step 2: Processing        Step 3: Your Composite
━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━●━━━━━━━━━━━━━━━━○━━━

┌─────────────────────────────────────────────────────┐
│                                                      │
│  Creating your composite...                          │
│                                                      │
│  ✓ Files loaded                                      │
│  ✓ Aligning to common grid                           │
│  ● Applying color mapping...                         │
│  ○ Final adjustments                                 │
│                                                      │
│  (This usually takes 30-60 seconds)                  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

```
Step 1: Download          Step 2: Processing        Step 3: Your Composite
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━

┌─────────────────────────────────────────────────────┐
│                                                      │
│  ┌───────────────────────────────────────────────┐   │
│  │                                               │   │
│  │                                               │   │
│  │          (composite preview image)            │   │
│  │                                               │   │
│  │                                               │   │
│  │                                               │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  Carina Nebula — 6-filter NIRCam Composite           │
│  Filters: F090W · F187N · F200W · F335M · F444W ·   │
│           F470N                                      │
│                                                      │
│  ── Quick Adjustments ─────────────────────────────  │
│  Brightness  ├────────●──────┤                       │
│  Contrast    ├──────────●────┤                       │
│  Saturation  ├───────●───────┤                       │
│                                                      │
│  [ Download PNG ]  [ Download JPEG ]                 │
│                                                      │
│  ── Want more control? ────────────────────────────  │
│  [ Open in Advanced Editor → ]                       │
│  (per-channel stretch, smoothing, annotations, etc.) │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Key design decisions:**
- Download + processing are sequential but feel like one flow
- Existing download progress UI reused
- Composite generation uses the job queue + SignalR (existing infra)
- "Quick Adjustments" = simplified controls that map to existing stretch params
  - Brightness → black/white point shift
  - Contrast → stretch method or gamma
  - Saturation → channel weight balance
- "Advanced Editor" → opens existing ImageViewer/CompositeWizard with full controls
- Export uses existing export flow (PNG/JPEG with resolution presets)

---

### 4. My Library (`/library`)

The current dashboard, relocated. Contains:
- Previously downloaded observations (existing DataCard grid)
- Saved composites/mosaics/exports
- Access to full viewer and all advanced tools
- Upload functionality for local FITS files

This is where power users live. The guided flow adds data here automatically.

---

## Navigation Structure

```
Home (/)
├── Target Detail (/target/:name)
│   └── Create Flow (/create?target=X&recipe=Y)
│       └── Result → Advanced Editor (existing viewer modal)
├── My Library (/library)  ← current dashboard
│   ├── Viewer (modal, existing)
│   ├── Composite Wizard (modal, existing)
│   ├── Mosaic Wizard (modal, existing)
│   └── MAST Search (existing, for manual searches)
└── Search Results (/search?q=...)
```

**Routing change:** Moves from single-page modal-only to actual routes. Browser back button works. Deep-linking possible (foundation for permalinks later).

---

## New Backend Needs

### 1. Suggestion Engine Endpoint

```
POST /api/discovery/suggest-composites
Body: { targetName: string } or { observations: MastObservation[] }
Response: {
  target: { name, commonName, ra, dec, category },
  recipes: [
    {
      name: "6-filter NIRCam",
      rank: 1,
      filters: ["F090W", "F187N", ...],
      colorMapping: { "F090W": "#4444ff", ... },
      instruments: ["NIRCam"],
      requiresMosaic: false,
      estimatedTimeSeconds: 45,
      observationIds: ["obs1", "obs2", ...]
    },
    ...
  ]
}
```

Logic lives in Python processing engine (knows about JWST filters, wavelengths, instruments). Backend proxies.

### 2. Featured Targets Config

Start as a static JSON file:
```json
[
  {
    "name": "Carina Nebula",
    "catalogId": "NGC 3372",
    "category": "nebula",
    "thumbnail": "/featured/carina-thumb.jpg",
    "description": "Star-forming region, one of JWST's first images",
    "mastSearchParams": { "target": "Carina Nebula", "instrument": "NIRCam" }
  },
  ...
]
```

Can be promoted to a database-backed API later if we want community submissions.

### 3. Recent Releases Query

```
GET /api/discovery/recent?days=30&minFilters=3
```

Wraps MAST search with:
- `t_obs_release` date filter
- Groups results by target
- Scores composite potential
- Returns top N targets with metadata

### 4. Common Name Resolution

Many MAST targets use catalog IDs (NGC, IC, Messier). Need a mapping to common names:
- "NGC 3372" → "Carina Nebula"
- "M16" → "Eagle Nebula / Pillars of Creation"
- Could use SIMBAD API or a static lookup table

---

## What Changes vs. Stays

### Stays (reused as-is):
- All Python processing (composite, mosaic, preview, stretch)
- S3/local storage providers
- MAST search and download APIs
- Export pipeline
- Job queue + SignalR progress
- Auth system
- MongoDB data model

### Changes:
- **New frontend pages:** Home (discovery), Target Detail, Create Flow
- **Router:** Add actual routes instead of modal-only navigation
- **Dashboard:** Becomes "My Library" at `/library`
- **New API endpoints:** suggestion engine, featured targets, recent releases
- **New Python logic:** composite recipe scoring, filter grouping

### Deferred (post-v1):
- "New from JWST" discovery feed
- Light mode
- Sharing/gallery
- Community-submitted featured targets
- Category browsing
- Common name resolution via SIMBAD
- Public (no-auth) home page

---

## v1 Scope (Finalized)

### In v1
- **Home page** — featured targets (static JSON, ~10-15 curated) + search bar
- **Target detail page** — suggestion engine shows 2-3 composite recipes per target
- **Guided creation flow** — download → auto-mosaic if needed → auto-composite → simple adjustments → export
- **My Library** — current dashboard relocated to `/library`, all existing tools accessible
- **React Router** — real routes (`/`, `/library`, `/target/:name`, `/create`), browser back works
- **Suggestion engine** — new Python endpoint for recipe generation (filter grouping, scoring, mosaic detection)
- **Featured targets config** — static JSON with ~10-15 curated targets + MAST search params
- **Chromatic ordering color mapping** — replace absolute wavelength→hue with relative chromatic ordering (shortest=blue, longest=red, middle filters evenly spaced). Matches how STScI/DePasquale creates NASA press releases. See `docs/plans/design/color-mapping-research.md` for analysis.
- **Smart defaults** — stretch/color settings tuned so first composite looks good without tweaking
- **Token enforcement** — design system consistency across all pages in the core loop
- **Loading/error states** — for discovery, download, processing, and result screens

### NOT in v1
- "New from JWST" discovery feed (v1.1 — needs date queries + scoring)
- Categories / browse by type (v1.1)
- Common name resolution via SIMBAD (featured targets have names hardcoded)
- Light mode
- Sharing / gallery / public links
- Public home page (auth still required for v1)
- Pre-computed thumbnails (use MAST preview images or placeholders)
- Mobile-optimized layouts
- Onboarding tooltips (guided flow IS the onboarding)
- Remaining Phase 5 items (batch processing, spectral analysis, photometry)
- Smoothing/annotations/source detection polish (stays in Advanced Editor as-is)

### NOT in v1 but stays accessible
All existing power-user features live in My Library → Viewer. No changes needed — they're the advanced layer for users who go deeper.

---

## Current Architecture (what has to change)

### Frontend — modal-based, single-page

The app currently has no meaningful routing. React Router exists but only handles `/login`, `/register`, and a catch-all `/*` that renders `MainApp`. Every feature is a modal or toggled panel controlled by boolean state, not a URL.

**`JwstDataDashboard.tsx` (685 lines)** is the entire UX after login. It manages ~20 pieces of local state controlling:
- Filters (dataType, processingLevel, viewability, tags, search)
- View modes (lineage vs target view)
- Modal visibility (MAST search, upload, composite wizard, mosaic wizard, comparison picker)
- Viewer states (image, table, spectral)

Component hierarchy today:
```
App.tsx
├── /login → LoginPage
├── /register → RegisterPage
└── /* → ProtectedRoute → MainApp
    └── JwstDataDashboard (state hub for everything)
        ├── DashboardToolbar
        ├── [Panels: MastSearch, WhatsNewPanel, UploadModal]
        ├── [View: TargetGroupView | LineageView]
        └── [Modals: ImageViewer, CompositeWizard, MosaicWizard, TableViewer, SpectralViewer]
```

**Consequences for the pivot:**
- No deep-linking, no browser back button, no shareable URLs
- Adding pages means splitting the dashboard monolith — every feature entry point is currently a `setState` call
- `ImageViewer` alone is 1500+ lines as a modal; moving features to pages requires careful state extraction
- No global state layer beyond AuthContext — feature state lives in the dashboard component

### Backend — solid, mostly reusable

The backend is in good shape. Existing infrastructure covers most of what the guided flow needs:

**Already built (reuse as-is):**
- MAST search (target, coordinates, program, recent) — `MastController`
- Download with progress — `MastController` + job queue + SignalR
- Composite generation (sync + async export) — `CompositeController` + `CompositeQueue`
- Mosaic generation with WCS reprojection — `MosaicController`
- Job queue with SignalR progress broadcasting — `JobsController` + `JobProgressHub`
- All Python processing (stretch, color mapping, reprojection, source detection)

**Needs to be built:**
- `DiscoveryController` — serves featured targets config, proxies to recipe engine
- Recipe/suggestion engine (Python) — filter grouping, scoring, mosaic detection, chromatic ordering
- No orchestration endpoint needed — frontend can chain existing endpoints via the job queue

### What stays untouched
- Auth system
- MongoDB data model
- S3/local storage providers
- All Python processing logic (composite, mosaic, preview, stretch, enhancement)
- Export pipeline
- All existing API endpoints (nothing removed, only additions)

---

## Phased Implementation

### Dependencies

```
Phase A (routing + layout) ──→ Phase C (new pages) ──→ Phase D (polish)
                           ↗
Phase B (recipe engine)  ─┘
```

A and B are independent — can be built in parallel. C depends on both. D is polish after C.

### Risk assessment

| Phase | Risk | Why |
|-------|------|-----|
| A | **Medium-high** | Structural surgery — splits the dashboard monolith, adds routing, changes what users see after login. Touches the most existing code. |
| B | **Low** | Purely additive — new Python endpoint, new .NET controller, new color mapping mode. No existing code removed or modified. |
| C | **Medium** | Three new page components, but builds on A's routing and B's endpoints. Reuses existing services (download, composite, mosaic). |
| D | **Low** | Polish pass — loading states, error states, token enforcement. No structural changes. |

### Phase A — Routing + Layout (structural, highest risk)

**The core change:** Move from modal-based navigation to page-based routing.

Specific work:
- Add routes: `/` (discovery home), `/library` (current dashboard), `/target/:name`, `/create`
- Create a shared layout shell (header + nav that persists across routes)
- **Rename/move `JwstDataDashboard` → `MyLibrary`** at `/library` with all its modals intact (minimize changes to existing code)
- Update `ProtectedRoute` to wrap the new layout shell, not just `MainApp`
- Change post-login redirect from `/` (dashboard) to `/` (discovery home)
- Featured targets JSON config file (~10-15 entries) — ships with the code, not a database

**What to watch for:**
- `JwstDataDashboard` state that assumes it's always mounted (e.g., data fetch on mount) — needs to handle mount/unmount as user navigates
- Services that use callbacks tied to dashboard state (e.g., `onDataUpdate`) — may need lifting to context
- Image viewer deep-linking — currently `setViewingImageId(id)` is ephemeral state; consider whether `/library?view=<id>` is worth doing now or deferring

### Phase B — Suggestion Engine + Chromatic Ordering (additive, low risk)

**New Python endpoint:** `POST /discovery/suggest-recipes`
- Input: list of MAST observations (or target name to search first)
- Logic: group by instrument, sort by wavelength, detect broadband vs narrowband, check RA/Dec overlap for mosaic needs
- Output: 2-3 ranked recipes with filter lists, chromatic-ordered color assignments, estimated complexity

**Chromatic ordering color mapping:**
- New `chromatic_order` mode in `color_mapping.py` and `wavelengthUtils.ts`
- Sort filters by wavelength, assign evenly-spaced hues from 240° (blue) → 0° (red) relative to the set
- Keep existing wavelength-to-hue as "scientific" option
- Make chromatic ordering the default for auto-assign and all recipes
- See `docs/plans/design/color-mapping-research.md` for full analysis

**New .NET controller:** `DiscoveryController`
- `GET /api/discovery/featured` — serve featured targets JSON
- `POST /api/discovery/suggest-recipes` — proxy to Python engine

### Phase C — New Frontend Pages (depends on A + B)

**Home / Discovery page (`/`):**
- Search bar (calls existing MAST target search)
- Featured target cards from config
- Each card shows: name, instrument, filter count, composite potential, "Create" button
- "Create" navigates to `/target/:name`

**Target detail page (`/target/:name`):**
- Fetches observations from MAST for this target
- Calls suggestion engine for recipes
- Shows 2-3 recipe cards (recommended, classic 3-color, narrowband if available)
- Each recipe shows: filters, color swatches, mosaic needed, "Create This Composite" button
- "Advanced: Choose your own filters →" escape hatch to existing wizard in `/library`

**Guided creation flow (`/create?target=X&recipe=Y`):**
- 3-step stepper: Download → Process → Result
- Download step: reuses existing download progress UI + SignalR
- Process step: chains mosaic (if needed) → composite via job queue + SignalR
- Result step: preview image + simple adjustment sliders (brightness, contrast, saturation map to existing stretch params) + export buttons
- "Open in Advanced Editor" → navigates to `/library` with the new data selected
- Created data automatically appears in My Library

**No new orchestration endpoint** — the frontend manages the chain:
1. Start MAST import job → wait for SignalR completion
2. If mosaic needed → call mosaic endpoint with downloaded files → wait
3. Call composite endpoint with recipe params → wait
4. Show result

### Phase D — Polish + Release Prep

- Loading skeletons for discovery home and target detail
- Error states: MAST down, download failures, composite failures, empty results
- Token enforcement / design system consistency across all new pages
- End-to-end test: run every featured target through the full flow, verify results look good
- Curate featured targets — prune any that produce poor composites
- Update project documentation for new architecture

---

---

## Open Questions

1. ~~**Mosaic in guided flow v1?**~~ **ANSWERED: No, mosaic is required for v1.** MAST data shows multi-pointing is common even for iconic targets (Stephan's Quintet MIRI = 3-7 pointings, Tarantula Nebula = 2-3 pointings across both instruments, SMACS 0723 = 2 pointings on some filters). The guided flow must handle "download → auto-mosaic if needed → composite" as one seamless step.

2. **Auth for home page?** Currently everything requires login. Should the discovery feed be public (drives adoption) with login required only for creating composites?

3. **Pre-computed composites for featured targets?** Could ship with pre-generated thumbnails for featured targets so the home page looks rich immediately. Users create their own version when they click "Create."

4. **Download storage management?** If many users create composites from popular targets, the same FITS files get downloaded repeatedly. Cache at the app level? Shared storage for popular targets?

5. **How to handle targets with 100+ observations?** Some programs have massive observation sets (e.g., Stephan's Quintet = 292 obs). Need pagination and smart grouping on the target detail page.

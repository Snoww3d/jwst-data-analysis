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
- **Chromatic ordering color mapping** — replace absolute wavelength→hue with relative chromatic ordering (shortest=blue, longest=red, middle filters evenly spaced). Matches how STScI/DePasquale creates NASA press releases. See `docs/plans/color-mapping-research.md` for analysis.
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

## Phased Implementation

### Phase A — Foundation (routing + home page shell)
- Add React Router with actual routes (`/`, `/library`, `/target/:name`, `/create`)
- Move current dashboard to `/library`
- Create Home page component with search bar + featured target cards
- Featured targets JSON config (~10-15 entries with MAST search params)
- Design token enforcement on new pages from the start

### Phase B — Suggestion Engine + Target Detail
- Python endpoint: given MAST observations, generate composite recipes
- Filter grouping logic (broadband vs narrowband, wavelength sorting)
- Multi-pointing detection (compare RA/Dec separation vs instrument FOV)
- Recipe scoring (filter count, wavelength spread, known-good combos)
- **Chromatic ordering color mapping** — new `chromatic_order` mode in `color_mapping.py` and `wavelengthUtils.ts`. Sort filters by wavelength, assign blue→green→orange→red spread relative to the set. Keep existing hue-based mode as "scientific" option. Apply chromatic ordering as default for auto-assign and all recipes.
- .NET proxy endpoint
- Target detail page wired to suggestion engine
- Search results page (target search → target detail)

### Phase C — Guided Creation Flow
- Orchestration: download → auto-mosaic (if multi-pointing) → auto-composite
- All via job queue + SignalR with stage-by-stage progress
- Smart default stretch/color settings (tuned per recipe)
- Result screen with simple sliders (brightness, contrast, saturation)
- PNG/JPEG export (existing pipeline)
- "Open in Advanced Editor" escape hatch to existing viewer/wizard
- Data automatically appears in My Library after creation

### Phase D — Polish + Release Prep
- Token enforcement across all touched components
- Loading skeletons for home page and target detail
- Error states (MAST down, download failures, composite failures)
- Test the full flow end-to-end with all featured targets
- Curate and verify featured targets produce good results
- Update documentation for new architecture

---

## Open Questions

1. ~~**Mosaic in guided flow v1?**~~ **ANSWERED: No, mosaic is required for v1.** MAST data shows multi-pointing is common even for iconic targets (Stephan's Quintet MIRI = 3-7 pointings, Tarantula Nebula = 2-3 pointings across both instruments, SMACS 0723 = 2 pointings on some filters). The guided flow must handle "download → auto-mosaic if needed → composite" as one seamless step.

2. **Auth for home page?** Currently everything requires login. Should the discovery feed be public (drives adoption) with login required only for creating composites?

3. **Pre-computed composites for featured targets?** Could ship with pre-generated thumbnails for featured targets so the home page looks rich immediately. Users create their own version when they click "Create."

4. **Download storage management?** If many users create composites from popular targets, the same FITS files get downloaded repeatedly. Cache at the app level? Shared storage for popular targets?

5. **How to handle targets with 100+ observations?** Some programs have massive observation sets (e.g., Stephan's Quintet = 292 obs). Need pagination and smart grouping on the target detail page.

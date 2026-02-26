# UX Spec: Target Detail Page + Guided Creation Flow

## Overview

This spec covers:
1. **Target Detail Page** (`/target/:name`) — shows what's available for a target + suggested composite recipes
2. **Guided Creation Flow** (`/create`) — 3-step automatic pipeline: Download, Process, Result

These two pages form the core "happy path" of the guided experience.

---

## 1. Target Detail Page (`/target/:name`)

### Purpose

After a user picks a target (from featured cards or search), this page answers: "What can I make with this?" It shows pre-built recipes ranked by quality, plus an escape hatch to full manual control.

### Text Wireframe — Loaded State

```
+-----------------------------------------------------------------------+
|                        << AppHeader >>                                |
+-----------------------------------------------------------------------+
|                                                                       |
|  [< Back]                                                             |
|                                                                       |
|  Carina Nebula                                                        |
|  NGC 3372  .  Program 2731  .  NIRCam  .  Released 2022-07-12        |
|  Star-forming region, one of JWST's first images                      |
|                                                                       |
|  -- Suggested Composites -------------------------------------------- |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |  * Recommended                                                    | |
|  |                                                                   | |
|  |  6-Filter NIRCam Composite                                        | |
|  |                                                                   | |
|  |  [F090W] [F187N] [F200W] [F335M] [F444W] [F470N]                 | |
|  |   blue  l-blue  green   yellow  orange    red                     | |
|  |                                                                   | |
|  |  Uses all available filters for maximum color detail.             | |
|  |  Processing time: ~45 sec  .  Mosaic: not needed                  | |
|  |                                                                   | |
|  |                    [ Create This Composite ]                      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |  Classic 3-Color                                                  | |
|  |                                                                   | |
|  |  [F090W] [F200W] [F444W]                                         | |
|  |   blue    green    red                                            | |
|  |                                                                   | |
|  |  Clean wide-field image using well-separated wavelengths.         | |
|  |  Processing time: ~15 sec  .  Mosaic: not needed                  | |
|  |                                                                   | |
|  |                    [ Create This Composite ]                      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |  Narrowband Highlight                                             | |
|  |                                                                   | |
|  |  [F187N] [F335M] [F470N]                                         | |
|  |   blue    green    red                                            | |
|  |                                                                   | |
|  |  Emphasizes gas and emission features.                            | |
|  |  Processing time: ~15 sec  .  Mosaic: not needed                  | |
|  |                                                                   | |
|  |                    [ Create This Composite ]                      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  -- Or Customize ---------------------------------------------------- |
|                                                                       |
|  Want more control? Choose your own filters, colors, and              |
|  stretch settings in the advanced editor.                             |
|                                                                       |
|  [ Open Advanced Editor > ]                                           |
|                                                                       |
|  -- Available Observations (12 files) ------ [v Expand] ------------ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### Component Hierarchy

```
<TargetDetailPage>                    // page component at "/target/:name"
  <BackLink />                        // "< Back" navigation
  <TargetHeader />                    // name, metadata, description
  <section>
    <SectionHeader title="Suggested Composites" />
    <RecipeCardList>
      <RecipeCard recommended />      // first recipe (highlighted)
      <RecipeCard />                  // additional recipes
      <RecipeCard />
    </RecipeCardList>
  </section>
  <section>
    <SectionHeader title="Or Customize" />
    <AdvancedEscapeHatch />           // link to advanced editor
  </section>
  <section>
    <ObservationList />               // collapsible list of raw MAST observations
  </section>
</TargetDetailPage>
```

### Component: `<BackLink>`

**Purpose:** Return to the previous page (discovery home or search results).

**Styling:**
- Text: "Back" with left-pointing chevron icon
- Font: 0.875rem, weight 500, `--text-secondary`
- Hover: `--text-primary`
- Uses `useNavigate(-1)` from React Router (true browser-back behavior)
- Margin-bottom: 16px
- No underline

### Component: `<TargetHeader>`

**Props:**
```typescript
interface TargetHeaderProps {
  name: string;               // "Carina Nebula"
  catalogId?: string;         // "NGC 3372"
  programId?: string;         // "2731"
  instruments: string[];      // ["NIRCam"]
  releaseDate?: string;       // "2022-07-12"
  description?: string;       // from featured targets config
}
```

**Styling:**
- Name: 1.75rem (desktop) / 1.375rem (mobile), weight 700, `--text-primary`
- Metadata row: 0.875rem, `--text-secondary`, items separated by middle dots
  - Each metadata item: `catalogId . Program programId . instrument(s) . Released date`
  - Only show items that have values
- Description: 0.9rem, `--text-secondary`, margin-top 8px, max-width 700px
- Overall margin-bottom: 32px

### Component: `<RecipeCard>`

**Props:**
```typescript
interface RecipeCardProps {
  name: string;                // "6-Filter NIRCam Composite"
  recommended?: boolean;       // highlights the card
  filters: Array<{
    name: string;              // "F090W"
    color: string;             // hex color from chromatic ordering
    wavelength: number;        // for tooltip
  }>;
  description: string;         // "Uses all available filters..."
  estimatedTimeSeconds: number;
  requiresMosaic: boolean;
  instruments: string[];
  onCreateClick: () => void;   // starts the creation flow
}
```

**Text Wireframe (single card):**
```
+------------------------------------------------------------------+
|  * Recommended                           (only if recommended)    |
|                                                                   |
|  6-Filter NIRCam Composite               <- recipe name           |
|                                                                   |
|  [F090W] [F187N] [F200W] [F335M] [F444W] [F470N]  <- filter chips|
|   ____    ____    ____    ____    ____    ____      <- color bars  |
|                                                                   |
|  Uses all available filters for maximum color detail.             |
|  Processing time: ~45 sec  .  Mosaic: not needed                  |
|                                                                   |
|                    [ Create This Composite ]                      |
+------------------------------------------------------------------+
```

**Card styling:**

Base card:
- Background: `--bg-surface`
- Border: `1px solid var(--border-subtle)`
- Border-radius: `--radius-lg`
- Padding: 24px
- Margin-bottom: 16px
- Max-width: 720px (recipes don't need full width — too wide makes the cards feel sparse)

Recommended card (additional):
- Border-color: `var(--accent-primary)` (subtle blue highlight)
- Background: slight blue tint — `linear-gradient(135deg, rgba(59, 130, 246, 0.04), var(--bg-surface))`
- "Recommended" badge: top-left, `--accent-primary` text, 0.75rem, weight 600, with a small star icon

**"Recommended" badge:**
- Display: inline-flex, align-items center, gap 4px
- Color: `--accent-primary`
- Font: 0.75rem, weight 600, text-transform uppercase, letter-spacing 0.05em
- Star icon: 12x12 SVG, filled `--accent-primary`
- Margin-bottom: 12px

**Recipe name:**
- Font: 1.125rem, weight 600, `--text-primary`
- Margin-bottom: 16px

**Filter chips row:**
- Display: flex, flex-wrap: wrap, gap: 8px
- Each chip:
  - Display: inline-flex, flex-direction column, align-items center, gap 4px
  - Filter name: 0.75rem, weight 500, `--text-primary`, background: `--bg-elevated`, padding: 4px 10px, border-radius: `--radius-sm`, border: `1px solid var(--border-default)`
  - Color bar: 4px height, 100% width of chip, border-radius 2px, background: the filter's assigned color
  - Color label (optional): 0.65rem, `--text-muted` — shows the role ("blue", "green", "red", etc.)
    - Only show on desktop, hide on mobile to save space
- Margin-bottom: 16px

**Description:**
- Font: 0.875rem, `--text-secondary`, line-height 1.5
- Margin-bottom: 12px

**Metadata row:**
- Font: 0.8rem, `--text-muted`
- Items: "Processing time: ~N sec" + separator + "Mosaic: not needed" or "Mosaic: required (N pointings)"
- Mosaic indicator:
  - Not needed: `--text-muted` (neutral)
  - Required: `--color-info` (blue, informational — not a warning, the system handles it automatically)
- Margin-bottom: 20px

**CTA Button: "Create This Composite"**
- Full-width within card (max-width 320px, centered)
- Height: 44px
- Background: `--accent-primary`
- Color: white
- Font: 0.9rem, weight 600
- Border-radius: `--radius-md`
- Hover: `--accent-primary-hover`, slight translateY(-1px), `--shadow-sm`
- Active: no translate, darker bg
- Focus: 2px outline `--accent-primary`, offset 2px
- Transition: all `--transition-fast`

### Component: `<AdvancedEscapeHatch>`

**Purpose:** For users who want manual control. Links to My Library where they can use the existing wizard.

**Styling:**
- Short explanation paragraph: 0.875rem, `--text-secondary`
- Link button: outlined style (border: `1px solid var(--border-default)`, no fill)
  - Text: "Open Advanced Editor"
  - Right arrow icon (chevron-right, 14px)
  - Font: 0.875rem, weight 500, `--text-secondary`
  - Hover: border `--border-strong`, text `--text-primary`
  - Height: 40px, padding: 0 20px
  - Border-radius: `--radius-md`
- Clicking navigates to `/library` (and in the future, could pre-select the target's files)

### Component: `<ObservationList>`

**Purpose:** Shows the raw observation files available. Collapsed by default — most users won't need this.

**Collapsed state:**
```
-- Available Observations (12 files) ---- [v Expand] --
```

**Expanded state:**
```
-- Available Observations (12 files) ---- [^ Collapse] --

  Filename                          Filter  Instrument  Size
  jw02731001001_02101_00001_nrcb... F090W   NIRCam      42 MB
  jw02731001001_02101_00001_nrcb... F187N   NIRCam      42 MB
  ...
```

**Styling:**
- Header: SectionHeader with count badge + expand/collapse toggle
- Toggle: text button, `--text-secondary`, with chevron icon that rotates
- Table: simple, no outer borders, row separator: `1px solid var(--border-subtle)`
- Font: 0.8rem mono for filenames, 0.8rem sans for other columns
- This is informational only — no actions on individual rows
- Max-height when expanded: 400px with overflow-y scroll

### Loading State: `<TargetDetailSkeleton>`

Shown while MAST observations are being fetched and recipes are being generated.

```
+-----------------------------------------------------------------------+
|                                                                       |
|  [< Back]                                                             |
|                                                                       |
|  [░░░░░░░░░░░░░░░░░░░░]       <- name skeleton                       |
|  [░░░░░░░░░░░░░░░░░░░░░░░░]   <- metadata skeleton                   |
|                                                                       |
|  -- Suggested Composites -------------------------------------------- |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |  [░░░░░░░░░░░░░░░░░]   <- recipe name skeleton                   | |
|  |                                                                   | |
|  |  [░░] [░░] [░░] [░░] [░░]  <- filter chip skeletons              | |
|  |                                                                   | |
|  |  [░░░░░░░░░░░░░░░░░░░░░░░░░░░]  <- description skeleton          | |
|  |  [░░░░░░░░░░░░░░░░]              <- metadata skeleton             | |
|  |                                                                   | |
|  |       [░░░░░░░░░░░░░░░░░░░░░░░]  <- button skeleton              | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |  (second recipe skeleton, same pattern)                           | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

- Show 2-3 skeleton recipe cards
- Same shimmer animation as discovery home skeletons
- Back link is real (not skeleton) — user can always go back

### Loading Message

Below the skeleton, show a friendly status message:

```
  Searching MAST for Carina Nebula observations...
```

Then when recipes are being computed:

```
  Found 12 observations. Generating composite recipes...
```

- Font: 0.875rem, `--text-secondary`, centered
- Small spinner (16px) inline before the text
- Updates via state as the two API calls resolve sequentially

### Error States

**MAST search failed:**
```
+-----------------------------------------------------------------------+
|  [< Back]                                                             |
|                                                                       |
|  Carina Nebula                                                        |
|                                                                       |
|         (warning icon, 48px, --color-warning)                         |
|                                                                       |
|         Could not search MAST for this target.                        |
|         The archive service may be temporarily unavailable.           |
|                                                                       |
|         [ Try Again ]    [ Go Back ]                                  |
|                                                                       |
+-----------------------------------------------------------------------+
```

- "Try Again" retries the MAST search (primary button style)
- "Go Back" navigates back (outlined button style)
- Error message is specific — not a generic "something went wrong"

**No observations found:**
```
+-----------------------------------------------------------------------+
|  [< Back]                                                             |
|                                                                       |
|  Carina Nebula                                                        |
|                                                                       |
|         (telescope icon, 48px, --text-muted)                          |
|                                                                       |
|         No JWST observations found for "Carina Nebula".              |
|                                                                       |
|         This could mean:                                              |
|         - The name might be spelled differently in MAST               |
|         - Observations for this target haven't been released yet      |
|                                                                       |
|         Try searching with a different name or catalog ID.            |
|                                                                       |
|         [ Go Back to Discovery ]                                      |
|                                                                       |
+-----------------------------------------------------------------------+
```

- Friendly, not blaming the user
- Suggests actionable next steps
- Link back to discovery home

**Recipe generation failed (observations found but engine error):**
```
+-----------------------------------------------------------------------+
|  [< Back]                                                             |
|                                                                       |
|  Carina Nebula                                                        |
|  NGC 3372  .  NIRCam  .  12 observations found                       |
|                                                                       |
|         Could not generate composite suggestions.                     |
|         You can still create a composite manually in the              |
|         advanced editor.                                              |
|                                                                       |
|         [ Open Advanced Editor > ]    [ Try Again ]                   |
|                                                                       |
+-----------------------------------------------------------------------+
```

- Falls back gracefully — user can still use the data
- Provides the escape hatch to advanced editor

### Responsive Behavior

**Desktop (>= 1024px):**
- Recipe cards: max-width 720px
- Page content centered with 24px padding

**Tablet (768-1023px):**
- Recipe cards: full width
- Filter chips may wrap to 2 rows

**Mobile (< 768px):**
- Recipe cards: full width, reduced padding (16px)
- Filter chip color labels hidden
- CTA button: full width (no max-width constraint)
- Metadata row items stack vertically instead of inline

### Accessibility

- Page heading (`<h1>`) is the target name — focus moves here on page load
- Recipe cards are `<article>` elements with `aria-labelledby` pointing to recipe name
- Filter chips: each has `aria-label="Filter F090W, mapped to blue"`
- CTA buttons: clear label "Create This Composite" — if multiple recipes, screen reader can distinguish by the `aria-describedby` on each card linking to recipe name
- Keyboard: Tab through back link -> recipes -> CTA buttons -> escape hatch -> observation toggle
- "Recommended" badge has `role="status"` so screen readers announce it

---

## 2. Guided Creation Flow (`/create`)

### Purpose

After clicking "Create This Composite" on a recipe, this page handles the entire pipeline automatically. The user watches it happen and gets a result they can tweak and export.

### URL Parameters

```
/create?target=carina-nebula&recipe=0
```

- `target`: URL-safe target slug
- `recipe`: index of the selected recipe from the suggestion engine response

The page reads these params, retrieves the recipe data (from state passed via navigation, or by re-fetching), and starts the pipeline.

### Flow Overview

```
Step 1: Download  ------>  Step 2: Process  ------>  Step 3: Result
(get FITS files)          (mosaic + composite)       (preview + export)
```

Each step auto-advances when complete. No user action needed between steps (but user can cancel at any point).

### Text Wireframe — Step 1: Download

```
+-----------------------------------------------------------------------+
|                        << AppHeader >>                                |
+-----------------------------------------------------------------------+
|                                                                       |
|  [< Cancel]                                                           |
|                                                                       |
|  Creating: Carina Nebula — 6-Filter NIRCam Composite                  |
|                                                                       |
|  (1) Download  --------  (2) Process  --------  (3) Result            |
|      [active]               [pending]              [pending]          |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |                                                                   | |
|  |  Downloading observation data from MAST...                        | |
|  |                                                                   | |
|  |  ████████████████████░░░░░░░  4 of 6 files                        | |
|  |                                                                   | |
|  |  F090W   [done]     42 MB                                         | |
|  |  F187N   [done]     42 MB                                         | |
|  |  F200W   [done]     42 MB                                         | |
|  |  F335M   ████░░░░   67%  (28 / 42 MB)   ETA: 12s                 | |
|  |  F444W   waiting                                                  | |
|  |  F470N   waiting                                                  | |
|  |                                                                   | |
|  |  Download source: S3 direct access (faster)                       | |
|  |                                                                   | |
|  +------------------------------------------------------------------+ |
|  |                                                                   | |
|  |                       [ Cancel ]                                  | |
|  |                                                                   | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### Text Wireframe — Step 2: Process

```
+-----------------------------------------------------------------------+
|                                                                       |
|  [< Cancel]                                                           |
|                                                                       |
|  Creating: Carina Nebula — 6-Filter NIRCam Composite                  |
|                                                                       |
|  (1) Download  --------  (2) Process  --------  (3) Result            |
|      [done]                  [active]              [pending]          |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |                                                                   | |
|  |  Building your composite...                                       | |
|  |                                                                   | |
|  |  [done]   Files downloaded                                        | |
|  |  [done]   Aligning to common grid                                 | |
|  |  [....>]  Applying color mapping                                  | |
|  |  [ ]      Final adjustments                                       | |
|  |                                                                   | |
|  |  This usually takes 30-60 seconds.                                | |
|  |                                                                   | |
|  +------------------------------------------------------------------+ |
|  |                                                                   | |
|  |                       [ Cancel ]                                  | |
|  |                                                                   | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

If mosaic is needed, add a step between "Files downloaded" and "Aligning":
```
  [done]   Files downloaded
  [done]   Creating mosaic (3 pointings aligned)
  [....>]  Applying color mapping
  [ ]      Final adjustments
```

### Text Wireframe — Step 3: Result

```
+-----------------------------------------------------------------------+
|                                                                       |
|  [< Back to Target]                                                   |
|                                                                       |
|  Creating: Carina Nebula — 6-Filter NIRCam Composite                  |
|                                                                       |
|  (1) Download  --------  (2) Process  --------  (3) Result            |
|      [done]                  [done]                [active]           |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |                                                                   | |
|  |  +--------------------------------------------------------------+ | |
|  |  |                                                              | | |
|  |  |                                                              | | |
|  |  |               (composite preview image)                      | | |
|  |  |                                                              | | |
|  |  |                                                              | | |
|  |  |                                                              | | |
|  |  +--------------------------------------------------------------+ | |
|  |                                                                   | |
|  |  Carina Nebula — 6-Filter NIRCam Composite                        | |
|  |  F090W . F187N . F200W . F335M . F444W . F470N                    | |
|  |                                                                   | |
|  |  -- Quick Adjustments ------------------------------------------- | |
|  |                                                                   | |
|  |  Brightness   [----------*------]                                 | |
|  |  Contrast     [------------*----]                                 | |
|  |  Saturation   [---------*-------]                                 | |
|  |                                                                   | |
|  |               [ Download PNG ]  [ Download JPEG ]                 | |
|  |                                                                   | |
|  |  -- Want more control? ------------------------------------------ | |
|  |  [ Open in Advanced Editor > ]                                    | |
|  |                                                                   | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### Component Hierarchy

```
<GuidedCreationPage>                 // page component at "/create"
  <CreationHeader />                 // cancel/back link + title
  <WizardStepper />                  // reuse existing stepper (3 steps)
  <CreationStepContainer>            // renders current step content
    <!-- Step 1 -->
    <DownloadStep />
      <OverallProgress />            // overall progress bar
      <FileProgressList />           // per-file progress rows
    <!-- Step 2 -->
    <ProcessStep />
      <ProcessStageList />           // checklist of processing stages
    <!-- Step 3 -->
    <ResultStep />
      <CompositePreview />           // the generated image
      <ResultMetadata />             // target + filter summary
      <QuickAdjustments />           // brightness/contrast/saturation sliders
      <ExportButtons />              // PNG + JPEG download
      <AdvancedEditorLink />         // escape hatch
  </CreationStepContainer>
</GuidedCreationPage>
```

### Component: `<CreationHeader>`

**Elements:**
- Cancel/Back link (top-left, same style as BackLink)
  - Steps 1-2: "Cancel" — navigates back to target detail
  - Step 3: "Back to Target" — navigates to `/target/:name`
- Title: "Creating: {targetName} — {recipeName}"
  - Font: 1.25rem (desktop) / 1rem (mobile), weight 600, `--text-primary`
- Margin-bottom: 24px

### Stepper (reuse `<WizardStepper>`)

Reuse the existing WizardStepper from `components/wizard/WizardStepper.tsx` with 3 steps:

```typescript
const CREATION_STEPS = [
  { number: 1, label: 'Download' },
  { number: 2, label: 'Process' },
  { number: 3, label: 'Result' },
];
```

- No step click navigation (steps auto-advance, no going backwards)
- Disable `onStepClick` — pass `undefined`
- Stepper centered, margin-bottom 32px

### Component: `<DownloadStep>` (Step 1)

**Purpose:** Show download progress as files are fetched from MAST.

**Overall Progress Bar:**
- Shows "X of Y files" text above the bar
- Bar: full width, 8px height, border-radius 4px
- Track: `--bg-elevated`
- Fill: `--accent-primary`, animated width transition
- Progress percentage derived from: (completed files + current file progress fraction) / total files

**File Progress List:**
- Each file row:
  ```
  F090W   [status icon]   42 MB                    // completed
  F335M   ████░░░░  67%  (28 / 42 MB)  ETA: 12s   // in progress
  F444W   waiting                                   // queued
  ```

- File rows are a vertical stack with 8px gap
- Filter name: 0.875rem, weight 500, `--text-primary`, fixed width ~80px
- Status icon:
  - Done: checkmark circle, `--color-success`
  - In progress: small progress bar (inline, 120px wide)
  - Waiting: `--text-muted` text "waiting"
  - Failed: X circle, `--color-error`
- Size: `--text-muted`, 0.8rem
- ETA: `--text-muted`, 0.8rem (only shown for in-progress file)

**Download source note:**
- Bottom of the card, small text
- "Download source: S3 direct access (faster)" or "Download source: MAST HTTP"
- Font: 0.75rem, `--text-muted`

**Data flow:**
- Uses existing `useJobProgress` hook + SignalR subscription
- The page starts the MAST import job on mount
- Progress updates come via SignalR (already built)
- When all files complete, auto-advance to Step 2 after a 500ms delay (gives user time to see "all done" state)

**Already downloaded handling:**
- If files already exist in the user's library (from a previous session), the download step shows them as immediately complete
- If ALL files already exist, skip Step 1 entirely — jump straight to Step 2 with a brief flash: "Data already in your library — starting processing..."

### Component: `<ProcessStep>` (Step 2)

**Purpose:** Show processing progress as the composite (and optional mosaic) is generated.

**Stage Checklist:**
- Vertical checklist of processing stages
- Each stage has: status icon + label

| Stage | Shown when | Label |
|-------|-----------|-------|
| Files downloaded | always | "Files downloaded" |
| Creating mosaic | requiresMosaic = true | "Creating mosaic (N pointings)" |
| Aligning to common grid | always | "Aligning images" |
| Applying color mapping | always | "Applying color mapping" |
| Final adjustments | always | "Applying final adjustments" |

**Stage status icons:**
- Done: checkmark circle, `--color-success`
- In progress: animated spinner (16px), `--accent-primary`
- Pending: empty circle outline, `--text-muted`

**Styling:**
- Each stage: display flex, align-items center, gap 12px, height 36px
- Icon: 20x20
- Label: 0.9rem, `--text-primary` (active/done) or `--text-muted` (pending)
- Completed labels: `--text-secondary` (slightly dimmed to draw eye to current step)

**Time estimate:**
- Below the checklist: "This usually takes 30-60 seconds."
- Font: 0.8rem, `--text-muted`, margin-top 16px

**Data flow:**
- Starts mosaic job if `requiresMosaic` is true (using existing mosaic endpoint + job queue)
- On mosaic completion, starts composite job (existing composite endpoint + job queue)
- Progress updates via SignalR
- Stages advance based on SignalR progress messages
- On completion, auto-advance to Step 3 after 500ms delay

### Component: `<ResultStep>` (Step 3)

**Purpose:** Show the finished composite and let the user export or refine it.

**Composite Preview:**
- Image displayed at full available width within the card
- Aspect ratio: preserve original (no cropping)
- Max-height: 60vh (prevent oversized images from pushing controls off-screen)
- Object-fit: contain
- Background: `--bg-base` (darkest — lets the image pop)
- Border: `1px solid var(--border-subtle)`
- Border-radius: `--radius-md`
- If image is still loading (fetching the preview URL): show `--bg-surface` with centered spinner

**Result Metadata:**
- Target name + recipe name: 1.125rem, weight 600, `--text-primary`
- Filter list: 0.875rem, `--text-secondary`, filters separated by middle dots
- Margin: 16px 0

**Quick Adjustments (3 sliders):**

These provide simple, approachable controls that map to existing stretch parameters under the hood.

| Slider | Maps to | Range | Default |
|--------|---------|-------|---------|
| Brightness | Black/white point shift | -50 to +50 | 0 |
| Contrast | Gamma / stretch intensity | -50 to +50 | 0 |
| Saturation | Channel weight balance | -50 to +50 | 0 |

**Slider styling:**
- Each slider row: label (fixed 100px width) + range input
- Label: 0.875rem, weight 500, `--text-secondary`
- Range input: custom styled
  - Track: 4px height, `--bg-elevated`, border-radius 2px
  - Fill (left of thumb): `--accent-primary`
  - Thumb: 16px circle, `--accent-primary`, border: 2px solid white
  - Thumb hover: slight scale(1.15)
  - Thumb active: `--accent-primary-hover`
- Gap between sliders: 12px
- Section has a subtle heading: "Quick Adjustments" (SectionHeader)

**Slider interaction:**
- Changing any slider triggers a debounced re-render of the composite (300ms debounce)
- Show a subtle "Updating..." indicator on the image while re-processing
- If re-processing takes >2 seconds, show a small spinner overlay on the image

**Export Buttons:**
- Two buttons side by side: "Download PNG" and "Download JPEG"
- Style: primary outlined (border + text, no fill)
  - Border: `1px solid var(--accent-primary)`
  - Text: `--accent-primary`
  - Hover: fill `--accent-primary`, text white
  - Height: 40px, padding 0 24px
  - Border-radius: `--radius-md`
- Gap between buttons: 12px
- Display: flex, justify-content: center
- Margin-top: 24px

**Advanced Editor Link:**
- Same styling as `<AdvancedEscapeHatch>` from target detail
- "Open in Advanced Editor" with right arrow
- Navigates to `/library` with the composite selected (pass state via navigation)
- Margin-top: 16px

### Error States

**Download failure (single file):**
```
  F335M   [!] Download failed — [Retry]
```
- Error icon: `--color-error`
- "Retry" text button inline, `--accent-primary`
- Other files continue downloading
- If a file fails 3 times, show:
  ```
  F335M   [!] Download failed after 3 attempts.
           This file will be skipped — your composite will use 5 filters.
  ```
- The flow can continue with fewer files (degrade gracefully)

**Download failure (all files / MAST down):**
```
+------------------------------------------------------------------+
|                                                                   |
|  (warning icon, 48px, --color-error)                              |
|                                                                   |
|  Download failed                                                  |
|                                                                   |
|  Could not download observation data from MAST.                   |
|  The archive may be temporarily unavailable.                      |
|                                                                   |
|  [ Try Again ]    [ Back to Target ]                              |
|                                                                   |
+------------------------------------------------------------------+
```

**Processing failure (mosaic or composite):**
```
+------------------------------------------------------------------+
|                                                                   |
|  Building your composite...                                       |
|                                                                   |
|  [done]   Files downloaded                                        |
|  [!]      Composite generation failed                             |
|                                                                   |
|  An error occurred while creating the composite.                  |
|  Error: "Reprojection failed — WCS headers incompatible"          |
|                                                                   |
|  [ Try Again ]    [ Open in Advanced Editor > ]                   |
|                                                                   |
+------------------------------------------------------------------+
```

- Show the actual error message (from backend) — helps debugging
- Offer retry + advanced editor as escape hatch
- "Try Again" retries from the processing step (files already downloaded)

### Cancel Behavior

- Cancel button visible during Steps 1 and 2
- Clicking cancel shows a confirmation: "Stop creating this composite? Downloaded files will be kept in your library."
  - Implementation: `window.confirm()` for v1 (simple, adequate)
- On confirm: cancel any in-flight jobs, navigate back to target detail
- On the result step: no cancel — show "Back to Target" instead

### Responsive Behavior

**Desktop (>= 1024px):**
- Content card: max-width 720px, centered
- Preview image: generous size

**Tablet (768-1023px):**
- Content card: full width with 16px margin
- Same layout, slightly tighter spacing

**Mobile (< 768px):**
- Content card: full width, 8px margin
- Stepper: labels hidden (numbers only) — existing WizardStepper already handles this
- File progress: filter name + status only (hide size/ETA)
- Export buttons: stack vertically
- Sliders: full width
- Preview image: full width, max-height 50vh

### Accessibility

- Stepper has `aria-label="Creation progress"` and each step has `aria-current="step"` (existing)
- Progress bar: `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label="Download progress"`
- File status updates: use `aria-live="polite"` region so screen readers announce completions
- Processing stages: `aria-live="polite"` on the stage list container
- Sliders: each `<input type="range">` has `aria-label` ("Brightness", "Contrast", "Saturation")
- Export buttons: clear labels with file format in the text
- Cancel confirmation: standard `window.confirm` (accessible by default)
- Focus management: on step transition, move focus to the step content heading

### Keyboard Navigation

- `Tab` through: cancel link -> stepper (read-only) -> step content -> action buttons
- In result step: Tab through sliders, export buttons, advanced editor link
- `Escape` does nothing (no modal to close; cancel is an explicit button)

---

## New Files for Implementation

```
src/
  pages/
    TargetDetail.tsx         // "/target/:name" page
    TargetDetail.css
    GuidedCreation.tsx       // "/create" page
    GuidedCreation.css
  components/
    discovery/
      BackLink.tsx           // "< Back" navigation component
      BackLink.css
      TargetHeader.tsx       // target name + metadata display
      RecipeCard.tsx         // composite recipe with filters + CTA
      RecipeCard.css
      AdvancedEscapeHatch.tsx // "Open Advanced Editor" link
      ObservationList.tsx    // collapsible observations table
      ObservationList.css
    creation/
      DownloadStep.tsx       // Step 1: download progress
      DownloadStep.css
      ProcessStep.tsx        // Step 2: processing progress
      ProcessStep.css
      ResultStep.tsx         // Step 3: preview + adjustments + export
      ResultStep.css
      FileProgressRow.tsx    // single file download progress
      ProcessStageRow.tsx    // single processing stage status
      QuickAdjustments.tsx   // brightness/contrast/saturation sliders
      QuickAdjustments.css
      ExportButtons.tsx      // PNG + JPEG download buttons
      CompositePreview.tsx   // preview image display
```

---

## Interaction Flow Summary (end to end)

```
Discovery Home                Target Detail              Guided Creation
+----------------+           +------------------+       +------------------+
|                |  click    |                  | click |                  |
| [Target Card]  | -------> | [Recipe Card]    | ----> | Step 1: Download |
|  Carina Nebula |           |  6-Filter NIRCam |       |  ████░░░ 4/6     |
|                |           |  [Create]        |       |                  |
+----------------+           +------------------+       +--------|---------+
                                                                 |
                                                         auto-advance
                                                                 |
                                                        +--------v---------+
                                                        |                  |
                                                        | Step 2: Process  |
                                                        |  [*] Aligning    |
                                                        |  [>] Color map   |
                                                        |                  |
                                                        +--------|---------+
                                                                 |
                                                         auto-advance
                                                                 |
                                                        +--------v---------+
                                                        |                  |
                                                        | Step 3: Result   |
                                                        |  (preview image) |
                                                        |  [adjustments]   |
                                                        |  [Download PNG]  |
                                                        |                  |
                                                        +------------------+
```

Total clicks from landing to result: **2** (pick target card -> click "Create This Composite").
Everything else is automatic.

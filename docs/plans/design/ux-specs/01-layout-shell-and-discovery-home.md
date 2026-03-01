# UX Spec: Layout Shell + Discovery Home Page

## Overview

This spec covers two tightly coupled pieces:
1. **Layout Shell** — persistent header/nav that wraps all authenticated pages
2. **Discovery Home Page** (`/`) — the content-first landing after login

Design goal: transform the first impression from "empty data dashboard" to "gallery of stunning space imagery with a clear action — pick something and create."

---

## 1. Layout Shell

### Purpose

A persistent chrome that provides navigation, identity, and context across all routes. Lightweight — the content is the star, not the nav.

### Text Wireframe

```
Desktop (>= 1024px):
+-----------------------------------------------------------------------+
|  [Logo/Mark]  JWST Discovery    [Discover] [My Library]    [UserMenu] |
+-----------------------------------------------------------------------+
|                                                                       |
|                         << page content >>                            |
|                                                                       |
+-----------------------------------------------------------------------+

Tablet (768-1023px):
+-----------------------------------------------------------------------+
|  [Logo]  JWST Discovery          [Discover] [Library]      [UserMenu] |
+-----------------------------------------------------------------------+

Mobile (< 768px):
+-----------------------------------------------------------------------+
|  [Logo]  JWST Discovery                              [Avatar/Burger]  |
+-----------------------------------------------------------------------+
|  (nav items collapse into user menu dropdown or bottom tab bar)       |
```

### Component: `<AppShell>`

Wraps all authenticated routes. Renders header + `<Outlet />`.

```
<AppShell>                          // layout wrapper
  <AppHeader />                     // persistent top bar
  <main className="app-content">
    <Outlet />                      // React Router nested route content
  </main>
</AppShell>
```

### Component: `<AppHeader>`

**Props:** none (reads route via React Router hooks, auth via AuthContext)

**Elements:**

| Element | Desktop | Tablet | Mobile |
|---------|---------|--------|--------|
| Logo/Mark | 24x24 icon + "JWST Discovery" text | icon + "JWST Discovery" | icon + "JWST" |
| Nav links | "Discover" + "My Library" as text buttons | same, shorter labels | hidden — in dropdown or bottom bar |
| Active indicator | Underline on current nav item (2px accent-primary) | same | n/a |
| UserMenu | Existing UserMenu component | same | avatar only, tap opens dropdown with nav + logout |

**Logo/Mark:**
- Use a simple telescope/star icon (SVG inline, not an image asset)
- Text: "JWST Discovery" set in font-sans, weight 600, size 1.125rem
- Clicking logo navigates to `/` (discovery home)
- Color: `--text-primary` for icon, `--text-primary` for "JWST", `--accent-primary` for "Discovery"

**Nav Items:**
- Two items: "Discover" (`/`) and "My Library" (`/library`)
- Style: text buttons, no border, 0.875rem font, weight 500
- Default color: `--text-secondary`
- Hover: `--text-primary`
- Active (current route): `--accent-primary` with 2px bottom border
- Transition: color `--transition-fast`
- Gap between items: 8px
- Each item has `aria-current="page"` when active

**Header bar styling:**
- Background: `--bg-overlay` (semi-transparent dark) with `backdrop-filter: blur(10px)`
- Height: 56px (fixed)
- `position: sticky; top: 0; z-index: 100`
- Border-bottom: `1px solid var(--border-subtle)`
- Content max-width: 1600px, centered
- Padding: 0 24px

### Navigation Flow

```
/                   Discovery Home (default after login)
/library            My Library (current dashboard, renamed)
/target/:name       Target Detail (back button returns to previous page)
/create             Guided Creation (back button returns to target detail)
/login              Login (no shell)
/register           Register (no shell)
```

**Route transitions:**
- No animated page transitions in v1 (adds complexity for minimal gain)
- Scroll position resets to top on route change
- Browser back/forward works natively via React Router

**Post-login redirect:**
- Change from `/*` catch-all to explicit `/` discovery home
- If user had a deep link (e.g. `/target/carina-nebula`), respect it after login

### Responsive Behavior

**Desktop (>= 1024px):**
- Full header with all elements visible
- `main` has horizontal margin: 24px on each side

**Tablet (768-1023px):**
- Header stays full-width
- Nav labels can abbreviate: "Library" instead of "My Library"
- `main` margin: 16px

**Mobile (< 768px):**
- Header: logo + abbreviated name + avatar button only
- Nav items move into the UserMenu dropdown (added above "Sign Out")
- Or: implement a simple 2-tab bottom bar (Discover | Library) — decision: use dropdown for v1 since bottom bars need more design work
- `main` margin: 8px

### Accessibility

- Header is `<header role="banner">`
- Nav links are in `<nav aria-label="Main navigation">`
- Each nav link is an `<a>` (or `<NavLink>` from React Router) — not a button
- Skip-to-content link: hidden `<a>` before header, visible on focus: "Skip to main content"
- Focus management: on route change, move focus to `<main>` or the page heading
- All interactive elements have visible focus rings (2px outline, offset 2px, `--accent-primary`)

### Keyboard Navigation

- `Tab` moves through: skip link -> logo -> nav items -> user menu
- `Enter` on logo navigates to `/`
- `Enter` on nav item navigates to that route
- `Escape` closes UserMenu dropdown if open

---

## 2. Discovery Home Page

### Purpose

The first thing users see after login. Answers: "What can I do here?" with visual, browsable content. The primary action is: **pick a target and start creating**.

### Text Wireframe

```
+-----------------------------------------------------------------------+
|                        << AppHeader >>                                |
+-----------------------------------------------------------------------+
|                                                                       |
|     Explore the Universe Through Webb's Eyes                          |
|     Choose a target and create your own composite image               |
|                                                                       |
|     +-----------------------------------------------------------+    |
|     |  Search targets... (Carina Nebula, M31, ...)    [Search]  |    |
|     +-----------------------------------------------------------+    |
|                                                                       |
|  -- Featured Targets -----------------------------------------------  |
|                                                                       |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|  | ........... | | ........... | | ........... | | ........... |     |
|  | . preview . | | . preview . | | . preview . | | . preview . |     |
|  | . image  .  | | . image  .  | | . image  .  | | . image  .  |     |
|  | ........... | | ........... | | ........... | | ........... |     |
|  |             | |             | |             | |             |     |
|  | Carina      | | Pillars of  | | Southern    | | Stephan's   |     |
|  | Nebula      | | Creation    | | Ring Neb.   | | Quintet     |     |
|  | NIRCam      | | NIRCam      | | NIR + MIRI  | | NIRCam      |     |
|  | 6 filters   | | 4 filters   | | 8 filters   | | 5 filters   |     |
|  |             | |             | |             | |             |     |
|  | [Great *]   | | [Good]      | | [Great *]   | | [Good]      |     |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|                                                                       |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|  | (second row, same pattern — show 8-12 targets total)        |     |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|                                                                       |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|  | (third row)                                                 |     |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|                                                                       |
+-----------------------------------------------------------------------+
```

### Component Hierarchy

```
<DiscoveryHome>                     // page component at "/"
  <HeroSection>                     // headline + search bar
    <SearchBar />                   // target search with autocomplete
  </HeroSection>
  <section>                         // featured targets
    <SectionHeader title="Featured Targets" />
    <TargetCardGrid>
      <TargetCard />                // repeated for each featured target
      <TargetCard />
      ...
    </TargetCardGrid>
  </section>
</DiscoveryHome>
```

### Component: `<HeroSection>`

**Purpose:** Set the tone. Not a splash page — a functional entry point with a search bar.

**Elements:**
- Headline: "Explore the Universe Through Webb's Eyes"
  - Font: 2rem (desktop) / 1.5rem (mobile), weight 700, `--text-primary`
  - Letter-spacing: -0.02em
- Subhead: "Choose a target and create your own composite image"
  - Font: 1rem (desktop) / 0.875rem (mobile), weight 400, `--text-secondary`
  - Margin-top: 8px
- Search bar (below subhead, margin-top: 24px)
- Text alignment: center
- Padding: 48px 24px 32px (desktop), 32px 16px 24px (mobile)
- No background image — the app's constellation background shows through

### Component: `<SearchBar>`

**Purpose:** Let users search for any JWST target by name. Maps to existing MAST target search.

**Text Wireframe:**
```
+-----------------------------------------------------+----------+
|  Search targets... (Carina Nebula, M31, ...)         | [Search] |
+-----------------------------------------------------+----------+
```

**Behavior:**
1. User types a target name (minimum 2 characters to trigger)
2. On submit (Enter or click Search): navigate to `/target/:encodedName`
3. No autocomplete dropdown in v1 — just a direct search
4. The target detail page handles the actual MAST query
5. Placeholder text cycles examples: "Carina Nebula", "Pillars of Creation", "Andromeda Galaxy"... (static placeholder, not animated — animated feels gimmicky)

**Styling:**
- Max-width: 600px, centered
- Height: 48px
- Background: `--bg-surface`
- Border: `1px solid var(--border-default)`
- Border-radius: `--radius-lg` (12px)
- Focus: border becomes `--accent-primary`, subtle glow (`box-shadow: 0 0 0 3px var(--accent-primary-subtle)`)
- Search button: right-aligned inside input, `--accent-primary` bg, white text, `--radius-md`
- Font size: 1rem
- Padding: 0 16px (input area), button has 12px horizontal padding

**Accessibility:**
- `<form role="search">` wrapping the input
- `<input type="search" aria-label="Search JWST targets">`
- Search button has `aria-label="Search"`
- Form `onSubmit` handles Enter key

### Component: `<SectionHeader>`

**Props:** `title: string`

Simple section divider used across pages.

**Styling:**
- Font: 1.125rem, weight 600, `--text-primary`
- Bottom border: none (uses spacing separation, not lines — cleaner look)
- Padding: 0 0 8px
- Margin: 32px 0 16px (top creates breathing room, bottom gives space before grid)

### Component: `<TargetCardGrid>`

**Purpose:** Responsive grid of TargetCard components.

**Layout:**
- CSS Grid: `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`
- Gap: 20px
- Max-width: 1200px, centered
- Padding: 0 24px (desktop), 0 16px (tablet), 0 12px (mobile)

**Responsive columns:**
- >= 1200px: 4 columns
- 1024-1199px: 3 columns
- 768-1023px: 2 columns
- < 768px: 2 columns (cards shrink with `minmax(200px, 1fr)`)
- < 480px: 1 column

### Component: `<TargetCard>`

**Props:**
```typescript
interface TargetCardProps {
  name: string;              // "Carina Nebula"
  catalogId?: string;        // "NGC 3372"
  description: string;       // "Star-forming region, one of JWST's first images"
  thumbnail: string;         // URL to preview image
  instruments: string[];     // ["NIRCam"] or ["NIRCam", "MIRI"]
  filterCount: number;       // 6
  compositePotential: 'great' | 'good' | 'limited';
  category: string;          // "nebula", "galaxy", etc.
}
```

**Text Wireframe (single card):**
```
+---------------------------+
|                           |
|     (thumbnail image      |
|      or placeholder)      |
|                           |
|      aspect-ratio: 4/3    |
|                           |
+---------------------------+
|                           |
|  Carina Nebula            |  <- name (weight 600, 1rem)
|  NGC 3372                 |  <- catalogId (weight 400, 0.8rem, text-muted)
|                           |
|  NIRCam  .  6 filters     |  <- instruments + filter count
|                           |
|  [* Great for composites] |  <- composite potential badge
|                           |
+---------------------------+
```

**Card Styling:**
- Background: `--bg-surface` (#1a1d24)
- Border: `1px solid var(--border-subtle)`
- Border-radius: `--radius-lg` (12px)
- Overflow: hidden (for image border-radius)
- Transition: `transform var(--transition-fast), box-shadow var(--transition-fast)`
- Cursor: pointer (entire card is clickable)

**Hover state:**
- Transform: `translateY(-2px)`
- Box-shadow: `--shadow-md`
- Border-color: `--border-default` (slightly brighter)

**Active (pressed) state:**
- Transform: `translateY(0)`
- Box-shadow: `--shadow-sm`

**Focus state (keyboard):**
- Outline: `2px solid var(--accent-primary)`, offset 2px
- Same visual shift as hover

**Thumbnail area:**
- Aspect-ratio: 4/3
- Object-fit: cover
- Background: `--bg-elevated` (fallback while loading)
- If no thumbnail: show a gradient placeholder based on category
  - Nebula: linear-gradient(135deg, #1a0a2e, #2d1b4e) — deep purple
  - Galaxy: linear-gradient(135deg, #0a1628, #1a2d4e) — deep blue
  - Star Cluster: linear-gradient(135deg, #1a1a0a, #2e2d1b) — warm gold/dark
  - Default: linear-gradient(135deg, #0d1117, #1a1d24) — neutral dark
- Placeholder overlays a centered SVG icon (telescope or star) at 40% opacity

**Card body:**
- Padding: 16px
- Name: `--text-primary`, 1rem, weight 600, line-height 1.3
- CatalogId: `--text-muted`, 0.8rem, weight 400, margin-top 2px
- Info row (instruments + filters): margin-top 12px, `--text-secondary`, 0.8rem
  - Instruments shown as text: "NIRCam" or "NIRCam + MIRI"
  - Separator: middle dot (centered vertically)
  - Filter count: "6 filters"

**Composite Potential Badge:**
- Margin-top: 12px
- Inline-flex, height 24px, padding: 0 10px, border-radius: 12px, font: 0.75rem, weight 500

| Level | Background | Text Color | Label |
|-------|-----------|------------|-------|
| Great | `rgba(16, 185, 129, 0.15)` | `--color-success` | "Great for composites" |
| Good | `rgba(59, 130, 246, 0.15)` | `--accent-primary` | "Good for composites" |
| Limited | `rgba(245, 158, 11, 0.15)` | `--color-warning` | "Limited data" |

**Click action:** Navigate to `/target/:encodedName` where `encodedName` is URL-safe slug of the target name (e.g., "carina-nebula").

**Card is a `<Link>` (React Router):**
- The entire card is wrapped in `<Link to={...}>` for proper anchor semantics
- Screen readers announce: "Carina Nebula, NGC 3372, NIRCam, 6 filters, Great for composites"
- Use `aria-label` on the Link to provide this full description

### Loading State: `<DiscoveryHomeSkeleton>`

Shown while featured targets JSON loads (should be near-instant since it ships as static config, but good to have).

```
+-----------------------------------------------------------------------+
|                                                                       |
|     Explore the Universe Through Webb's Eyes                          |
|     Choose a target and create your own composite image               |
|                                                                       |
|     +-----------------------------------------------------------+    |
|     |  Search targets...                              [Search]  |    |
|     +-----------------------------------------------------------+    |
|                                                                       |
|  -- Featured Targets -----------------------------------------------  |
|                                                                       |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|  | ░░░░░░░░░░░ | | ░░░░░░░░░░░ | | ░░░░░░░░░░░ | | ░░░░░░░░░░░ |     |
|  | ░ shimmer ░ | | ░ shimmer ░ | | ░ shimmer ░ | | ░ shimmer ░ |     |
|  | ░░░░░░░░░░░ | | ░░░░░░░░░░░ | | ░░░░░░░░░░░ | | ░░░░░░░░░░░ |     |
|  | ░░░░░░░░░░░ | | ░░░░░░░░░░░ | | ░░░░░░░░░░░ | | ░░░░░░░░░░░ |     |
|  | ░░░ bar ░░░ | | ░░░ bar ░░░ | | ░░░ bar ░░░ | | ░░░ bar ░░░ |     |
|  | ░░ bar ░░░░ | | ░░ bar ░░░░ | | ░░ bar ░░░░ | | ░░ bar ░░░░ |     |
|  +-------------+ +-------------+ +-------------+ +-------------+     |
|                                                                       |
+-----------------------------------------------------------------------+
```

**Skeleton card:**
- Same dimensions as real card
- Thumbnail area: `--bg-surface` with CSS shimmer animation (keyframe that slides a lighter band across)
- Body: 3 rounded rectangles (title, info, badge) shimmer

**Shimmer animation:**
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton-block {
  background: linear-gradient(
    90deg,
    var(--bg-surface) 25%,
    var(--bg-surface-hover) 50%,
    var(--bg-surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
```

### Empty State

If featured targets config fails to load (shouldn't happen in practice since it's a static file):

```
+-----------------------------------------------------------------------+
|                                                                       |
|     Explore the Universe Through Webb's Eyes                          |
|                                                                       |
|     +-----------------------------------------------------------+    |
|     |  Search targets...                              [Search]  |    |
|     +-----------------------------------------------------------+    |
|                                                                       |
|           (telescope icon, 48px, text-muted opacity)                  |
|                                                                       |
|           Could not load featured targets.                            |
|           Try searching for a target above, or visit                  |
|           [My Library] to work with your existing data.               |
|                                                                       |
+-----------------------------------------------------------------------+
```

- Icon: subtle, not alarming
- Text: `--text-secondary`, centered
- "My Library" is a link to `/library`
- No retry button needed — it's a static file, a hard reload would fix it

### Search Empty / No Results

After searching for a target name that MAST returns nothing for (handled on the target detail page, not here — the search bar just navigates).

### Page Layout Specifics

**Content area:**
- No wrapping `<main>` card (unlike current dashboard which has a border + bg)
- The page content sits directly on the app background (constellation image)
- Cards provide their own contained background
- This gives a more open, gallery-like feel vs the current "panel inside a frame" look

**Overall padding:**
- The `<DiscoveryHome>` component applies:
  - `max-width: 1200px`
  - `margin: 0 auto`
  - `padding: 0 24px 48px` (no top padding — hero has its own)

**Spacing rhythm:**
- Hero to section: 0 (hero padding handles it)
- Section header to grid: 16px
- Grid to page bottom: 48px

### Interaction Summary

| Action | Result |
|--------|--------|
| Click target card | Navigate to `/target/:name` |
| Type in search + Enter | Navigate to `/target/:searchTerm` |
| Click "Discover" nav | Navigate to `/` (no-op if already there) |
| Click "My Library" nav | Navigate to `/library` |
| Click logo | Navigate to `/` |
| Browser back from `/library` | Return to previous page |
| Keyboard Tab through cards | Focus ring on each card in grid order |
| Enter on focused card | Same as click |

---

## Implementation Notes for Frontend Dev

### Route Setup

```tsx
// Simplified route structure
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route path="/register" element={<RegisterPage />} />
  <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
    <Route index element={<DiscoveryHome />} />
    <Route path="library" element={<MyLibrary />} />
    <Route path="target/:name" element={<TargetDetail />} />
    <Route path="create" element={<GuidedCreation />} />
  </Route>
</Routes>
```

### Handling the Dashboard Transition

- `JwstDataDashboard` becomes `MyLibrary` — rename file and component
- Its parent `MainApp` data fetching logic moves into `MyLibrary` (or a context if needed by other pages)
- `MyLibrary` keeps all existing functionality unchanged
- The `<main>` wrapper styling (bg-elevated, border, border-radius) that currently wraps the dashboard should ONLY apply on the `/library` route — the discovery home uses a different layout (no card wrapper)

### New Files

```
src/
  components/
    layout/
      AppShell.tsx          // layout wrapper with header + Outlet
      AppShell.css
      AppHeader.tsx         // persistent header/nav
      AppHeader.css
  pages/
    DiscoveryHome.tsx       // "/" page
    DiscoveryHome.css
    MyLibrary.tsx           // "/library" page (renamed from MainApp+Dashboard)
  components/
    discovery/
      HeroSection.tsx       // headline + search
      HeroSection.css
      SearchBar.tsx          // target search input
      SearchBar.css
      TargetCard.tsx         // individual target card
      TargetCard.css
      TargetCardGrid.tsx     // responsive grid wrapper
      TargetCardGrid.css
      SectionHeader.tsx      // "Featured Targets" heading
      DiscoveryHomeSkeleton.tsx  // loading skeleton
```

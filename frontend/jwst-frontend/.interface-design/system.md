# JWST Data Analysis — Design System

Extracted from the existing codebase. This is the source of truth for maintaining visual consistency.

---

## Architecture

- **Styling**: Pure CSS (no Tailwind, no CSS-in-JS)
- **Components**: Pure React, no UI library (no shadcn, no MUI)
- **Icons**: Custom inline SVGs (24x24 grid, stroke-based, `strokeWidth: 2`)
- **Theme**: Dark-first — no light mode toggle
- **Design Language**: Scientific/astronomy, glassmorphism panels, technical typography

---

## Color System

### Backgrounds (darkest → lightest)

| Token         | Value                                              | Usage                |
| ------------- | -------------------------------------------------- | -------------------- |
| `bg-deepest`  | `#000000` / `#050505`                              | App root, deep space |
| `bg-base`     | `#0a0a0c` / `#0d1117`                              | Main canvas          |
| `bg-elevated` | `#0f0f12` / `#15151a`                              | Panels, sidebars     |
| `bg-surface`  | `#1a1a2e` / `#16213e`                              | Cards, containers    |
| `bg-overlay`  | `rgba(20, 20, 25, 0.7)` – `rgba(26, 26, 46, 0.95)` | Glass panels         |

### Text

| Token            | Value                                   | Usage                  |
| ---------------- | --------------------------------------- | ---------------------- |
| `text-primary`   | `#ffffff`                               | Headings, emphasis     |
| `text-secondary` | `rgba(255, 255, 255, 0.85)` – `#e0e0e0` | Body text              |
| `text-muted`     | `rgba(255, 255, 255, 0.6)`              | Labels, metadata keys  |
| `text-faint`     | `rgba(255, 255, 255, 0.4)`              | Placeholders, disabled |

### Accents

| Token           | Value                 | Usage                           |
| --------------- | --------------------- | ------------------------------- |
| `accent-blue`   | `#3b82f6` / `#4db8ff` | Primary actions, links          |
| `accent-cyan`   | `#4ecdc4` / `#4cc9f0` | Status highlights, data values  |
| `accent-purple` | `#6f42c1` / `#8b5cf6` | Secondary accent, filter badges |
| `accent-orange` | `#e67e22` / `#f59e0b` | Warnings, attention             |
| `accent-green`  | `#10b981` / `#059669` | Success states                  |

### Semantic

| Token        | Value                             | Usage                       |
| ------------ | --------------------------------- | --------------------------- |
| `error`      | `#dc2626` / `#ef4444` / `#ff6b6b` | Error states                |
| `error-bg`   | `#fef2f2` / `#f8d7da`             | Error backgrounds (light)   |
| `warning`    | `#b45309` / `#fcd34d`             | Warning states              |
| `warning-bg` | `#fff3cd`                         | Warning backgrounds (light) |
| `success-bg` | `#d4edda`                         | Success backgrounds (light) |

### Borders

| Token            | Value                                | Usage                              |
| ---------------- | ------------------------------------ | ---------------------------------- |
| `border-subtle`  | `rgba(255, 255, 255, 0.05)` – `0.08` | Glass panel edges                  |
| `border-default` | `rgba(255, 255, 255, 0.1)` / `#ddd`  | Standard separation                |
| `border-strong`  | `rgba(255, 255, 255, 0.2)`           | Hover states, emphasis             |
| `border-input`   | `#cbd5e1` / `#e5e7eb`                | Form field borders (light context) |

### Interactive States

| State     | Pattern                                                                    |
| --------- | -------------------------------------------------------------------------- |
| Hover bg  | `rgba(255, 255, 255, 0.05)` → `0.1`                                        |
| Active bg | `rgba(77, 184, 255, 0.2)` with `color: #4db8ff`                            |
| Focus     | `border-color: #3b82f6` + `box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15)` |
| Disabled  | `opacity: 0.5`, `cursor: not-allowed`                                      |

---

## Typography

### Font Stacks

- **UI**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif`
- **Mono**: `'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace` — used for coordinates, metadata values, status readouts

### Scale

| Level   | Size                 | Weight   | Usage                   |
| ------- | -------------------- | -------- | ----------------------- |
| Display | `2rem` – `2.5rem`    | 700      | Page titles, app header |
| H2      | `1.5rem`             | 600      | Section headings        |
| H3      | `1rem` – `1.1rem`    | 600      | Subsection headings     |
| Body    | `0.9rem`             | 400      | Standard text           |
| Small   | `0.8rem` – `0.85rem` | 400–500  | Metadata, controls      |
| Caption | `0.7rem` – `0.75rem` | 400      | Badges, hints           |

### Conventions

- Monospace for all data readouts (coordinates, pixel values, WCS, status values)
- `letter-spacing: 0.5px` on small labels/badges
- Line height: `1.3`–`1.5` for body text

---

## Spacing

### Scale

`2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 20 | 24 | 30 | 32 | 40 | 60` (px)

### Common Patterns

| Context           | Value                                        |
| ----------------- | -------------------------------------------- |
| Button padding    | `10px 20px` (standard), `8px 12px` (compact) |
| Input padding     | `10px 14px` – `12px 16px`                    |
| Card padding      | `20px`                                       |
| Panel header      | `10px 12px`                                  |
| Panel body        | `12px`                                       |
| Section gap       | `12px` – `20px`                              |
| Control group gap | `6px` – `14px`                               |
| Row item gap      | `8px`                                        |

---

## Border Radius

| Value           | Usage                               |
| --------------- | ----------------------------------- |
| `3px` – `4px`   | Badges, small controls, tags        |
| `5px` – `6px`   | Buttons, filter dropdowns           |
| `8px`           | **Default** — cards, inputs, panels |
| `10px` – `12px` | Larger containers, modals           |
| `15px` – `16px` | Major sections, auth container      |
| `50%`           | Circular avatars, spinner           |
| `100px`         | Pill-shaped toolbar                 |

---

## Elevation / Shadows

### Strategy

Glassmorphism + shadows. Dark backgrounds reduce shadow visibility, so glass panels use `backdrop-filter: blur()` plus subtle borders for definition.

### Levels

| Level   | Shadow                                | Usage                  |
| ------- | ------------------------------------- | ---------------------- |
| Flat    | none                                  | Default surfaces       |
| Low     | `0 2px 4px rgba(0,0,0,0.1)`           | Cards resting          |
| Medium  | `0 4px 12px rgba(0,0,0,0.15)`         | Cards on hover         |
| High    | `0 10px 30px rgba(0,0,0,0.2)` – `0.3` | Modals, dropdowns      |
| Extreme | `0 20px 60px rgba(0,0,0,0.3)`         | Auth container, viewer |

### Glass Panels

```css
background: rgba(20, 20, 25, 0.7);
backdrop-filter: blur(10px);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 8px;
```

### Glow Effects

- Channel indicators: `0 0 10px var(--channel-color)`
- Selection: `0 0 0 2px rgba(78, 205, 196, 0.3)`

---

## Animation

### Durations

| Speed    | Duration   | Usage                             |
| -------- | ---------- | --------------------------------- |
| Fast     | `0.15s`    | Hover states, color changes       |
| Standard | `0.2s`     | Panels, dropdowns, transforms     |
| Slow     | `0.3s`     | Opacity fades, larger transitions |

### Easing

- Default: `ease-out` (most interactions)
- Continuous: `linear` (spinners only)

### Keyframes

| Name             | Pattern                                   | Duration                      |
| ---------------- | ----------------------------------------- | ----------------------------- |
| `spin`           | `rotate(0deg) → rotate(360deg)`           | `0.8s` – `1s linear infinite` |
| `dropdownFadeIn` | `opacity: 0, translateY(-8px) → visible`  | `0.15s ease-out`              |
| `slideDown`      | `opacity: 0, translateY(-10px) → visible` | `0.2s ease-out`               |

### Interactive Patterns

- Button hover: `translateY(-1px)` + shadow increase
- Button active: `translateY(0)` (press in)
- Icon hover: `scale(1.1)` – `scale(1.2)`
- Dropdown toggle: `rotate(180deg)` on chevrons

---

## Layout

### Dashboard Grid

```css
grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
gap: 20px;
max-width: 1200px;
margin: 0 auto;
```

### Viewer Layout

```css
grid-template-columns: 1fr 320px;  /* Content + sidebar */
grid-template-columns: 1fr 42px;   /* Sidebar collapsed */
```

### Breakpoints

| Name    | Value    | Target        |
| ------- | -------- | ------------- |
| Mobile  | `640px`  | Phones        |
| Tablet  | `768px`  | Tablets       |
| Compact | `900px`  | Small laptops |
| Desktop | `1024px` | Laptops+      |

---

## Component Patterns

### Primary Button

```css
background: linear-gradient(135deg, #3b82f6, #2563eb);
color: white;
padding: 10px 20px;
border: none;
border-radius: 5px–8px;
transition: all 0.2s ease;
/* Hover: translateY(-1px), shadow with accent color at 0.4 alpha */
```

### Icon Button

```css
width: 36px; height: 36px;
background: transparent;
color: rgba(255, 255, 255, 0.6);
border-radius: 6px;
/* Hover: bg rgba(255,255,255,0.1), color #fff */
/* Active: bg rgba(77,184,255,0.2), color #4db8ff */
```

### Card

```css
background: white;  /* or dark variant */
border: 1px solid #ddd;
border-radius: 8px;
padding: 20px;
/* Hover: translateY(-2px), box-shadow increase */
```

### Glass Panel

```css
background: rgba(20, 20, 25, 0.7);
backdrop-filter: blur(10px);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 8px–12px;
```

### Input Field

```css
padding: 10px 14px;
border: 1px solid #cbd5e1;
border-radius: 5px–8px;
background: #fff;  /* or rgba(30, 30, 45, 0.8) dark */
/* Focus: border-color #3b82f6, box-shadow 0 0 0 3px rgba(59,130,246,0.15) */
```

### Status Badge

```css
padding: 4px 8px;
border-radius: 12px;
font-size: 0.75rem;
font-weight: 600;
/* Colors vary by status — see Semantic Colors */
```

---

## Icons

All custom SVGs. Standard attributes:

```jsx
width="24" height="24"
viewBox="0 0 24 24"
fill="none"
stroke="currentColor"
strokeWidth="2"
strokeLinecap="round"
strokeLinejoin="round"
```

No external icon library. Icons defined inline in component files.

---

## Notes

- Status badges use **light backgrounds** even in the dark theme (Bootstrap-style alert colors)
- Channel colors are dynamic via CSS custom properties (`--channel-color`)
- Dashboard cards use white/light backgrounds — a visual break from the dark chrome
- Sidebar panels use 280px width (floating) or 320px (fixed sidebar)
- The app is desktop-primary with basic mobile responsiveness

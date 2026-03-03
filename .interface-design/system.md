# JWST Data Analysis — Design System

> Updated 2026-03-03 after P17 design token audit (spacing, typography, radius, shadows, colors/overlays).
> Token adoption: **~97%** (~3,900 token uses vs ~200 deliberate exceptions).

## Theme

Dark-first astronomy application. Dense data UI with floating panels,
card grids, and multi-step wizards. No light theme yet.

## Color Tokens (defined in index.css :root)

### Surfaces
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#0c0d10` | Page background |
| `--bg-elevated` | `#141519` | Sidebars, panels |
| `--bg-surface` | `#1a1d24` | Cards, containers |
| `--bg-surface-hover` | `#21252e` | Card hover state |
| `--bg-overlay` | `rgba(18, 19, 23, 0.9)` | Modal backdrop |
| `--bg-wizard` | `#1a1a2e` | Wizard backgrounds |
| `--bg-wizard-alt` | `#16213e` | Wizard gradient endpoint |
| `--bg-wizard-inner` | `rgba(22, 33, 62, 0.6)` | Wizard inner panels |
| `--bg-deep` | `#0d1117` | Deepest dark backgrounds |
| `--bg-canvas` | `#000000` | Pure black (viewer canvases) |
| `--bg-inset` | `#0a0a0c` | Near-black inset panels |
| `--bg-panel` | `rgba(15, 15, 20, 0.85)` | Semi-transparent glass panels |
| `--bg-panel-heavy` | `rgba(15, 15, 20, 0.95)` | Heavy glass panels |
| `--bg-toolbar` | `#2a2a4a` | Viewer toolbar background |
| `--bg-toolbar-hover` | `#3a3a6a` | Viewer toolbar hover |

### Text
| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#e8eaed` | Body text, headings |
| `--text-secondary` | `#9ca3af` | Descriptions, metadata |
| `--text-muted` | `#6b7280` | Placeholders, tertiary |
| `--text-faint` | `#4b5563` | Disabled, decorative |
| `--text-soft` | `rgba(255, 255, 255, 0.8)` | Slightly muted white |

### Borders
| Token | Value | Usage |
|-------|-------|-------|
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | Dividers, light separation |
| `--border-default` | `rgba(255, 255, 255, 0.1)` | Card borders, inputs |
| `--border-strong` | `rgba(255, 255, 255, 0.18)` | Active/focus borders |
| `--border-bright` | `rgba(255, 255, 255, 0.3)` | High-contrast borders |
| `--border-interactive` | `rgba(74, 144, 217, 0.2)` | Interactive element borders |
| `--border-interactive-hover` | `rgba(74, 144, 217, 0.4)` | Interactive hover borders |
| `--border-toolbar` | `#444` | Toolbar dividers |
| `--border-error` | `rgba(239, 68, 68, 0.3)` | Error state borders |
| `--border-warning` | `rgba(245, 158, 11, 0.3)` | Warning state borders |
| `--border-aqua` | `rgba(76, 201, 240, 0.3)` | Aqua accent borders |

### Accent — Primary
| Token | Value | Usage |
|-------|-------|-------|
| `--accent-primary` | `#3b82f6` | Primary buttons, links, focus rings |
| `--accent-primary-hover` | `#2563eb` | Primary hover |
| `--accent-primary-subtle` | `rgba(59, 130, 246, 0.12)` | Primary tint backgrounds |

### Accent — Secondary
| Token | Value | Usage |
|-------|-------|-------|
| `--accent-secondary` | `#8b5cf6` | Generate/process actions |
| `--accent-secondary-hover` | `#7c3aed` | Secondary hover |
| `--accent-secondary-subtle` | `rgba(139, 92, 246, 0.12)` | Secondary tint |

### Accent — Interactive (wizard/viewer blue)
| Token | Value | Usage |
|-------|-------|-------|
| `--accent-interactive` | `#4a90d9` | Wizard buttons, slider accents |
| `--accent-interactive-hover` | `#357abd` | Interactive hover |
| `--accent-interactive-subtle` | `rgba(74, 144, 217, 0.12)` | Interactive tint |

### Accent — Domain Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--accent-teal` | `#4ecdc4` | Selected states, save/export actions |
| `--accent-teal-subtle` | `rgba(78, 205, 196, 0.12)` | Teal tint |
| `--accent-cyan` | `#4db8ff` | Loading spinners, data highlights |
| `--accent-cyan-subtle` | `rgba(77, 184, 255, 0.12)` | Cyan tint |
| `--accent-aqua` | `#4cc9f0` | Comparison viewer, analysis UIs |
| `--accent-aqua-subtle` | `rgba(76, 201, 240, 0.15)` | Aqua tint |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `#10b981` | Completed, valid |
| `--color-success-subtle` | `rgba(16, 185, 129, 0.12)` | Success background |
| `--color-warning` | `#f59e0b` | Caution, pending |
| `--color-warning-subtle` | `rgba(245, 158, 11, 0.12)` | Warning background |
| `--color-error` | `#ef4444` | Failed, invalid |
| `--color-error-subtle` | `rgba(239, 68, 68, 0.12)` | Error background |
| `--color-info` | `#3b82f6` | Informational |

### Auth Theme (`[data-theme='auth']`)
| Token | Value | Usage |
|-------|-------|-------|
| `--auth-bg-card` | `rgba(255, 255, 255, 0.95)` | Auth card background |
| `--auth-text` | `#374151` | Auth page text |
| `--auth-border` | `#e5e7eb` | Auth input borders |
| `--auth-input-bg` | `#f9fafb` | Auth input background |
| `--auth-error-bg` | `#fee2e2` | Auth error background |
| `--auth-error-text` | `#dc2626` | Auth error text |

### Overlays (P17)
| Token | Value | Usage |
|-------|-------|-------|
| `--overlay-light` | `rgba(0, 0, 0, 0.2)` | Dimmed backgrounds, inset panels |
| `--overlay-medium` | `rgba(0, 0, 0, 0.3)` | Progress bar containers |
| `--overlay-strong` | `rgba(0, 0, 0, 0.5)` | Loading overlays |
| `--overlay-heavy` | `rgba(0, 0, 0, 0.7)` | Modal backdrops |
| `--overlay-opaque` | `rgba(0, 0, 0, 0.85)` | Near-opaque overlays |
| `--color-neutral-subtle` | `rgba(107, 114, 128, 0.12)` | Muted gray backgrounds |

### Remaining Hardcoded Colors (~40 values in component files)

All are deliberate exceptions:

| Category | Count | Reason |
|----------|-------|--------|
| `rgba(0,0,0,X)` in complex box-shadows | ~15 | Inline shadow values, not standalone |
| WcsGridOverlay data-viz (`#00e5cc`) | 8 | Domain-specific grid color |
| Progress bar glow effects (teal rgba) | ~10 | Complex gradient/box-shadow animations |
| RegionSelector annotation colors | 4 | Annotation-specific (`#0096ff`) |
| `accent-color` CSS property | 2 | Browser native, can't use var() |
| `color-mix()` expressions | 1 | CSS function, not a color value |

## Spacing

Tokens defined and **migrated in P16–P17** (~975 replacements across 54 files).

```css
--space-1: 0.25rem;   /* 4px — tight: icon gaps, badge padding */
--space-2: 0.5rem;    /* 8px — compact: button padding, small gaps */
--space-3: 0.75rem;   /* 12px — standard: card padding, form gaps */
--space-4: 1rem;      /* 16px — comfortable: section padding */
--space-5: 1.25rem;   /* 20px — generous: panel padding */
--space-6: 1.5rem;    /* 24px — large: section gaps */
--space-8: 2rem;      /* 32px — extra-large: page margins */
```

Off-grid rounding applied: 6px→space-2 (8px), 10px→space-3 (12px), 14-15px→space-4 (16px).
Remaining inline: values <4px (2-3px), >32px (40px, 60px), and dimension values (width/height).

## Border Radius

Tokens defined and **migrated in P15–P16** (~250 replacements).

```css
--radius-xs: 2px;    /* fine details, thin badges */
--radius-sm: 4px;    /* inputs, badges, small elements */
--radius-md: 8px;    /* cards, panels, standard */
--radius-lg: 12px;   /* modals, dropdowns, large */
--radius-full: 50%;  /* circles, round indicators */
```

Remaining inline: `0` (no rounding), `100px` (pill shapes), `14px` (pill-like chips).

## Depth

Tokens defined, **~60% adopted** (27 token refs vs 18 hardcoded).

```css
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
--shadow-lg: 0 10px 30px rgba(0, 0, 0, 0.6);
--shadow-xl: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
```

Strategy: **layered shadows** (not borders-only).
Remaining 18 hardcoded shadows are color-tinted state shadows, glow effects,
focus rings, and inset/directional expressions that don't map to the tier system.

## Typography

Tokens defined and **migrated in P16–P17** (~320 replacements).

```css
--text-xs: 0.625rem;   /* 10px — badges, fine print */
--text-sm: 0.75rem;    /* 12px — metadata, captions */
--text-base: 0.875rem; /* 14px — body text, inputs */
--text-lg: 1rem;       /* 16px — subheadings, emphasis */
--text-xl: 1.125rem;   /* 18px — section headings */
--text-2xl: 1.5rem;    /* 24px — page headings */
--text-3xl: 1.75rem;   /* 28px — page titles */
```

Font stacks:
```css
--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', ...
--font-mono: 'JetBrains Mono', 'Fira Code', source-code-pro, ...
```

13px consolidated to `--text-base` (14px). Remaining inline: 20px font-size, 0.8125rem (13px nav).

## Transitions

Tokens defined and **migrated in P16** (~135 replacements).

```css
--transition-fast: 0.15s ease-out;  /* hover states, micro-interactions */
--transition-base: 0.2s ease-out;   /* panel slides, content transitions */
```

Remaining inline: cubic-bezier easing, >0.3s durations, keyframe animation durations.

## Component Patterns

### Card
Most consistent pattern in the codebase.
```
Structure: thumbnail → header → content → actions
Border: 1px solid var(--border-default)
Radius: var(--radius-md)
Shadow: var(--shadow-sm) → var(--shadow-md) on hover
Hover: translateY(-2px), shadow upgrade
Selected: border-color change, gradient header
```

### Button
**Inconsistent.** Many class variants with no shared base.
```
Variants: btn-icon, btn-sm, btn-text, btn-primary, btn-secondary
Padding: ranges from 6px 12px to 10px 20px (no standard)
Radius: 4px, 6px, or 8px (no standard)
Height: not standardized
```
Needs: shared button reset + variant tokens.

### Input / Form
```
Wrapper: .form-group (flex column, gap 6-20px)
Input bg: var(--bg-wizard-inner) or var(--bg-surface)
Border: 1px solid var(--border-default)
Radius: inconsistent (4px, 6px, or 8px)
Focus: border-color + box-shadow glow
```
Needs: shared input base + consistent radius.

## Adoption Summary

| Category | Token Uses | Hardcoded | Adoption |
|----------|-----------|-----------|----------|
| Colors (all) | ~1,985 | ~40 | **~98%** |
| Spacing | ~975 | ~35 | **~97%** |
| Typography | ~320 | ~7 | **~98%** |
| Radius | ~350 | ~15 | **~96%** |
| Shadows | 27 | 18 | **60%** |
| Transitions | ~200 | ~15 | **~93%** |
| **Overall** | **~3,900** | **~130** | **~97%** |

## Next Priorities

1. **Button standardization (P18)** — shared base + variant system. Inconsistent padding, radius, height. 7 classes use hardcoded `white`.
2. **Input standardization** — consistent radius, bg, and focus states.
3. **Remaining inline values** — ~130 deliberate exceptions (complex shadows, pill shapes, >32px spacing, sub-4px values, keyframe durations, decorative icon sizes).

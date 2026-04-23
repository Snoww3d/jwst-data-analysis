# JWST Discovery — Design System (Skill Entry)

Design system extracted from `Snoww3d/jwst-data-analysis`, a web application for exploring and creating composite images from James Webb Space Telescope observations.

## When to use

Use this design system whenever you are producing design artifacts for:
- The **JWST Discovery** web app (Discover / Search / Target Detail / Library / Wizards / Viewer)
- Anything that extends or mocks the astronomy data-analysis workbench UI

If the user asks for something *unrelated* to JWST Discovery (a marketing site, a mobile app, a deck), tell them this design system is scoped to the web application and ask whether to reuse the tokens elsewhere.

## How to use

1. **Read `README.md`** (full context, voice, visual foundations, caveats).
2. **Link `colors_and_type.css`** from every HTML file you produce — it holds every token.
3. **Start from `ui_kits/web/index.html`** when mocking the web app. It demonstrates the header, cards, chips, badges, recipe cards, observation table, and CTA patterns in-context.
4. **Browse `preview/`** for atomic component references (colors, type, spacing, buttons, badges, chips, cards).
5. **Respect the caveats** at the bottom of `README.md` — no real product logomark exists in the source; flag it if the design calls for one.

## Invariants — do not break these

- **Dark-first.** Never a light theme. Only the auth surface is light.
- **No emoji.** Never. Anywhere.
- **No invented / synthesized space art.** Use the real bitmaps in `assets/` or a category gradient + a telescope line icon placeholder.
- **System sans + JetBrains Mono.** Do not swap in Inter, Roboto Mono, Geist, or any Google Font.
- **Filter chips are always monospace + uppercase + colored swatch dot.**
- **Instrument badges are color-coded** (MIRI red, NIRCam blue, NIRISS green, NIRSpec amber).
- **Backgrounds:** shell uses `deep-field-bg.jpg` with a 70% dim; auth uses `jwst-background.png`.
- **Motion:** `ease-out` only, 0.15s/0.2s. Card hover = `translateY(-2px)` + shadow.
- **Radii:** 2 / 4 / 8 / 12 / 50%. Buttons 8, cards 12, chips 4/12, circles 50%.
- **Content:** sentence case body, Title Case CTAs, one-word statuses, `·` middle-dot separators, occasional single poetic line per screen max.

## Substitutions

- **Missing icons** → Lucide (`lucide.dev`). Same visual language. Flag the substitution.
- **Missing logomark** → outline hexagon + star placeholder, clearly a placeholder. Ask the user.

## Files

```
/
├── README.md                   # Full context, voice, visual foundations
├── SKILL.md                    # This file
├── colors_and_type.css         # All tokens
├── assets/                     # Real bitmaps + PWA icons (+ manifest.json)
├── preview/                    # Design-system review cards
└── ui_kits/web/                # Web app UI kit
```

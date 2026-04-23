# React Render-Phase State Mutations Sweep (Epic)

**Child issues**: #1082, #1098, #1236
**Labels**: frontend, bug, priority: high
**Risk**: Medium-low — same class of bug in 7 call sites; pattern is well
understood, but auth-adjacent `useJobProgress` lives in the list so test
coverage needs care.
**Complexity**: Medium — 7 components, one idiomatic fix per site.

---

## Why one epic

All three child issues describe *the exact same anti-pattern*: a component
calls `setState` during the render body to synchronise derived state. Every
call site uses the near-identical `prevXxx` + `useState` + conditional `set`
scaffold. Fixing one file teaches you the fix for all of them; there is no
file where the right answer diverges materially. Bundling also lets the
post-fix ESLint rule land in the same commit without breaking existing
call sites.

## Scope

| # | Issue | File | Lines | State being sync'd |
|---|-------|------|-------|---------------------|
| 1 | #1098 | `pages/MosaicPage.tsx` | 168–172 | footprint data clears on selection change |
| 2 | #1098 | `components/wizard/CompositePreviewStep.tsx` | 74–86 | channel-collapsed map + prev-channels |
| 3 | #1098 | `components/WhatsNewPanel.tsx` | 277–280 | fetch-filters + failed-thumbnails |
| 4 | #1082 | `components/ImageViewer.tsx` | 422–438 | 10+ UI state values on compact toggle |
| 5 | #1082 | `components/ImageComparisonViewer.tsx` | 79–99 | prev-isOpen + prev-mode |
| 6 | #1082 | `hooks/useJobProgress.ts` | 454–459 | prev-jobId detection |
| 7 | #1236 | `components/MosaicWizard.tsx` | 142–148 | footprint data (mirror of #1098 MosaicPage) |

## Out of scope

- General React refactor — only the render-phase mutation pattern
- Any logic change beyond moving the mutation to a `useEffect` or replacing it
  with `useMemo`/derived state
- Test infrastructure changes (we use existing Vitest + React Testing Library)

---

## Fix patterns

Two idiomatic replacements depending on the site:

### Pattern A — derived value, no state needed

When the `prevXxx` is only used to detect a change in order to clear something,
the right answer is `useEffect`:

```tsx
// BEFORE
const [prevSelectedIdList, setPrevSelectedIdList] = useState(selectedIdList);
if (selectedIdList !== prevSelectedIdList) {
  setPrevSelectedIdList(selectedIdList);
  setFootprintData(null);
  setFootprintError(null);
}

// AFTER
useEffect(() => {
  setFootprintData(null);
  setFootprintError(null);
}, [selectedIdList]);
```

Applies to: #1098 (all three files), #1082 (ImageComparisonViewer, useJobProgress), #1236.

### Pattern B — multi-field reset on mode change

`ImageViewer.tsx` resets ~10 state values on `isCompact` toggle. Use a single
`useEffect` keyed on `isCompact`:

```tsx
useEffect(() => {
  setHistogramVisible(false);
  setCurvesVisible(false);
  // ... 8 more
}, [isCompact]);
```

Applies to: #1082 ImageViewer.

---

## PR split (2 PRs)

### PR 1 — Footprint-clearing sites (#1098, #1236)

Four files, all doing the same 4-line fix (MosaicPage, CompositePreviewStep,
WhatsNewPanel, MosaicWizard). These cluster because MosaicWizard is literally
the inline version of MosaicPage and shares the bug.

**Risk**: Low — pure move to useEffect, no behavioural change.

**Testing**:

- Existing MosaicPage + MosaicWizard tests must still pass
- Add a new Vitest case: render with `selectedIdList = [A]`, re-render with
  `[B]`, assert `footprintData` was nulled exactly once (no double-reset from
  StrictMode)
- Run full Vitest suite
- Manual smoke: open Mosaic page, change selection, verify footprint reloads

### PR 2 — Multi-field + hook sites (#1082)

Three sites — `ImageViewer`, `ImageComparisonViewer`, `useJobProgress`.
`useJobProgress` is auth-adjacent (it calls SignalR which re-auths on
reconnect), so tests need to pass under the full SignalR mock.

**Risk**: Medium — `ImageViewer` is the largest, most-rendered component in
the app; a missed dependency array entry would cause visible UI regressions.

**Testing**:

- Add Vitest coverage for `useJobProgress` jobId transitions
- Manual smoke: run a composite job end-to-end, switch jobs, verify progress
  bar resets cleanly
- Toggle `isCompact` in ImageViewer, verify all overlay panels collapse once
  (not twice — StrictMode double-invoke check)
- Open ImageComparisonViewer, close, re-open with a different mode — verify
  state resets correctly

---

## Prevention

After PR 2 lands, add a lightweight ESLint rule to block this pattern
re-emerging — there is an `eslint-plugin-react` rule (`react/no-set-state-during-render`)
that isn't in our config yet. Add it in a follow-up PR with `--fix` disabled
(must be fixed by hand). File a follow-up issue if not added in this epic.

## Testing (epic-level)

```bash
# Vitest
cd frontend/jwst-frontend && npm test

# Playwright E2E (per memory rule: E2E before push for frontend behavioural changes)
npm run test:e2e -- --grep "mosaic|image-viewer|job-progress"
```

## Rollout

Merge PR 1, then PR 2. No feature flag — pure bug fix.

## Acceptance (epic-level)

- [ ] Zero `if (prop !== prevState) { setPrevState(...); ... }` patterns remain in the affected 7 files
- [ ] `grep -rn "setState.*during render\|set.*Prev.*=.*use" frontend/jwst-frontend/src` returns only the comments left by this sweep
- [ ] All 3 child issues closed
- [ ] Full Vitest + targeted Playwright suites pass
- [ ] Follow-up issue filed for `react/no-set-state-during-render` ESLint rule adoption

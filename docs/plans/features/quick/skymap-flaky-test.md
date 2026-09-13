# Fix flaky SkyMap survey-switch test

**Branch**: `fix/skymap-flaky-test`
**Effort**: <15 min · **Risk**: Low (test-only)

## Problem

`SkyMap.test.tsx` › "switches survey, persists it, and shows a banner when the
survey fails to load" fails intermittently on `main` with:

```
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

Observed on main CI runs 34768415103 and 34770780617 (2026-09-13) and on
Dependabot PR #1974 after rebase; adjacent commits pass with no code change.

The assertion `expect(stub.aladin.setBaseImageLayer).toHaveBeenCalledTimes(1)`
runs synchronously right after `findByLabelText('Background survey')`. The
select renders as soon as the component mounts, but the base layer is applied
inside the async Aladin init effect. Under CI load the effect has not always run
by the time the select is found.

## Change

Wrap the first-call assertion in `waitFor`, matching the pattern already used
for the second call on the next line.

## Proof

- `npx vitest run src/components/mast/map/SkyMap.test.tsx` passes.
- CI Frontend Tests green on the PR.

## Rollback

Revert the single-line test change.

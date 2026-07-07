# CE contract fixtures (golden .NET responses)

Captured 2026-07-06 from the running .NET API (anonymous requests, local dev
data) as part of CE plan Phase 1 — see
`docs/plans/features/ce-phase1-spike-report.md`.

These are the red-green targets for the ADR 0001 Phase 2 FastAPI read-slice:
the Python endpoints must reproduce these shapes (field names and casing,
which is **mixed** — camelCase for .NET DTOs; the MAST search passthrough is a
snake_case envelope around verbatim mixed-case MAST rows) so the CE frontend
cutover is a pure base-URL swap.

The checked-in `userId` values are local seed-user ObjectIds, not real
accounts; MAST metadata (PI names, etc.) is public STScI archive data.

Regenerate against a running stack:

```bash
python3 capture_fixtures.py fixtures/
```

Values (ids, timestamps, counts) are environment-specific; contract tests
should assert **structure** — key names, casing, types, envelope shapes — not
exact values.

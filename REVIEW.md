# Review policy

The standard every PR in this repo is reviewed against — by Claude and by humans.
Seeded from the global `sdlc` skill; edit freely to add repo-specific rules.

Review in **passes, in this order**. Do not interleave them — a security finding
lost inside a list of style nits is a security finding that gets ignored.

## Pass 1 — Correctness

- Does the change do what `spec.md` and `plan.md` said it would?
- Off-by-one, null/undefined, empty-collection, and boundary cases.
- Error paths: is every thrown error caught by something that can act on it?
- Async: unawaited promises, races, missing cancellation, unbounded concurrency.
- Cross-layer contracts. If the repo mixes JSON casing conventions, verify the
  DTO mapping on every new or changed endpoint.

## Pass 2 — Security

- Input validation on anything crossing a trust boundary.
- Authorization checked at the point of data access, not only in the UI.
- Path traversal, injection, SSRF, deserialization of untrusted input.
- Secrets: none in the diff, none in logs, none in error messages returned to users.
- Resource limits on anything a user can make large or make repeat.
- Dependency additions: is this dependency necessary, maintained, and scoped?

## Pass 3 — Compliance with the artifacts

- Every requirement in `spec.md` is implemented or explicitly deferred.
- Deferred items have GitHub issues.
- The PR body's test plan actually exercises the change.
- Flagged concerns from `spec.md` were signed off, not silently dropped.

## Pass 4 — Quality

- Matches surrounding style: naming, comment density, idiom.
- No abstraction added only to satisfy a linter.
- Every lint suppression carries a comment explaining **why**.
- No debug logging, commented-out code, or `any` left behind.
- Tests: new behaviour has a test; no existing test was weakened or deleted.

## Severity ranking

Report findings ranked, most severe first.

| Severity | Meaning |
|----------|---------|
| **Blocker** | Data loss, security hole, or breaks production. Do not merge. |
| **Major** | Wrong behaviour in a realistic case. Fix before merge. |
| **Minor** | Works, but will cause maintenance pain. Fix or file an issue. |
| **Nit** | Style or preference. Never blocks a merge. |

State a concrete failure scenario for every Blocker and Major: the inputs, and
the wrong output. A finding without a failure scenario is a guess.

## Recurring findings

If the same class of finding appears twice across PRs, it stops being a review
item and becomes a rule: add it to `CLAUDE.md`, a skill, or a hook. Say so in
the review.

---

# Repo-specific rules — JWST Data Analysis

These are additions to the passes above, drawn from this repo's architecture
constraints in [`AGENTS.md`](AGENTS.md).

## Correctness (pass 1)

- **JSON casing.** Backend serialises **snake_case**, frontend consumes
  **camelCase**. Every new or changed endpoint must have its DTO mapping
  verified in both directions. This is the most common cross-layer defect here.
- **Repository pattern.** DB operations go through `MongoDBService.cs`. A direct
  MongoDB call in a controller is a Major finding.
- **Interfaces.** New services need an interface (`IMongoDBService`,
  `IMastService`, `ICompositeService`) or they cannot be tested.
- **Processing engine** fetches from the backend API, never directly from MongoDB.
- **Async jobs** use `IJobTracker` with SignalR push — check progress events fire
  on both success and failure paths, and that a cancelled job stops doing work.
- **ADR 0001 migration.** New backend code belongs in `processing-engine/app/`.
  Flag additions to the `.NET` gateway that ADR 0001 is removing.

## Security (pass 2)

- **Auth is fragile.** Any diff touching the auth flow is a **Blocker until
  explicitly reviewed by a human**, regardless of how small it looks.
- **DoS limits** must stay enforced on any new FITS/mosaic path:
  `MAX_FITS_FILE_SIZE_MB`, `MAX_FITS_ARRAY_ELEMENTS`, `MAX_MOSAIC_OUTPUT_PIXELS`.
  A new code path that reads user-specified image dimensions without a bound is
  a Blocker.
- **Path traversal** on anything accepting a filename or MAST product path.
- Credentials come from `docker/.env`. A credential in the diff is a Blocker.

## Quality (pass 4)

- No inline styles, no bare `any`, no unexplained lint suppressions, no debug
  logging — the `post-edit-lint` hook scans for these, so a finding here means
  the hook was bypassed.
- .NET tests use Moq; `NullLogger<T>` only for the class under test.
- Python tests run in Docker: `docker exec jwst-processing python -m pytest`.
- **Never weaken or delete a test.** If a test fails because of the
  architecture, fix the architecture.

## Danger zones

`danger_zones.paths` in `.claude/sdlc.json` lists the paths where a mistake is
expensive. A PR touching one requires a human approving review and a spec, and
the `Danger Zone` check enforces both.

When reviewing such a PR, spend the extra attention there rather than spreading
it evenly. When reviewing a PR that touches none of them, do not invent gravity
it does not have.

If a review finds a dangerous path that is **not** on the list, adding it to the
list is part of resolving the finding.

## Do not re-review what hooks enforce

Pre-commit already runs ESLint, Prettier, `tsc`, vitest, `dotnet build`+`test`,
and ruff. Reviewing formatting by hand wastes the review. Focus on what a hook
cannot check: intent, contracts, security, and blast radius.

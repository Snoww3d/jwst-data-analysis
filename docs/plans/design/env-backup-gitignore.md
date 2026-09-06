# Spec: close the `.env` variant gitignore gap

- **Status:** approved
- **Date:** 2026-09-04
- **Slug:** `env-backup-gitignore`
- **Intent:** none captured — this originated from a live finding, not an idea. Noted so the chain is not silently broken.

## Summary

`docker/.env.bak-20260822-121110` and `docker/.env.bak-20260829-migration` were
sitting untracked and **not gitignored** in the working copy, carrying live
credentials. Close the pattern gap that allowed it, and protect `.gitignore`
itself as a danger zone.

## What was actually exposed

Verified before any change:

| Question | Answer |
|---|---|
| Ever committed, on any branch? | **No.** Only `docker/.env.example` has ever existed in history |
| Ever pushed to GitHub? | **No** — follows from the above |
| Was `docker/.env` itself ignored? | Yes, via `*.env` |
| Were the `.bak-` files ignored? | **No** — `*.env` matches only names *ending* in `.env` |
| Do the backups hold unique secrets? | **No.** Every key hashes identically to the live `.env` |

Secrets present in all three files: `MONGO_ROOT_PASSWORD`, `WALKTHROUGH_PASSWORD`,
`CE_MONGO_READER_PASSWORD`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD`.

No history rewrite or remote purge is needed. The exposure was local only.

## Requirements

| # | Requirement | Verified by |
|---|-------------|-------------|
| R1 | Every `.env` variant is ignored, not just names ending in `.env` | `git check-ignore` on both backups |
| R2 | `docker/.env.example` stays tracked | `git ls-files docker/.env.example` |
| R3 | A future `.gitignore` edit that weakens this needs human review | `.gitignore` added to `danger_zones.paths` |

## Approach

Add `.env.*` with a `!.env.example` negation, after the existing rules. The
prior list enumerated known suffixes (`.local`, `.agent*`) and so could only
ever be one surprise behind; a wildcard plus an explicit allow inverts that.

Add `.gitignore` to `danger_zones.paths`. A change there can silently remove
secret protection with no other visible symptom — precisely this incident's
shape — so it belongs behind the same gate as auth and secrets config.

### Alternatives rejected

| Option | Why not |
|--------|---------|
| Enumerate `.env.bak*` specifically | Fixes this instance and waits for `.env.old`. The gap was the enumeration itself. |
| Rely on the gitleaks pre-commit hook | It is the last line, not the only one, and `--no-verify` exists. Defence in depth. |
| Rewrite git history | Unnecessary — nothing was ever committed. Rewriting would be destructive for no gain. |

## Failure modes

| Failure | Detected how | Behaviour |
|---------|--------------|-----------|
| `.env.example` accidentally ignored | `git ls-files` check in the test plan | Negation `!.env.example` keeps it tracked |
| Someone weakens `.gitignore` later | Danger Zone Gate | Requires a human approving review and a spec |
| A secret file with no `.env` in its name | Not covered | gitleaks pre-commit remains the backstop |

## Flagged concerns

- [x] **Secrets-adjacent change.** Touches `docker/.env*` handling and
      `.claude/sdlc.json`, both danger zones, so this PR requires human approval.
- [x] **The two backup files still exist on disk.** This PR stops them being
      committable; it does not delete them. Removing local copies of live
      credentials is the user's call and is recommended separately.

## Open questions carried forward

- The credentials in these files are live and now exist in three local copies.
  Rotation is worth considering independently of this change, since the blast
  radius of a local disk compromise is unchanged by gitignore rules.

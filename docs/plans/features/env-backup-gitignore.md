# Plan: close the `.env` variant gitignore gap

- **Status:** done
- **Spec:** [`../design/env-backup-gitignore.md`](../design/env-backup-gitignore.md)
- **Branch:** `fix/env-backup-gitignore`

## Steps

1. **Verify exposure before changing anything** — files: none — proof: history search shows only `docker/.env.example` ever committed.
2. **Add `.env.*` and `!.env.example`** — files: `.gitignore` — proof: `git check-ignore` reports both backups ignored.
3. **Confirm `.env.example` survives** — files: none — proof: `git ls-files docker/.env.example` still returns the path.
4. **Add `.gitignore` to danger zones** — files: `.claude/sdlc.json` — proof: JSON parses; path count rises by one.

## Rollback

`git revert`. The change is two ignore lines and one JSON array entry; reverting
restores the prior (weaker) behaviour immediately.

## Blast radius

Ignore rules only. No runtime code, no build, no tests affected. The one risk is
over-matching and hiding a file that should be tracked, which step 3 checks.

## Out of scope

- Deleting the two local backup files — the user's call.
- Rotating the credentials — noted in the spec's open questions.

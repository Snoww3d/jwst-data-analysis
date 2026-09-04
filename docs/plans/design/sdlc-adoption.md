# Spec: SDLC adoption and the danger-zone gate

- **Status:** approved
- **Intent:** none — this originated as a direct request rather than a captured idea. Recorded here so the chain is not silently broken.
- **Date:** 2026-09-04
- **Slug:** `sdlc-adoption`

## Summary

Adopt one shared development lifecycle across all projects, adapted from
Anthropic's [AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook),
and enforce its one load-bearing gate mechanically rather than by convention.

This repo is the `public` tier — the highest-rigor tier — because it is the most
user-facing project in the portfolio.

## Requirements

| # | Requirement | Verified by |
|---|-------------|-------------|
| R1 | The process is defined once, globally, not per repo | `~/.claude/skills/sdlc/`; this repo carries only config |
| R2 | Adoption does not rename this repo's existing conventions | `.claude/sdlc.json` maps stages onto `docs/plans/*`, which already existed |
| R3 | The review standard is explicit and versioned | `REVIEW.md`, with a repo-specific section |
| R4 | Changes that cannot hurt keep merging autonomously | `danger-zone.yml` passes immediately when no listed path is touched |
| R5 | Changes that can hurt require a human | `danger-zone.js` requires a non-bot approving review |
| R6 | The gate cannot be satisfied by a bot approving itself | `danger-zone.js` filters `user.type === "Bot"` |
| R7 | A danger-zone change carries a spec | `require_spec_for_danger_zone_changes`; this document satisfies it for this PR |

## Approach

Gate on **blast radius, not on ceremony.**

`.claude/sdlc.json` declares `danger_zones.paths` — auth, persistence, storage,
secrets and deploy config, CI workflows, and the agent's own hooks. A CI job
diffs the PR against that list:

- **No match** (the large majority of PRs) — pass immediately, merge autonomously.
- **Match** — require an approving review from a human, plus a spec artifact.

The human-attention budget is spent only where a mistake is expensive. Normal
work is not taxed at all.

### Alternatives rejected

| Option | Why not |
|--------|---------|
| Require human approval on every `public`-tier merge (the playbook's literal reading) | Contradicts the standing review-then-merge rule and taxes every PR to catch the rare dangerous one. Rejected in favour of path-based gating. |
| Require a spec for every new feature | This was the original design and was dropped. A gate that fires constantly gets ignored, and an ignored gate corrodes the credibility of the gates that matter. Now scoped to danger-zone changes only. |
| Enforce via a local pre-commit hook | Bypassable with `--no-verify`, and invisible to review. CI is the honest place for a gate. |
| Use a third-party path-filter action | One more supply-chain dependency in a security-relevant gate, to avoid ~80 lines of glob matching. |

## Data model and API changes

None. This change adds no endpoints, no schema, and no runtime code. The only
executable addition is a CI script.

## Failure modes

| Failure | Detected how | Behaviour |
|---------|--------------|-----------|
| `.claude/sdlc.json` missing or unparseable | `danger-zone.js` startup | Missing file exits 0 (nothing to gate); malformed JSON throws and fails the job — a broken gate config must not read as "safe" |
| No danger zones declared | Pattern list empty | Exits 0 with a log line |
| GitHub reviews API unreachable | `execFileSync` throws | **Fails closed.** An unverifiable danger-zone change must not merge |
| A bot approves the PR | `user.type` check | Not counted as approval |
| Glob pattern too broad | Review of this spec | Verified against 21 real repo paths — 14 that must match, 7 that must not, including test files adjacent to auth code |

## Flagged concerns

- [x] **Touches auth-adjacent policy.** This change does not modify auth code, but
      it defines which auth paths are protected. An error in the pattern list
      silently removes protection. Mitigated by the 21-case path test above.
- [x] **The gate only binds if branch protection makes it a required check.**
      Until that repo setting is changed, this job reports but cannot block.
      This is a manual step outside the PR and is called out in the PR body.
- [x] **This PR trips its own gate** (it touches `.github/workflows/**` and
      `.claude/sdlc.json`), so it needs a human approving review. That is the
      intended behaviour and serves as the gate's first live test.

## Open questions carried forward

- The danger-zone list is a starting point drawn from current architecture. It
  will need revisiting after the ADR 0001 migration removes the `.NET` gateway,
  since several protected paths live under `backend/`.

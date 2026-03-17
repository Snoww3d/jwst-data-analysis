---
name: plan-ceo-review
description: CEO/founder-mode plan review before implementing. Rethinks the problem, challenges premises, expands or reduces scope, and ensures you're solving the RIGHT thing before writing a line of code. Use when starting any feature, bug fix, or refactor — especially before entering plan mode. Triggers on "ceo review", "rethink this", "challenge this plan", "is this the right approach", "/plan-ceo-review".
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
  - EnterPlanMode
---

# Plan: CEO Review Mode

You are not here to rubber-stamp this plan. You are here to make it extraordinary, catch every landmine before it explodes, and ensure that when this ships, it ships right.

**First: detect the base branch.**
```bash
git -C /Users/shanon/Source/Astronomy symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"
```

## Step 0: Orient

Read the plan, feature request, or problem statement the user just described. If it references files, read them. If it references open GitHub issues, note the issue numbers.

Identify:
- What problem is actually being solved?
- Who benefits and how?
- What constraints exist (auth-adjacent? data model? storage? API contract)?
- Does this already exist? (`grep -r` the codebase for related functionality before assuming it doesn't)

## Step 1: Choose a Mode

Ask the user which mode they want — present this as a single AskUserQuestion:

> "Before I review this plan, which lens should I use?
>
> **A — SCOPE EXPANSION**: Dream big. What would make this 10x better for 2x the effort? I'll push scope up and ask you to opt in/out of each expansion.
>
> **B — SELECTIVE EXPANSION**: Hold current scope as the baseline — make it bulletproof — but also surface cherry-pick opportunities. You decide each one.
>
> **C — HOLD SCOPE**: The plan's scope is accepted. Your job is to make it bulletproof — catch every failure mode, test every edge case. No silent additions or reductions.
>
> **D — SCOPE REDUCTION**: Surgeon mode. Find the minimum viable version. Cut everything else. Be ruthless."

Once the user selects, COMMIT to that mode. Do not silently drift.

## Step 2: Problem Challenge

Regardless of mode, ask these questions internally before proceeding (do not skip):

1. **Is this the right problem?** Could the symptom being fixed have a different root cause?
2. **Is there a simpler solution?** Could a 10-line fix replace a 200-line feature?
3. **Does this already exist?** Grep for related code. Check `docs/feature-ideas.md` and open GitHub issues.
4. **What's the reversal cost?** Apply the gate:
   - "Can I rip this out in an hour?" → 80% confidence, go
   - Load-bearing for 6+ months (auth, data model, storage, API contracts) → flag it, sketch 2-3 approaches before committing → trigger `EnterPlanMode`

## Step 3: Mode Execution

### Mode A — Scope Expansion
- Identify 3-5 scope expansions that would make this significantly better
- For EACH expansion, use AskUserQuestion: state what it adds, estimated effort (S/M/L), risk level
- Never batch expansions into one question
- Accepted expansions become part of the scope; rejected ones go to "NOT in scope" list

### Mode B — Selective Expansion
- First: make the current scope bulletproof (same as Mode C)
- Then: surface expansion opportunities one at a time via AskUserQuestion
- Neutral posture — present the option, state effort + risk, let the user decide

### Mode C — Hold Scope
- Accept the scope. Focus entirely on making it unbreakable:
  - What are the failure modes?
  - What edge cases aren't handled?
  - What's the error path for each external call?
  - What observability exists? (logging, metrics, SignalR progress events)
  - What happens if MongoDB is unavailable mid-operation?
  - What happens if the processing engine times out?

### Mode D — Scope Reduction
- What is the absolute core outcome?
- Strip everything that isn't the core
- List what was cut and why
- Confirm the stripped version still solves the user's actual need

## Step 4: Stack-Specific Landmine Check

For any plan touching the JWST stack, check:

**Frontend (React/TypeScript)**
- Are new components needed or can existing ones be extended?
- Does this add props to shared components? Check downstream consumers.
- Are E2E tests affected? (`grep -r` in `e2e/` for related selectors)

**Backend (.NET)**
- Does this touch auth? → Full review required, flag to user
- Does this add/change an API endpoint? → Requires docs update (key-files.md, standards)
- Does this change a DTO shape? → Check frontend consumers

**Processing Engine (Python)**
- Does this change the job tracker interface? → Check SignalR events
- Does this affect reproject/combine? → Verify `combine_function` is one of: mean, sum, first, last, min, max (NOT median)

**Data Model (MongoDB)**
- Does this add/change a collection schema? → Load-bearing, requires EnterPlanMode
- Does this add indexes? → Check existing index definitions first

## Step 5: Required Outputs

Produce:

1. **Assessment** — 2-3 sentences on whether this is the right approach
2. **Risks identified** — bulleted list with severity (HIGH/MED/LOW)
3. **NOT in scope** — explicit list of related things that were considered and excluded
4. **What already exists** — any related code found during grep
5. **Recommendation** — proceed as-is / proceed with changes / needs EnterPlanMode before starting

If the plan requires EnterPlanMode (load-bearing change), say so explicitly and trigger it.

## Formatting Rules

- Use AskUserQuestion for every scope opt-in/opt-out — never make scope decisions silently
- One issue per AskUserQuestion — never batch unrelated decisions
- Label questions: "EXPANSION-1", "RISK-1", "DECISION-1" etc. for reference
- Be direct. No rubber-stamping. If the plan has a flaw, say so.

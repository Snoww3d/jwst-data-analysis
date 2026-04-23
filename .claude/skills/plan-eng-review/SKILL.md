---
name: plan-eng-review
description: Staff-engineer-mode plan review. Challenges architecture, catches complexity traps, produces a test plan artifact, and ensures implementation is clean before a single line is written. Use before any medium+ complexity implementation. Triggers on "eng review", "architecture review", "review this plan", "/plan-eng-review".
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
  - EnterPlanMode
---

# Plan: Engineering Review

Engineering preferences that guide this review:
- **DRY** — don't repeat logic; extract shared behavior
- **Well-tested** — new behavior gets tests; edge cases are covered
- **Explicit > clever** — readable code beats clever code
- **Minimal diff** — solve the problem, don't refactor the neighborhood

> **Hard rule for AskUserQuestion calls in this skill**:
> Every `AskUserQuestion` call MUST contain exactly ONE question — i.e. the
> `questions` array has length 1. Wait for the user's answer before issuing
> the next AskUserQuestion. Even when decisions are about the same feature
> (e.g. multiple ARCH/RISK/DECISION items in one review), ask them
> sequentially. The user evaluates each one alone and gives it full
> consideration. Batching is the failure mode this rule exists to prevent.

**Detect base branch:**
```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"
```

---

## Step 0: Scope Challenge

Before reviewing the plan itself, challenge its scope:

**Complexity gate**: If the plan touches more than 8 files OR introduces more than 2 new classes/services, it's a large change. Flag this immediately and verify the user wants to proceed at this scope vs. a smaller slice.

**Completeness check**: Is the plan complete enough to implement without mid-implementation decisions? List any under-specified areas.

**Existing work check**: Grep the codebase for existing implementations that overlap:
```bash
# Adapt these to the specific feature being reviewed
grep -r "relevant-term" backend/src --include="*.cs" -l
grep -r "relevant-term" frontend/jwst-frontend/src --include="*.tsx" -l
```

**TODOS cross-reference**: Check if related items exist in `docs/development-plan.md` or `docs/tech-debt.md`.

---

## Step 1: Architecture Review

Evaluate the proposed architecture:

### Structure
- Is the layer separation clean? (Controller → Service → Repository, no business logic in controllers)
- Are DTOs used at the API boundary? (snake_case backend, camelCase frontend — verify no leakage)
- Is the dependency injection pattern followed?
- Does this introduce any circular dependencies?

### Data Flow
- Trace the data flow end-to-end: HTTP request → controller → service → repository → MongoDB → response
- For async operations: how does job progress get reported? (Must use IJobTracker + SignalR)
- For Python processing: how does the .NET backend communicate? (HTTP to processing engine)

### JWST Stack Specifics
- **New API endpoint?** → Needs route, controller action, service method, DTO, docs update
- **New MongoDB collection/index?** → Requires schema design review (load-bearing — trigger EnterPlanMode)
- **New React component?** → Follows collapsible panel pattern? Fits existing component hierarchy?
- **New Python processing step?** → Fits pipeline stage model? Uses correct combine_function values?

### Failure Modes
List every external call or I/O operation and answer: "What happens if this fails?"
- MongoDB unavailable
- Processing engine timeout / OOM
- MAST API rate limit or downtime
- File system full during FITS processing
- SignalR disconnect mid-job

---

## Step 2: Code Quality Preview

Without seeing the code yet, predict quality risks based on the plan:

- **Over-engineering risk**: Is the proposed solution more complex than the problem warrants?
- **Under-engineering risk**: Is it taking a shortcut that creates tech debt?
- **Test surface**: What's hard to test in this design? Can the design be tweaked to make it more testable?
- **Naming clarity**: Are the proposed names (endpoints, services, components) unambiguous?

---

## Step 3: Test Plan Artifact

Produce a concrete test plan as a structured artifact:

```
TEST PLAN — [Feature Name]

Unit Tests:
- [ ] [service/component]: [what behavior is tested]
- [ ] [service/component]: [edge case]

Integration Tests:
- [ ] [endpoint or flow]: [happy path]
- [ ] [endpoint or flow]: [error path]

E2E Tests (if UI change):
- [ ] [user action]: [expected result]
- [ ] [user action]: [expected result with error state]

Manual Verification:
- [ ] [specific thing to click/observe in the running app]
- [ ] [Docker rebuild required? yes/no]
```

---

## Step 4: Performance Considerations

- Does this add any N+1 query patterns? (loading related docs in a loop)
- Does this block the request thread during heavy processing? (should be async + job queue)
- Does this load unbounded data? (large FITS files, full collection scans)
- Does this affect any hot paths? (observation list loading, composite generation)

---

## Step 5: AskUserQuestion Loop

For each significant architectural decision or risk found, issue a SEPARATE
AskUserQuestion call (1 question per call). Wait for the user's answer
before issuing the next AskUserQuestion. **Even when decisions are about
the same feature or PR, ask them sequentially** — the user evaluates each
one alone and gives it full consideration. This rule exists because batched
questions force shallow consideration of each decision.

- ✅ Do: ask DECISION-1, wait for answer, ask DECISION-2, wait for answer, ask DECISION-3.
- ❌ Don't: pack DECISION-1, DECISION-2, DECISION-3 (and their related/same-feature framing) into one AskUserQuestion call.

For each question:

- Label: "ARCH-1", "RISK-1", "DECISION-1"
- State the issue clearly
- For EACH option, include structured **Pros** and **Cons** — not just a description. The user needs to see tradeoffs at a glance to make an informed call:
  - **Pros:** concrete benefits (performance, simplicity, correctness, future-proofing)
  - **Cons:** concrete costs (complexity, coupling, migration burden, maintenance)
- State your recommendation and why, but present all options fairly
- If a decision is load-bearing (auth, data model, storage, API contract) — recommend EnterPlanMode before proceeding

---

## Step 6: Required Outputs

1. **Complexity assessment** — simple / medium / large + whether scope reduction is warranted
2. **Architecture verdict** — sound / needs changes / blocked (with specific blockers)
3. **Unresolved decisions** — list of open questions that must be answered before implementing
4. **NOT in scope** — explicit list of related things excluded from this plan
5. **Test plan artifact** — as structured above
6. **Docs update checklist** — which docs need updating when this ships:
   - `docs/key-files.md`
   - `docs/standards/backend-development.md` or `frontend-development.md`
   - `docs/architecture/`
   - `docs/quick-reference.md`
   - `docs/development-plan.md`

If EnterPlanMode is warranted, say so explicitly and trigger it.

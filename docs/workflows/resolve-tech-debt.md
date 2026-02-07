---
description: Resolve a tech debt item or issue from docs/tech-debt.md
---

> ⛔ **CRITICAL**: ALL changes require a feature branch and PR. NEVER push directly to `main`.
> Even for single-line documentation fixes, create a branch first.

> 🔍 **COMPLIANCE REMINDER**: Before asking user to merge, you MUST display the compliance table.
> This applies even when resuming from a previous session. See Step 12 and Step 15.

## Start the Task

1. Identify the Tech Debt item number you want to work on (e.g., #17).

// turbo
2. Mark the item as "in progress" in `docs/tech-debt.md`:
   *(Note: Human should do this or Agent will perform file edit)*

// turbo
3. Create a feature branch for the task:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git checkout main && git pull origin main
   git checkout -b feature/task-<id>-<brief-description>
   ```

## Implementation

4. Create an implementation plan (`implementation_plan.md`) if the task is complex.

5. Implement the changes.
   - Update `CLAUDE.md` if APIs change.
   - Update `docs/standards/*.md` if models change.

## Quality & Documentation

<!-- SYNC_START: quality_checks (Keep in sync with create-feature.md, fix-bug.md) -->
6. Run Code Quality Tools:
   ```bash
   # Frontend
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # Backend - format and verify zero warnings
   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   dotnet build backend/JwstDataAnalysis.sln --warnaserror

   # Processing Engine (Python) - REQUIRED before committing
   # cwd: /Users/shanon/Source/Astronomy/processing-engine
   ruff check . && ruff format .
   ```

   ⚠️ **ZERO WARNINGS REQUIRED**: The backend build must have 0 warnings. If `--warnaserror` fails, fix the warnings before committing.

7. **Documentation Updates (REQUIRED - DO NOT SKIP)**:

   ⚠️ **CRITICAL**: Documentation updates MUST be included in the PR, not done after merge.

   Update relevant documentation based on changes made:

   | Change Type | Files to Update |
   |-------------|-----------------|
   | New API endpoint | `docs/quick-reference.md` (API section) |
   | New frontend feature | `docs/standards/frontend-development.md` |
   | Data model changes | `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
   | New TypeScript types | `docs/standards/frontend-development.md` |
   | Phase/milestone completion | `docs/development-plan.md` |
   | **Tech debt resolution** | `docs/tech-debt.md` (move to Resolved table) |
   | **Any feature/behavior change** | `docs/desktop-requirements.md` (update FR-* requirements) |
   | **Any feature/behavior change** | `docs/tech-debt.md` Task #69 (note scope change for desktop spec) |

   **Checklist (verify ALL before creating PR)**:
   - [ ] Added new API endpoints to `docs/quick-reference.md`?
   - [ ] Updated architecture docs if system design changed?
   - [ ] Added usage examples for new features?
   - [ ] **Updated `docs/tech-debt.md`** - moved task to Resolved table with PR number?
   - [ ] Updated `docs/development-plan.md` if this completes a milestone?
   - [ ] Updated `docs/desktop-requirements.md` if feature behavior changed?
   - [ ] Updated `docs/tech-debt.md` Task #69 if feature affects desktop spec scope?
<!-- SYNC_END -->

## Verification

<!-- SYNC_START: verification_steps (Keep in sync with create-feature.md, fix-bug.md) -->
8. Run Unit Tests:
   ```bash
   # Backend
   # cwd: /Users/shanon/Source/Astronomy
   dotnet test backend/JwstDataAnalysis.sln
   ```

9. **Docker Verification (REQUIRED before PR)**:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   # Rebuild ALL services to verify integration
   docker compose up -d --build
   ```

10. **Verify in Docker Environment**:
    - Wait for containers to be healthy: `docker compose ps`
    - Test the changes manually at http://localhost:3000
    - Check backend API: `curl http://localhost:5001/api/jwstdata | head`
    - Check processing engine: `curl http://localhost:8000/health`
    - If changes involve new endpoints, test them directly

11. Run E2E tests (if applicable):
    ```bash
    # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
    npm run test:e2e
    ```
<!-- SYNC_END -->

## Self-Compliance Check (REQUIRED)

<!-- SYNC_START: compliance_check (Keep in sync with create-feature.md, fix-bug.md) -->
12. **🔍 STOP - Verify Workflow Compliance**:

    Before creating the PR, verify you followed all guidelines. Display this table:

    ```
    **Workflow Compliance Check:**

    | Step | Status |
    |------|--------|
    | Branch-first rule (create branch before edits) | ✅/❌ |
    | Implement fix/feature | ✅/❌ |
    | Quality checks (linting) | ✅/❌ |
    | Tests (new/updated as needed) | ✅/❌ |
    | Docker verification | ✅/❌ |
    | Documentation updates | ✅/❌ |
    | Commit with proper message format | ✅/❌ |
    ```

    **If any step is ❌**: Go back and complete it before proceeding.
<!-- SYNC_END -->

## Completion

// turbo
13. Commit changes:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git add -A && git commit -m "feat: <Description> (Task #<id>)"
    ```

// turbo
14. Push and Create PR:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git push -u origin feature/task-<id>-<brief-description>
    gh pr create --title "feat: <Description> (Task #<id>)" --body "## 📝 Summary
    Resolves **Task #<id>** in \`docs/tech-debt.md\`.

    ## 🛠️ Tech Changes
    - **<File>**: <Change>

    ## ✅ Verification
    - **Docker Verified**: Yes
    - **Automated Tests**: <Command run>
    - **Manual Verification**:
      1. <Step 1>

    ## 🔍 Workflow Compliance
    | Step | Status |
    |------|--------|
    | Branch-first rule | ✅ |
    | Implement changes | ✅ |
    | Quality checks (linting) | ✅ |
    | Tests | ✅ |
    | Docker verification | ✅ |
    | Documentation updates | ✅ |

    ## 📚 Documentation Updates
    - [x] \`docs/tech-debt.md\` updated (task moved to Resolved table)
    - [ ] \`docs/development-plan.md\` updated (if milestone affected)
    - [ ] \`docs/quick-reference.md\` updated (if API/features changed)
    - [ ] \`docs/desktop-requirements.md\` updated (if feature behavior changed)
    "
    ```

## PR Review and Merge

<!-- SYNC_START: pr_review_steps (Match logic in create-feature.md) -->
15. **🛑 STOP - Open PR for User Review (REQUIRED)**:

    ⚠️ **DO NOT SKIP**: You MUST open the PR in the browser for user review.

    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr view --web
    ```

    Then notify user with **ALL of the following**:
    - State the PR number and URL
    - Confirm CI status (passing/pending/failing)
    - **🔍 DISPLAY THE COMPLIANCE TABLE** (copy from Step 12 with actual ✅/❌ status)
    - Ask: **"Reply with: 'Request changes', 'Merge it', or 'I merged it manually'"**
    - **WAIT for user response before proceeding**

    ⚠️ **SESSION RESUME NOTE**: If resuming from a previous session, you MUST still verify
    compliance. Re-run linting and Docker verification if not done in current session.

16. **Scenario A: User requests changes**:
    - Make changes.
    - Commit and push.
    - Go back to Step 15.

17. **Scenario B: User says "Merge it"**:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

18. **Scenario C: User says "I merged it manually"**:
    - Verify with `git fetch --prune`.
<!-- SYNC_END -->

19. Update `docs/tech-debt.md`:
    - Move the item from "Remaining Tasks" to "Resolved Tasks" table.
    - Include the PR number in the table.

## Cleanup

// turbo
20. Switch back to main and pull:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git checkout main && git pull origin main
    ```

// turbo
21. Delete the local feature branch:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git branch -d feature/task-<id>-<brief-description>
    ```

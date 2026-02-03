---
description: Fix a bug with a focused branch and verification steps
---

> ⛔ **CRITICAL**: ALL changes require a feature branch and PR. NEVER push directly to `main`.
> Even for single-line documentation fixes, create a branch first.

> 🔍 **COMPLIANCE REMINDER**: Before asking user to merge, you MUST display the compliance table.
> This applies even when resuming from a previous session. See Step 12 and Step 17.

## 1. Setup and Branching

// turbo
1. Ensure you're on the main branch and up to date:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git checkout main && git pull origin main
   ```

// turbo
2. Create a bugfix branch:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git checkout -b fix/<short-bug-description>
   ```

## 2. Reproduction & Fix

3. **Reproduction**: Before fixing, try to reproduce the bug.
   - If possible, write a failing unit test or E2E test.
   - If manual, document the steps in your task.md.

4. Apply the fix.

5. **Verify Fix**:
   - Run the test that failed before (it should pass now).
   - Perform manual verification.

## 3. Quality Checks & Documentation

<!-- SYNC_START: quality_checks (Keep in sync with create-feature.md, resolve-tech-debt.md) -->
6. Run Code Quality Tools:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   ```

7. **Documentation Updates (REQUIRED - verify before PR)**:

   ⚠️ **CRITICAL**: Documentation updates MUST be included in the PR, not done after merge.

   | Change Type | Files to Update |
   |-------------|-----------------|
   | API behavior change | `CLAUDE.md` (API Quick Reference section) |
   | Bug affects documented feature | Update relevant docs to clarify correct behavior |
   | Workaround removed | Remove outdated workaround notes from docs |
   | **Data integrity / code quality bug** | `docs/tech-debt.md` (add to Resolved table) |
   | **Bug fix changes feature behavior** | `docs/desktop-requirements.md` (update FR-* if needed) |
   | **Bug fix changes feature behavior** | `docs/tech-debt.md` Task #69 (note scope change for desktop spec) |

   **Checklist**:
   - [ ] Updated `docs/bugs.md` (moved to Resolved if listed)?
   - [ ] Updated any docs that referenced the buggy behavior?
   - [ ] Removed outdated workaround notes from docs?
   - [ ] **If this is a significant code quality fix**: Added to `docs/tech-debt.md` Resolved table?
   - [ ] **If fix changes documented behavior**: Updated `docs/desktop-requirements.md`?
   - [ ] **If fix changes documented behavior**: Updated `docs/tech-debt.md` Task #69?
<!-- SYNC_END -->

## 4. Docker Verification (REQUIRED before PR)

<!-- SYNC_START: verification_steps (Keep in sync with create-feature.md, resolve-tech-debt.md) -->
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
    - Verify the bug is fixed at http://localhost:3000
    - Check backend API: `curl http://localhost:5001/api/jwstdata | head`
    - Check processing engine: `curl http://localhost:8000/health`

11. Run E2E tests (if applicable):
    ```bash
    # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
    npm run test:e2e
    ```
<!-- SYNC_END -->

## 5. Self-Compliance Check (REQUIRED)

<!-- SYNC_START: compliance_check (Keep in sync with create-feature.md, resolve-tech-debt.md) -->
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

## 6. Record and Commit

13. Update `docs/bugs.md`:
    - If the bug was listed in "Open Bugs", move it to "Resolved Bugs".
    - If it wasn't listed, add it to "Resolved Bugs" directly.

// turbo
14. Commit changes:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git add -A && git commit -m "fix: <description of fix>"
    ```

## 7. Push and PR

// turbo
15. Push the branch:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git push -u origin fix/<short-bug-description>
    ```

// turbo
16. Create Pull Request:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr create --title "fix: <description>" --body "## 🐛 Bug Description
    <What was broken>

    ## 🛠️ Fix
    <What you changed>

    ## ✅ Verification
    - **Reproduction**: <How you reproduced it>
    - **Docker Verified**: Yes
    - **Test Coverage**: <New or existing tests run>

    ## 🔍 Workflow Compliance
    | Step | Status |
    |------|--------|
    | Branch-first rule | ✅ |
    | Implement fix | ✅ |
    | Quality checks (linting) | ✅ |
    | Tests | ✅ |
    | Docker verification | ✅ |
    | Documentation updates | ✅ |

    ## 📚 Documentation Updates
    - [ ] \`docs/bugs.md\` updated (if bug was tracked)
    - [ ] \`docs/tech-debt.md\` updated (if significant code quality fix)
    - [ ] Related docs updated (if behavior changed)
    - [ ] \`docs/desktop-requirements.md\` updated (if fix changes feature behavior)
    "
    ```

## 8. Review and Merge

17. **🛑 STOP - Open PR for User Review (REQUIRED)**:

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

18. After approval, merge:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

## 9. Cleanup

// turbo
19. Switch back to main and pull:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git checkout main && git pull origin main
    ```

// turbo
20. Delete the local fix branch:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git branch -d fix/<short-bug-description>
    ```

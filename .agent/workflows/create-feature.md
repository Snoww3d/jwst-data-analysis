---
description: Create a new feature with a feature branch and GitHub PR workflow
---

> ⛔ **CRITICAL**: ALL changes require a feature branch and PR. NEVER push directly to `main`.
> Even for single-line documentation fixes, create a branch first.

> 🔍 **COMPLIANCE REMINDER**: Before asking user to merge, you MUST display the compliance table.
> This applies even when resuming from a previous session. See Step 11 and Step 14.

## Create Feature Branch

// turbo
1. Ensure you're on the main branch and up to date:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git checkout main && git pull origin main
   ```

// turbo
2. Create a feature branch with a descriptive name:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git checkout -b feature/<feature-name>
   ```

## Develop the Feature

3. Make your changes following the project conventions.

// turbo
4. Commit changes with descriptive messages:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git add -A && git commit -m "feat: <description of change>"
   ```

## Quality & Documentation

<!-- SYNC_START: quality_checks (Keep in sync with resolve-tech-debt.md, fix-bug.md) -->
5. Run Code Quality Tools:
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

6. **Documentation Updates (REQUIRED - DO NOT SKIP)**:

   ⚠️ **CRITICAL**: Documentation updates MUST be included in the PR, not done after merge.

   Update relevant documentation based on changes made:

   | Change Type | Files to Update |
   |-------------|-----------------|
   | New API endpoint | `docs/quick-reference.md` (API section), `docs/standards/backend-development.md` |
   | New frontend feature | `docs/standards/frontend-development.md` |
   | Data model changes | `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
   | New TypeScript types | `docs/standards/frontend-development.md` |
   | Phase/milestone completion | `docs/development-plan.md` |
   | **Feature also resolves tech debt** | `docs/tech-debt.md` (move to Resolved table) |
   | **Any feature change** | `docs/desktop-requirements.md` (update corresponding FR-* requirements) |
   | **Any feature change** | `docs/tech-debt.md` Task #69 (note scope change for desktop spec) |

   **Checklist (verify ALL before creating PR)**:
   - [ ] Added new API endpoints to `docs/quick-reference.md`?
   - [ ] Updated architecture docs if system design changed?
   - [ ] Added usage examples for new features?
   - [ ] Updated `docs/development-plan.md` if this completes a milestone?
   - [ ] Updated `docs/tech-debt.md` if this resolves any tech debt items?
   - [ ] Updated `docs/desktop-requirements.md` with new/changed features?
   - [ ] Updated `docs/tech-debt.md` Task #69 if feature affects desktop spec scope?
<!-- SYNC_END -->

## Verify Changes

<!-- SYNC_START: verification_steps (Keep in sync with resolve-tech-debt.md, fix-bug.md) -->
7. Run Unit Tests:
   ```bash
   # Backend
   # cwd: /Users/shanon/Source/Astronomy
   dotnet test backend/JwstDataAnalysis.sln
   ```

8. **Docker Verification (REQUIRED before PR)**:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   # Rebuild ALL services to verify integration
   docker compose up -d --build
   ```

9. **Verify in Docker Environment**:
   - Wait for containers to be healthy: `docker compose ps`
   - Test the feature manually at http://localhost:3000
   - Check backend API: `curl http://localhost:5001/api/jwstdata | head`
   - Check processing engine: `curl http://localhost:8000/health`
   - If feature involves new endpoints, test them directly

10. Run E2E tests (if applicable):
    ```bash
    # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
    npm run test:e2e
    ```
<!-- SYNC_END -->

## Self-Compliance Check (REQUIRED)

<!-- SYNC_START: compliance_check (Keep in sync with fix-bug.md, resolve-tech-debt.md) -->
11. **🔍 STOP - Verify Workflow Compliance**:

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

## Push and Create PR

// turbo
12. Push the feature branch to origin:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git push -u origin feature/<feature-name>
    ```

// turbo
13. Create a Pull Request on GitHub:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr create --title "feat: <feature-name>" --body "## 📝 Summary
    <Brief description>

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
    | Implement feature | ✅ |
    | Quality checks (linting) | ✅ |
    | Tests | ✅ |
    | Docker verification | ✅ |
    | Documentation updates | ✅ |

    ## 📚 Documentation Updates
    - [ ] \`docs/quick-reference.md\` updated (if API/features changed)
    - [ ] \`docs/development-plan.md\` updated (if milestone affected)
    - [ ] \`docs/standards/*.md\` updated (if patterns changed)
    - [ ] \`docs/tech-debt.md\` updated (if tech debt resolved)
    - [ ] \`docs/desktop-requirements.md\` updated (if feature added/changed)
    "
    ```

## PR Review and Merge

<!-- SYNC_START: pr_review_steps (Match logic in resolve-tech-debt.md) -->
14. **🛑 STOP - Open PR for User Review (REQUIRED)**:

    ⚠️ **DO NOT SKIP**: You MUST open the PR in the browser for user review.

    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr view --web
    ```

    Then notify user with **ALL of the following**:
    - State the PR number and URL
    - Confirm CI status (passing/pending/failing)
    - **🔍 DISPLAY THE COMPLIANCE TABLE** (copy from Step 11 with actual ✅/❌ status)
    - Ask: **"Reply with: 'Request changes', 'Merge it', or 'I merged it manually'"**
    - **WAIT for user response before proceeding**

    ⚠️ **SESSION RESUME NOTE**: If resuming from a previous session, you MUST still verify
    compliance. Re-run linting and Docker verification if not done in current session.

15. **Scenario A: User requests changes**:
    - Make changes.
    - Commit and push (updates existing PR).
    - Go back to Step 14.

16. **Scenario B: User says "Merge it"**:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

17. **Scenario C: User says "I merged it manually"**:
    - Verify with `git fetch --prune`.
    - Proceed to cleanup.
<!-- SYNC_END -->

## Cleanup

// turbo
18. Switch back to main and pull:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git checkout main && git pull origin main
    ```

// turbo
19. Delete the local feature branch:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git branch -d feature/<feature-name>
    ```

## Commit Message Conventions

| Prefix | Use Case |
|--------|----------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation |
| `refactor:` | Code refactoring |
| `test:` | Adding tests |
| `chore:` | Maintenance tasks |

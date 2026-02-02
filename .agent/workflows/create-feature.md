---
description: Create a new feature with a feature branch and GitHub PR workflow
---

> ⛔ **CRITICAL**: ALL changes require a feature branch and PR. NEVER push directly to `main`.
> Even for single-line documentation fixes, create a branch first.

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
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   ```

6. **Documentation Updates (REQUIRED - DO NOT SKIP)**:

   ⚠️ **CRITICAL**: Documentation updates MUST be included in the PR, not done after merge.

   Update relevant documentation based on changes made:

   | Change Type | Files to Update |
   |-------------|-----------------|
   | New API endpoint | `CLAUDE.md` (API Quick Reference section) |
   | New frontend feature | `CLAUDE.md` (if user-facing), `docs/standards/frontend-development.md` |
   | Data model changes | `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
   | New TypeScript types | `docs/standards/frontend-development.md` |
   | Phase/milestone completion | `docs/development-plan.md` |
   | **Feature also resolves tech debt** | `docs/tech-debt.md` (move to Resolved table) |

   **Checklist (verify ALL before creating PR)**:
   - [ ] Added new API endpoints to `CLAUDE.md` API Quick Reference?
   - [ ] Updated architecture docs if system design changed?
   - [ ] Added usage examples for new features?
   - [ ] Updated `docs/development-plan.md` if this completes a milestone?
   - [ ] Updated `docs/tech-debt.md` if this resolves any tech debt items?
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
    - [ ] \`CLAUDE.md\` updated (if API/features changed)
    - [ ] \`docs/development-plan.md\` updated (if milestone affected)
    - [ ] \`docs/standards/*.md\` updated (if patterns changed)
    - [ ] \`docs/tech-debt.md\` updated (if tech debt resolved)
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

    Then notify user:
    - State the PR number and URL
    - Confirm CI status (passing/pending/failing)
    - Ask: **"Reply with: 'Request changes', 'Merge it', or 'I merged it manually'"**
    - **WAIT for user response before proceeding**

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

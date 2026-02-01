---
description: Create a new feature with a feature branch and GitHub PR workflow
---

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

6. **Documentation Updates (REQUIRED)**:

   Update relevant documentation based on changes made:

   | Change Type | Files to Update |
   |-------------|-----------------|
   | New API endpoint | `CLAUDE.md` (API Quick Reference section) |
   | New frontend feature | `CLAUDE.md` (if user-facing), `docs/standards/frontend-development.md` |
   | Data model changes | `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
   | New TypeScript types | `docs/standards/frontend-development.md` |
   | Phase/milestone completion | `docs/development-plan.md` |

   **Checklist**:
   - [ ] Added new API endpoints to `CLAUDE.md` API Quick Reference?
   - [ ] Updated architecture docs if system design changed?
   - [ ] Added usage examples for new features?
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

## Push and Create PR

// turbo
11. Push the feature branch to origin:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git push -u origin feature/<feature-name>
    ```

// turbo
12. Create a Pull Request on GitHub:
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

    ## 🔍 Quality Check
    - [x] Linting Passed
    - [x] Formatting Applied
    "
    ```

## PR Review and Merge

<!-- SYNC_START: pr_review_steps (Match logic in resolve-tech-debt.md) -->
13. Open the PR for review:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr view --web
    ```

14. **STOP and notify user**:
    - Inform them of the PR number.
    - Wait for their review.
    - Ask for instructions: "Request changes", "Merge it", or "I merged it manually".

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

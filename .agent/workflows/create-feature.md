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

<!-- SYNC_START: quality_checks (Keep in sync with resolve-tech-debt.md) -->
5. Run Code Quality Tools:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   ```

6. Documentation Check:
   - [ ] Updated `CLAUDE.md` if API endpoints changed?
   - [ ] Updated `docs/standards/*.md` if data models changed?
<!-- SYNC_END -->

## Verify Changes

<!-- SYNC_START: verification_steps (Keep in sync with resolve-tech-debt.md) -->
5. Run E2E tests to ensure no regressions:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run test:e2e
   ```

6. **Deploy for Manual Testing**:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   # Rebuild only the changed services to save time
   docker compose build frontend && docker compose up -d --no-deps frontend
   ```

7. Run Unit Tests (if applicable):
   ```bash
   # Backend
   dotnet test backend/JwstDataAnalysis.sln
   
   # Frontend Unit (If logic changes - Task #27)
   # cd frontend/jwst-frontend && npm run test:unit
   ```
<!-- SYNC_END -->

## Push and Create PR

// turbo
5. Push the feature branch to origin:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git push -u origin feature/<feature-name>
   ```

6. Create a Pull Request on GitHub:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   gh pr create --title "feat: <feature-name>" --body "## 📝 Summary
   <Brief description>

   ## 🛠️ Tech Changes
   - **<File>**: <Change>

   ## ✅ Verification
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
7. Open the PR for review:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   gh pr view --web
   ```

8. **STOP and notify user**:
   - Inform them of the PR number.
   - Wait for their review.
   - Ask for instructions: "Request changes", "Merge it", or "I merged it manually".

9. **Scenario A: User requests changes**:
   - Make changes.
   - Commit and push (updates existing PR).
   - Go back to Step 8.

10. **Scenario B: User says "Merge it"**:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

11. **Scenario C: User says "I merged it manually"**:
    - Verify with `git fetch --prune`.
    - Proceed to cleanup.
<!-- SYNC_END -->

## Cleanup

// turbo
12. Switch back to main and pull:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git checkout main && git pull origin main
    ```

// turbo
13. Delete the local feature branch:
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

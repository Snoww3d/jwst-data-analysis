---
description: Resolve a tech debt item or issue from docs/tech-debt.md
---

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

<!-- SYNC_START: quality_checks (Keep in sync with create-feature.md) -->
6. Run Code Quality Tools:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   ```

7. Documentation Check:
   - [ ] Updated `CLAUDE.md` if API endpoints changed?
   - [ ] Updated `docs/standards/*.md` if data models changed?
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

## Completion

// turbo
12. Commit changes:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git add -A && git commit -m "feat: <Description> (Task #<id>)"
    ```

// turbo
13. Push and Create PR:
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

    ## 🔍 Quality Check
    - [x] Linting Passed
    - [x] Formatting Applied
    "
    ```

## PR Review and Merge

<!-- SYNC_START: pr_review_steps (Match logic in create-feature.md) -->
14. Open the PR for review:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr view --web
    ```

15. **STOP and notify user**:
    - Inform them of the execution and PR number.
    - Wait for their review.
    - Ask for instructions: "Request changes", "Merge it", or "I merged it manually".

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

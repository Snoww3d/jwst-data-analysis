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

<!-- SYNC_START: verification_steps (Keep in sync with create-feature.md) -->
6. Run E2E tests to ensure no regressions:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run test:e2e
   ```

7. **Deploy for Manual Testing**:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/docker
   # Rebuild only the changed services to save time
   docker compose build frontend && docker compose up -d --no-deps frontend
   ```

8. Run Unit Tests (if applicable):
   ```bash
   # Backend
   dotnet test backend/JwstDataAnalysis.sln
   
   # Frontend Unit (If logic changes - Task #27)
   # cd frontend/jwst-frontend && npm run test:unit
   ```
<!-- SYNC_END -->

## Completion

// turbo
7. Commit changes:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git add -A && git commit -m "feat: <Description> (Task #<id>)"
   ```

// turbo
8. Push and Create PR:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git push -u origin feature/task-<id>-<brief-description>
   gh pr create --title "feat: <Description> (Task #<id>)" --body "## 📝 Summary
   Resolves **Task #<id>** in \`docs/tech-debt.md\`.

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
   ```

## PR Review and Merge

<!-- SYNC_START: pr_review_steps (Match logic in create-feature.md) -->
9. Open the PR for review:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   gh pr view --web
   ```

10. **STOP and notify user**:
    - Inform them of the execution and PR number.
    - Wait for their review.
    - Ask for instructions: "Request changes", "Merge it", or "I merged it manually".

11. **Scenario A: User requests changes**:
    - Make changes.
    - Commit and push.
    - Go back to Step 10.

12. **Scenario B: User says "Merge it"**:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

13. **Scenario C: User says "I merged it manually"**:
    - Verify with `git fetch --prune`.
<!-- SYNC_END -->

14. Update `docs/tech-debt.md`:
    - Move the item from "Remaining Tasks" to "Resolved Tasks" table.
    - Include the PR number in the table.

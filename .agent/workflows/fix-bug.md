---
description: Fix a bug with a focused branch and verification steps
---

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

## 3. Quality Checks

<!-- SYNC_START: quality_checks -->
6. Run Code Quality Tools:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   ```
<!-- SYNC_END -->

## 4. Docker Verification (REQUIRED before PR)

<!-- SYNC_START: verification_steps (Keep in sync with create-feature.md, resolve-tech-debt.md) -->
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
   - Verify the bug is fixed at http://localhost:3000
   - Check backend API: `curl http://localhost:5001/api/jwstdata | head`
   - Check processing engine: `curl http://localhost:8000/health`

10. Run E2E tests (if applicable):
    ```bash
    # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
    npm run test:e2e
    ```
<!-- SYNC_END -->

## 6. Record and Commit

11. Update `docs/bugs.md`:
    - If the bug was listed in "Open Bugs", move it to "Resolved Bugs".
    - If it wasn't listed, add it to "Resolved Bugs" directly.

// turbo
12. Commit changes:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git add -A && git commit -m "fix: <description of fix>"
    ```

## 7. Push and PR

// turbo
13. Push the branch:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git push -u origin fix/<short-bug-description>
    ```

// turbo
14. Create Pull Request:
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
    "
    ```

## 8. Review and Merge

15. Open PR for user review:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr view --web
    ```

16. **Notify User**: Ask for review.

17. After approval, merge:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

## 9. Cleanup

// turbo
18. Switch back to main and pull:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git checkout main && git pull origin main
    ```

// turbo
19. Delete the local fix branch:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git branch -d fix/<short-bug-description>
    ```

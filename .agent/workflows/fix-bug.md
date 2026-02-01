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

## 3. Quality Checks & Documentation

<!-- SYNC_START: quality_checks (Keep in sync with create-feature.md, resolve-tech-debt.md) -->
6. Run Code Quality Tools:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   ```

7. **Documentation Updates (if applicable)**:

   | Change Type | Files to Update |
   |-------------|-----------------|
   | API behavior change | `CLAUDE.md` (API Quick Reference section) |
   | Bug affects documented feature | Update relevant docs to clarify correct behavior |
   | Workaround removed | Remove outdated workaround notes from docs |

   **Note**: Bug fixes typically require less documentation than features, but if the fix changes expected behavior or API contracts, update the relevant docs.
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

## 5. Record and Commit

12. Update `docs/bugs.md`:
    - If the bug was listed in "Open Bugs", move it to "Resolved Bugs".
    - If it wasn't listed, add it to "Resolved Bugs" directly.

// turbo
13. Commit changes:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git add -A && git commit -m "fix: <description of fix>"
    ```

## 6. Push and PR

// turbo
14. Push the branch:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    git push -u origin fix/<short-bug-description>
    ```

// turbo
15. Create Pull Request:
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

## 7. Review and Merge

16. Open PR for user review:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr view --web
    ```

17. **Notify User**: Ask for review.

18. After approval, merge:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

## 8. Cleanup

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

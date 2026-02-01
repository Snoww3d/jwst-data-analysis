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
// turbo
6. Run Code Quality Tools:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy/frontend/jwst-frontend
   npm run lint && npm run format

   # cwd: /Users/shanon/Source/Astronomy
   dotnet format backend/JwstDataAnalysis.sln
   ```
<!-- SYNC_END -->

## 4. Record and Commit

7. Update `docs/bugs.md`:
   - If the bug was listed in "Open Bugs", move it to "Resolved Bugs".
   - If it wasn't listed, add it to "Resolved Bugs" directly.

// turbo
8. Commit changes:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git add -A && git commit -m "fix: <description of fix>"
   ```

## 5. Push and PR

// turbo
9. Push the branch:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git push -u origin fix/<short-bug-description>
   ```

// turbo
10. Create Pull Request:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr create --title "fix: <description>" --body "## 🐛 Bug Description
    <What was broken>
 
    ## 🛠️ Fix
    <What you changed>
 
    ## ✅ Verification
    - **Reproduction**: <How you reproduced it>
    - **Test Coverage**: <New or existing tests run>
    "
    ```

## 6. Review and Merge

// turbo
11. Open PR for user review:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr view --web
    ```

12. **Notify User**: Ask for review.

13. After approval, merge:
    ```bash
    # cwd: /Users/shanon/Source/Astronomy
    gh pr merge --squash --delete-branch
    ```

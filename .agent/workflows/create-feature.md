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

4. Commit changes with descriptive messages:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git add -A && git commit -m "feat: <description of change>"
   ```

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
   gh pr create --title "feat: <feature-name>" --body "## Description
   
   <Brief description of changes>
   
   ## Changes Made
   - <List key changes>
   
   ## Testing
   - <How was this tested?>"
   ```

## After PR Approval

7. Once approved, merge the PR:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   gh pr merge --squash --delete-branch
   ```

// turbo
8. Switch back to main and pull the merged changes:
   ```bash
   # cwd: /Users/shanon/Source/Astronomy
   git checkout main && git pull origin main
   ```

// turbo
9. Delete the local feature branch:
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

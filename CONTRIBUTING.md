# Contributing to Astronomy

Thank you for your interest in contributing to the Astronomy project! We welcome contributions from everyone.

## Development Workflow

We use a **Pull Request (PR)** workflow for all changes. Direct pushes to the `main` branch are discouraged (and may be blocked).

1.  **Fork** the repository (if you don't have write access) or create a new branch.
2.  **Create a branch** for your feature or fix.
    *   Use descriptive names: `feature/new-analysis-algo`, `fix/login-bug`, `docs/update-readme`.
3.  **Make your changes**.
4.  **Run tests locally** to ensure everything is working.
    *   Backend: `dotnet test`
    *   Frontend: `npm test`
    *   Processing Engine: `pytest`
5.  **Push** your branch to GitHub.
6.  **Open a Pull Request** against the `main` branch.
    *   Provide a clear title and description of your changes.
    *   Link to any relevant issues.
7.  **Wait for CI Checks**: Our GitHub Actions workflow will automatically run tests. Ensure all checks pass.
8.  **Code Review**: A team member will review your PR. Address any feedback.
9.  **Merge**: Once approved and checks pass, your code will be merged!

## Project Structure

*   `backend/`: .NET 8 Web API
*   `frontend/`: React + TypeScript
*   `processing-engine/`: Python FastAPI service

## coding Standards

Please refer to the documentation in `docs/standards/` for specific coding guidelines for each part of the stack.

## Questions?

If you have any questions, please open an issue or reach out to the team.

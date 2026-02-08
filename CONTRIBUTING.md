# Contributing to JWST Data Analysis

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Git

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/jwst-data-analysis.git
   cd jwst-data-analysis
   ```
3. Start the development environment:
   ```bash
   cd docker
   cp .env.example .env
   docker compose up -d
   ```
4. Verify services are running at http://localhost:3000

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/Snoww3d/jwst-data-analysis/issues) first
2. Create a new issue with:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (browser, OS)

### Suggesting Features

1. Check existing issues and discussions
2. Create a feature request with:
   - Problem you're trying to solve
   - Proposed solution
   - Alternatives considered

### Pull Requests

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our coding standards

3. **Test with Docker**:
   ```bash
   cd docker
   docker compose up -d --build
   ```

4. **Commit with conventional messages**:
   ```bash
   git commit -m "feat: Add new feature"
   ```

   Prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`

5. **Push and create PR**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **PR checklist**:
   - [ ] Clear description of changes
   - [ ] PR title uses conventional commit format (`feat:`, `fix:`, `docs:`, etc.)
   - [ ] PR template sections are fully completed
   - [ ] Tech debt impact is classified and `docs/tech-debt.md` is updated when debt changes
   - [ ] CI checks passing
   - [ ] Documentation updated (if needed)

7. **PR standards are enforced in CI**:
   - Pull requests are validated for title format, branch naming, template completeness, checklist status, and tech debt handling.
   - Draft PRs are exempt until marked ready for review.

## Coding Standards

### Backend (.NET)
- Async/await for I/O operations
- PascalCase for public members
- Dependency injection pattern

### Frontend (React/TypeScript)
- Functional components with hooks
- TypeScript interfaces for props/state
- Semantic HTML elements

### Python (Processing Engine)
- Type hints on all functions
- PEP 8 style
- Pydantic models for APIs

See [docs/standards/](./docs/standards/) for detailed guidelines.

## Project Structure

```
backend/                    # .NET API
frontend/jwst-frontend/     # React app
processing-engine/          # Python service
docker/                     # Docker configuration
docs/                       # Documentation
```

## Getting Help

- Open an issue for bugs or features
- Check documentation in `/docs`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

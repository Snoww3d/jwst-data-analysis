# Development Workflow Rules

## Git Management

- Repository is properly initialized and connected to GitHub
- Use feature branches for development
- Follow conventional commit messages
- Keep commits atomic and focused

## Agentic Workflows
When using AI agents, follow these standardized workflows located in `.agent/workflows/`:

### 1. Feature Creation (`/create-feature`)
Use for new features or capabilities.
- **Trigger**: "Create a feature for..."
- **Process**: Implementation -> E2E Test -> Unit Test -> PR -> Interactive Review -> Merge

### 2. Bug Fixing (`/fix-bug`)
Use for fixing bugs and issues.
- **Trigger**: "Fix the bug where..."
- **Process**: Reproduction -> Fix -> Verify -> Update `docs/bugs.md` -> PR -> Interactive Review -> Merge

### 3. Tech Debt Resolution (`/resolve-tech-debt`)
Use for specific items tracked in `docs/tech-debt.md`.
- **Trigger**: "Resolve tech debt #17"
- **Process**: Update `tech-debt.md` (InProgress) -> Implementation -> Verification -> PR -> Interactive Review -> Merge -> Update `tech-debt.md` (Resolved)

### 4. View Documentation (`/view-docs`)
Opens the documentation site in your browser.
- **Trigger**: "View docs" or just `/view-docs`
- **Behavior**: Opens the MkDocs site at `http://localhost:8001`, navigating to the page corresponding to your currently open markdown file.

### Workflow Comparison

| Aspect | Feature | Bug Fix | Tech Debt |
| :--- | :--- | :--- | :--- |
| **Branch Prefix** | `feature/` | `fix/` | `chore/` or `refactor/` |
| **Commit Prefix** | `feat:` | `fix:` | `refactor:` |
| **Doc Update** | Optional | `docs/bugs.md` | `docs/tech-debt.md` |
| **PR Title** | `feat: ...` | `fix: ...` | `Resolves Task #...` |


## Development Phases

Current focus: Phase 3/4 - Data Processing & Frontend Development

- Scientific processing algorithms (in progress)
- MAST portal integration (complete)
- Centralized frontend API service layer (complete)
- Interactive data visualization components
- Processing job queue system

## Testing Strategy

- Implement unit tests for all services
- Use integration tests for API endpoints
- Test processing algorithms thoroughly
- Implement end-to-end testing

## Code Quality

- Use linting and formatting tools
- Implement proper error handling
- Follow coding standards for each technology
- Use TypeScript for type safety
- Implement proper logging and monitoring

## Security Best Practices

- Never commit sensitive credentials
- Use environment variables for configuration
- Implement proper input validation
- Follow OWASP security guidelines
- Regular security audits

## Documentation

- Keep README.md updated
- Document API endpoints
- Maintain development plan
- Use inline code documentation
- Create user guides for features

## Deployment

- Use Docker for consistent environments
- Implement CI/CD pipelines
- Use proper environment management
- Monitor application health
- Implement proper backup strategies

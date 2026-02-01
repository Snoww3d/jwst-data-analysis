# Development Workflow Rules

## Git Management

- Repository is properly initialized and connected to GitHub
- Use feature branches for development
- Follow conventional commit messages
- Keep commits atomic and focused

## Agentic Workflows & Skills

We use two types of automation: **workflows** for development processes and **skills** for utility actions.

### Workflows (Code Changes + PR)

Multi-step development processes with git integration. Located in `.agent/workflows/`.

#### 1. Feature Creation (`/create-feature`)
Use for new features or capabilities.
- **Trigger**: "Create a feature for..."
- **Process**: Branch -> Implementation -> Quality Checks -> E2E Test -> PR -> Interactive Review -> Merge

#### 2. Bug Fixing (`/fix-bug`)
Use for fixing bugs and issues.
- **Trigger**: "Fix the bug where..."
- **Process**: Branch -> Reproduction -> Fix -> Verify -> Update `docs/bugs.md` -> PR -> Interactive Review -> Merge

#### 3. Tech Debt Resolution (`/resolve-tech-debt`)
Use for specific items tracked in `docs/tech-debt.md`.
- **Trigger**: "Resolve tech debt #17"
- **Process**: Update `tech-debt.md` (InProgress) -> Branch -> Implementation -> Verification -> PR -> Interactive Review -> Merge -> Update `tech-debt.md` (Resolved)

#### Workflow Comparison

| Aspect | Feature | Bug Fix | Tech Debt |
| :--- | :--- | :--- | :--- |
| **Branch Prefix** | `feature/` | `fix/` | `feature/task-N-` |
| **Commit Prefix** | `feat:` | `fix:` | `feat:` or `refactor:` |
| **Doc Update** | Optional | `docs/bugs.md` | `docs/tech-debt.md` |
| **PR Title** | `feat: ...` | `fix: ...` | `feat: ... (Task #N)` |

### Skills (Quick Utilities)

Simple, single-purpose commands with no git branches or PRs. Located in `~/.claude/commands/`.

| Skill | Purpose |
| :--- | :--- |
| `/start-application` | Start the full Docker stack with health checks |
| `/view-docs` | Open documentation site in browser |
| `/keybindings-help` | Customize keyboard shortcuts |

**Rule of thumb**: If it changes code → workflow. If it's a helper action → skill.


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

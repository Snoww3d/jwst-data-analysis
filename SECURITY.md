# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via email or GitHub's private vulnerability reporting:

1. **GitHub Security Advisories** (Preferred): Use GitHub's [private vulnerability reporting](https://github.com/Snoww3d/jwst-data-analysis/security/advisories/new)

2. **Email**: Contact the maintainers directly

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Resolution Timeline**: Depends on severity, typically 30-90 days

### Scope

The following are in scope:
- Backend API vulnerabilities
- Frontend security issues (XSS, CSRF, etc.)
- Authentication/authorization bypasses
- Data exposure risks
- Dependency vulnerabilities

### Out of Scope

- Vulnerabilities in third-party services (MAST Portal, etc.)
- Social engineering attacks
- Physical security
- Denial of service attacks

## Security Best Practices for Users

1. **Environment Variables**: Always use `.env` files for credentials, never commit them
2. **Production Passwords**: Use strong, unique passwords for MongoDB in production
3. **Network Security**: Don't expose MongoDB or internal services to the public internet
4. **Updates**: Keep Docker images and dependencies updated

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who report valid vulnerabilities.

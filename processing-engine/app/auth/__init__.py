"""Python authentication foundation (ADR 0001 Phase 1).

Token validation is always available. Register/login/refresh and the admin
lockout endpoints (#1186) require explicit PYTHON_AUTH_ENABLED=true until the
ADR 0001 auth cutover.
"""

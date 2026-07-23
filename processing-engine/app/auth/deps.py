# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""JWT validation dependencies for engine routes.

Validates access tokens issued by the .NET backend
(``backend/JwstDataAnalysis.API/Services/JwtTokenService.cs``): HS256 with the
shared ``JWT_SECRET_KEY``, issuer ``JwstDataAnalysis``, audience
``JwstDataAnalysisClient``. Live tokens carry ``sub``, ``unique_name``, ``email``, and the role under the
full ``schemas.microsoft.com`` claim URI (the handler's outbound map does not
shorten ``ClaimTypes.Role``).

This is the first slice of ADR-0001 Phase 1 (Python absorbs auth); token
*issuance* stays in .NET for now — the engine only validates.
"""

import os
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request


_ALGORITHM = "HS256"
_DEFAULT_ISSUER = "JwstDataAnalysis"
_DEFAULT_AUDIENCE = "JwstDataAnalysisClient"

# .NET's JwtSecurityTokenHandler outbound map does NOT shorten ClaimTypes.Role
# — live tokens carry the full URI (verified empirically against the running
# backend, 2026-07-23). Accept the short name too for forward compatibility.
_ROLE_CLAIMS = (
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
    "role",
)


@dataclass(frozen=True)
class AuthenticatedUser:
    """Identity extracted from a validated access token."""

    user_id: str
    username: str | None
    email: str | None
    role: str


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _decode(token: str) -> AuthenticatedUser:
    secret = os.environ.get("JWT_SECRET_KEY")
    if not secret:
        # Fail closed server-side: without the shared secret the engine can
        # neither accept nor meaningfully reject tokens.
        raise HTTPException(
            status_code=503, detail="Authentication is not configured on the engine"
        )

    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[_ALGORITHM],
            issuer=os.environ.get("JWT_ISSUER", _DEFAULT_ISSUER),
            audience=os.environ.get("JWT_AUDIENCE", _DEFAULT_AUDIENCE),
            options={"require": ["exp", "iss", "aud", "sub"]},
            # Match the .NET validator's ClockSkewSeconds (JwtSettings.cs) so
            # both services agree on token expiry at the boundary.
            leeway=int(os.environ.get("JWT_CLOCK_SKEW_SECONDS", "30")),
        )
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Invalid or expired token") from exc

    role = next((claims[name] for name in _ROLE_CLAIMS if claims.get(name)), "User")
    return AuthenticatedUser(
        user_id=str(claims["sub"]),
        username=claims.get("unique_name"),
        email=claims.get("email"),
        role=str(role),
    )


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization")
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def require_user(request: Request) -> AuthenticatedUser:
    """FastAPI dependency: reject the request unless a valid token is present."""
    token = _bearer_token(request)
    if token is None:
        raise _unauthorized("Not authenticated")
    return _decode(token)


def optional_user(request: Request) -> AuthenticatedUser | None:
    """FastAPI dependency: anonymous is allowed, but a present token must be
    valid — a bad token is a 401, never a silent downgrade to anonymous."""
    token = _bearer_token(request)
    if token is None:
        return None
    return _decode(token)


def require_role(role: str):
    """Dependency factory: require a valid token carrying the given role."""

    def _check(user: AuthenticatedUser = Depends(require_user)) -> AuthenticatedUser:
        if user.role != role:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user

    return _check

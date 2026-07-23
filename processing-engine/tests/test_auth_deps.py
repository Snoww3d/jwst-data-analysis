# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the JWT validation dependencies (app/auth/deps.py).

Tokens are minted in-test with the same HS256 secret/issuer/audience the
.NET backend uses (backend/JwstDataAnalysis.API/Services/JwtTokenService.cs)
so the validation path mirrors production exactly. Claim names verified
against a live backend token (2026-07-23): ``sub``, ``unique_name``,
``email``, ``jti``, ``iat``, and the role under the full
``schemas.microsoft.com`` URI (outbound mapping does NOT shorten it).
"""

import time

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth.deps import AuthenticatedUser, optional_user, require_user


SECRET = "unit-test-secret-key-at-least-32-chars!!"
ISSUER = "JwstDataAnalysis"
AUDIENCE = "JwstDataAnalysisClient"

USER_ID = "6862f1a2b3c4d5e6f7a8b9c0"

ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"


@pytest.fixture(autouse=True)
def _jwt_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)
    monkeypatch.setenv("JWT_ISSUER", ISSUER)
    monkeypatch.setenv("JWT_AUDIENCE", AUDIENCE)


def mint_token(
    *,
    secret: str = SECRET,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    role: str = "User",
    expires_in: int = 900,
    **extra: object,
) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "sub": USER_ID,
        "unique_name": "testuser",
        "email": "test@example.com",
        ROLE_URI: role,
        "jti": "00000000-0000-0000-0000-000000000001",
        "iat": now,
        "exp": now + expires_in,
        "iss": issuer,
        "aud": audience,
    }
    claims.update(extra)
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()

    @app.get("/protected")
    def protected(user: AuthenticatedUser = Depends(require_user)) -> dict[str, str]:
        return {"user_id": user.user_id, "role": user.role}

    @app.get("/optional")
    def optional(
        user: AuthenticatedUser | None = Depends(optional_user),
    ) -> dict[str, str | None]:
        return {"user_id": user.user_id if user else None}

    return TestClient(app)


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestRequireUser:
    def test_valid_token_returns_user(self, client: TestClient) -> None:
        response = client.get("/protected", headers=auth_header(mint_token()))
        assert response.status_code == 200
        assert response.json() == {"user_id": USER_ID, "role": "User"}

    def test_admin_role_extracted(self, client: TestClient) -> None:
        response = client.get("/protected", headers=auth_header(mint_token(role="Admin")))
        assert response.status_code == 200
        assert response.json()["role"] == "Admin"

    def test_short_role_claim_also_accepted(self, client: TestClient) -> None:
        # Forward-compat: accept the short "role" name alongside the .NET URI.
        now = int(time.time())
        token = jwt.encode(
            {
                "sub": USER_ID,
                "role": "Admin",
                "iss": ISSUER,
                "aud": AUDIENCE,
                "exp": now + 900,
            },
            SECRET,
            algorithm="HS256",
        )
        response = client.get("/protected", headers=auth_header(token))
        assert response.status_code == 200
        assert response.json()["role"] == "Admin"

    def test_missing_header_is_401(self, client: TestClient) -> None:
        response = client.get("/protected")
        assert response.status_code == 401
        assert response.headers.get("WWW-Authenticate") == "Bearer"

    def test_expired_token_is_401(self, client: TestClient) -> None:
        response = client.get("/protected", headers=auth_header(mint_token(expires_in=-60)))
        assert response.status_code == 401

    def test_just_expired_token_within_clock_skew_is_accepted(self, client: TestClient) -> None:
        # .NET validates with ClockSkewSeconds=30; the engine must agree at
        # the boundary or the two services intermittently disagree on expiry.
        response = client.get("/protected", headers=auth_header(mint_token(expires_in=-10)))
        assert response.status_code == 200

    def test_expired_beyond_clock_skew_is_401(self, client: TestClient) -> None:
        response = client.get("/protected", headers=auth_header(mint_token(expires_in=-31)))
        assert response.status_code == 401

    def test_wrong_issuer_is_401(self, client: TestClient) -> None:
        response = client.get("/protected", headers=auth_header(mint_token(issuer="Evil")))
        assert response.status_code == 401

    def test_wrong_audience_is_401(self, client: TestClient) -> None:
        response = client.get("/protected", headers=auth_header(mint_token(audience="OtherClient")))
        assert response.status_code == 401

    def test_wrong_key_is_401(self, client: TestClient) -> None:
        response = client.get(
            "/protected",
            headers=auth_header(mint_token(secret="a-completely-different-32char-key!!")),
        )
        assert response.status_code == 401

    def test_malformed_token_is_401(self, client: TestClient) -> None:
        response = client.get("/protected", headers=auth_header("not.a.jwt"))
        assert response.status_code == 401

    def test_non_bearer_scheme_is_401(self, client: TestClient) -> None:
        response = client.get("/protected", headers={"Authorization": f"Basic {mint_token()}"})
        assert response.status_code == 401

    def test_unsigned_alg_none_is_401(self, client: TestClient) -> None:
        # alg=none tokens must never validate, even with matching claims.
        now = int(time.time())
        token = jwt.encode(
            {
                "sub": USER_ID,
                "role": "Admin",
                "iss": ISSUER,
                "aud": AUDIENCE,
                "exp": now + 900,
            },
            key="",
            algorithm="none",
        )
        response = client.get("/protected", headers=auth_header(token))
        assert response.status_code == 401

    def test_missing_sub_claim_is_401(self, client: TestClient) -> None:
        now = int(time.time())
        token = jwt.encode(
            {"iss": ISSUER, "aud": AUDIENCE, "exp": now + 900, "role": "User"},
            SECRET,
            algorithm="HS256",
        )
        response = client.get("/protected", headers=auth_header(token))
        assert response.status_code == 401

    def test_missing_secret_env_is_503(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An engine deployed without JWT_SECRET_KEY must fail closed with a
        # server-side error, not accept or mis-reject tokens.
        monkeypatch.delenv("JWT_SECRET_KEY")
        response = client.get("/protected", headers=auth_header(mint_token()))
        assert response.status_code == 503


class TestOptionalUser:
    def test_no_header_returns_none(self, client: TestClient) -> None:
        response = client.get("/optional")
        assert response.status_code == 200
        assert response.json() == {"user_id": None}

    def test_valid_token_returns_user(self, client: TestClient) -> None:
        response = client.get("/optional", headers=auth_header(mint_token()))
        assert response.status_code == 200
        assert response.json() == {"user_id": USER_ID}

    def test_invalid_token_is_401(self, client: TestClient) -> None:
        # A present-but-bad token is an error, not anonymous access —
        # silently downgrading would mask expired sessions.
        response = client.get("/optional", headers=auth_header(mint_token(expires_in=-60)))
        assert response.status_code == 401

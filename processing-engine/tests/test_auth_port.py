"""AuthModels/AuthService/JwtTokenService contract and failure cases (#1991)."""

import base64
from copy import deepcopy
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from bson import ObjectId
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from pymongo.errors import DuplicateKeyError, OperationFailure, ServerSelectionTimeoutError

from app.auth.deps import require_role, require_user
from app.auth.models import LoginRequest
from app.auth.routes import get_auth_service, router
from app.auth.service import (
    DUPLICATE,
    INVALID_LOGIN,
    INVALID_REFRESH,
    AuthService,
    TokenSettings,
    hash_password,
    hash_refresh,
    utcnow,
    verify_password,
)
from app.db.users import UserRepository


SECRET = "auth-port-test-only-secret-at-least-32-characters"
PASSWORD = "LegacyPass1!"
# Generated with the repository's BCrypt.Net-Next 4.0.3 HashPassword(password, 12),
# .NET 10, 2026-09-09. These are synthetic public test credentials.
LEGACY_HASH = "$2a$12$lYm.QilgTIi7Oyzuc/0/mOvWwFh69Fj3yLqOE6EGFRg3hgtEAn5KS"
LONG_HASH = "$2a$12$kD73vg0BdG1P2NQa3BrYKuxUT2JSG96Cj7SIjn3O8h2YQUlw./rMm"
UNICODE_HASH = "$2a$12$hMH4dGvHKm/ubisS61o.Cu8f5tUW4qNhBjb5HzVWp5Zwxbo5U6426"
ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
USER_KEYS = {
    "id",
    "username",
    "email",
    "role",
    "displayName",
    "organization",
    "createdAt",
    "lastLoginAt",
}
TOKEN_KEYS = {"accessToken", "refreshToken", "expiresAt", "tokenType", "user"}


def legacy_user(**fields):
    return {
        "_id": ObjectId(),
        "Username": "legacy",
        "Email": "Legacy@example.com",
        "PasswordHash": LEGACY_HASH,
        "Role": "Admin",
        "IsActive": True,
        "CreatedAt": utcnow().replace(tzinfo=None),
        "LastLoginAt": None,
        "FailedLoginAttempts": 3,
        "LockedUntil": None,
        "RefreshToken": hash_refresh("legacy-refresh"),
        "RefreshTokenExpiresAt": utcnow() + timedelta(days=1),
        "PreviousRefreshToken": hash_refresh("old-refresh"),
        "PreviousRefreshTokenExpiresAt": utcnow() + timedelta(seconds=60),
        "UnrelatedPrivateField": "must-never-leak",
        **fields,
    }


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("PYTHON_AUTH_ENABLED", "true")
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)
    monkeypatch.setenv("JWT_ISSUER", "JwstDataAnalysis")
    monkeypatch.setenv("JWT_AUDIENCE", "JwstDataAnalysisClient")


@pytest.fixture
def repo():
    result = AsyncMock(spec=UserRepository)
    result.by_username.return_value = None
    result.by_email.return_value = None
    result.by_refresh.return_value = None
    result.save_login.return_value = True
    result.rotate.return_value = True
    return result


@pytest.fixture
def app(env, repo):
    application = FastAPI()
    application.include_router(router)
    application.dependency_overrides[get_auth_service] = lambda: AuthService(
        repo, TokenSettings.from_env()
    )

    @application.get("/protected")
    def protected(user=Depends(require_user)):
        return {"id": user.user_id, "role": user.role}

    @application.get("/admin")
    def admin(user=Depends(require_role("Admin"))):
        return {"id": user.user_id}

    return application


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        yield value


def assert_tokens(body):
    assert set(body) == TOKEN_KEYS
    assert set(body["user"]) == USER_KEYS
    assert body["tokenType"] == "Bearer"
    assert len(base64.b64decode(body["refreshToken"])) == 64
    assert "must-never-leak" not in str(body)
    assert LEGACY_HASH not in str(body)
    claims = jwt.decode(
        body["accessToken"],
        SECRET,
        algorithms=["HS256"],
        issuer="JwstDataAnalysis",
        audience="JwstDataAnalysisClient",
    )
    assert set(claims) == {
        "sub",
        "unique_name",
        "email",
        ROLE_URI,
        "jti",
        "iat",
        "exp",
        "iss",
        "aud",
    }
    assert claims["sub"] == body["user"]["id"]
    assert claims[ROLE_URI] == body["user"]["role"]
    assert claims["exp"] - claims["iat"] == 3600
    return claims


@pytest.mark.parametrize(
    ("password", "stored"),
    [
        (PASSWORD, LEGACY_HASH),
        ("a" * 80 + "A1!", LONG_HASH),
        ("é" * 40 + "A1!", UNICODE_HASH),
    ],
)
def test_verifies_real_dotnet_hashes(password, stored):
    assert verify_password(password, stored)
    assert not verify_password("WrongPass1!", stored)


@pytest.mark.parametrize("stored", [None, "", "corrupt", "非ASCII"])
def test_missing_or_corrupt_hash_fails_closed(stored):
    assert not verify_password(PASSWORD, stored)
    assert not verify_password("dummy-timing-normalization", stored)


def test_python_password_hash_roundtrip_and_cost():
    hashed = hash_password(PASSWORD)
    assert hashed.startswith("$2b$12$")
    assert verify_password(PASSWORD, hashed)


async def test_login_legacy_contract_and_dependencies(client, repo):
    user = legacy_user()
    repo.by_username.return_value = user
    response = await client.post(
        "/api/auth/login", json={"username": "legacy", "password": PASSWORD}
    )
    assert response.status_code == 200
    body = response.json()
    assert_tokens(body)
    assert response.headers["cache-control"] == "no-store"
    assert body["user"]["lastLoginAt"].endswith("Z")
    fields = repo.save_login.call_args.args[1]
    assert fields["RefreshToken"] == hash_refresh(body["refreshToken"])
    assert fields["PreviousRefreshToken"] is None
    assert set(fields) == {
        "RefreshToken",
        "RefreshTokenExpiresAt",
        "PreviousRefreshToken",
        "PreviousRefreshTokenExpiresAt",
        "LastLoginAt",
    }
    headers = {"Authorization": "Bearer " + body["accessToken"]}
    assert (await client.get("/protected", headers=headers)).json() == {
        "id": str(user["_id"]),
        "role": "Admin",
    }
    assert (await client.get("/admin", headers=headers)).status_code == 200


async def test_email_login_fallback(client, repo):
    repo.by_email.return_value = legacy_user()
    response = await client.post(
        "/api/auth/login", json={"username": "LEGACY@example.com", "password": PASSWORD}
    )
    assert response.status_code == 200
    repo.by_username.assert_awaited_once_with("LEGACY@example.com")
    repo.by_email.assert_awaited_once_with("LEGACY@example.com")


@pytest.mark.parametrize("kind", ["unknown", "wrong", "inactive", "locked", "malformed", "changed"])
async def test_generic_login_failures(client, repo, kind):
    user = legacy_user()
    if kind == "inactive":
        user["IsActive"] = False
    if kind == "locked":
        user["LockedUntil"] = utcnow() + timedelta(minutes=10)
    if kind == "malformed":
        user["PasswordHash"] = "not-bcrypt"
    if kind == "changed":
        repo.save_login.return_value = False
    repo.by_username.return_value = None if kind == "unknown" else user
    response = await client.post(
        "/api/auth/login",
        json={"username": "legacy", "password": "WrongPass1!" if kind == "wrong" else PASSWORD},
    )
    assert response.status_code == 401
    assert response.json() == {"error": INVALID_LOGIN}
    if kind != "changed":
        repo.save_login.assert_not_awaited()


async def test_missing_user_does_bcrypt_work(client, repo):
    with patch("app.auth.service.bcrypt.checkpw", wraps=__import__("bcrypt").checkpw) as check:
        assert (
            await client.post("/api/auth/login", json={"username": "missing", "password": PASSWORD})
        ).status_code == 401
        check.assert_called_once()


async def test_register_contract_and_safe_defaults(client, repo):
    response = await client.post(
        "/api/auth/register",
        json={
            "username": "new-user",
            "email": "New@Example.com",
            "password": PASSWORD,
            "displayName": "New User",
            "organization": "STScI",
            "role": "Admin",
            "isActive": False,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert_tokens(body)
    assert body["user"]["role"] == "User"
    assert body["user"]["email"] == "new@example.com"
    assert body["user"]["displayName"] == "New User"
    assert body["user"]["organization"] == "STScI"
    assert body["user"]["lastLoginAt"] is None
    stored = repo.insert.call_args.args[0]
    assert isinstance(stored["_id"], ObjectId)
    assert stored["FailedLoginAttempts"] == 0 and stored["LockedUntil"] is None
    assert stored["IsActive"] is True
    assert verify_password(PASSWORD, stored["PasswordHash"])
    assert stored["RefreshToken"] == hash_refresh(body["refreshToken"])
    headers = {"Authorization": "Bearer " + body["accessToken"]}
    assert (await client.get("/admin", headers=headers)).status_code == 403
    repo.ensure_indexes.assert_awaited_once()


@pytest.mark.parametrize("kind", ["username", "email", "race"])
async def test_duplicate_registration_generic_400(client, repo, kind):
    if kind == "username":
        repo.by_username.return_value = legacy_user()
    elif kind == "email":
        repo.by_email.return_value = legacy_user()
    else:
        repo.insert.side_effect = DuplicateKeyError("private database detail")
    response = await client.post(
        "/api/auth/register",
        json={"username": "legacy", "email": "Legacy@example.com", "password": PASSWORD},
    )
    assert response.status_code == 400
    assert response.json() == {"error": DUPLICATE}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("login", {"username": "ab", "password": PASSWORD}),
        ("login", {"username": "a" * 51, "password": PASSWORD}),
        ("login", {"username": "legacy", "password": "a" * 101}),
        ("login", {"username": "legacy", "password": "short"}),
        ("login", {"username": {"$ne": None}, "password": PASSWORD}),
        ("login", {"username": "   ", "password": PASSWORD}),
        ("register", {"username": "legacy", "email": "invalid", "password": PASSWORD}),
        ("register", {"username": "legacy", "email": "x@y.z", "password": "NoDigits!"}),
        ("register", {"username": "legacy", "email": "x@y.z", "password": "noupper1!"}),
        ("register", {"username": "legacy", "email": "x@y.z", "password": "NOLOWER1!"}),
        ("register", {"username": "legacy", "email": "x@y.z", "password": "NoSpecial1"}),
        (
            "register",
            {
                "username": "legacy",
                "email": "x@y.z",
                "password": PASSWORD,
                "displayName": "a" * 101,
            },
        ),
        ("refresh", {"refreshToken": ""}),
        ("refresh", {"refreshToken": " "}),
        ("refresh", {"refreshToken": "private-token" * 100}),
        ("refresh", {"refreshToken": {"$ne": None}}),
        ("refresh", {}),
    ],
)
async def test_invalid_input_is_400_without_reflection(client, repo, path, body):
    response = await client.post("/api/auth/" + path, json=body)
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid authentication request"}
    repo.insert.assert_not_awaited()
    repo.save_login.assert_not_awaited()
    repo.rotate.assert_not_awaited()


async def test_invalid_json_never_reflects_password(client):
    response = await client.post(
        "/api/auth/login",
        content='{"password":"private-secret",',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert "private-secret" not in response.text


@pytest.mark.parametrize("path", ["login", "register", "refresh"])
async def test_disabled_by_default_even_before_body_parse(client, app, monkeypatch, path):
    monkeypatch.delenv("PYTHON_AUTH_ENABLED")
    dependency = AsyncMock(side_effect=AssertionError("must not touch DB"))
    app.dependency_overrides[get_auth_service] = dependency
    response = await client.post("/api/auth/" + path, content="malformed")
    assert response.status_code == 503
    assert response.json() == {"error": "Python authentication is not enabled"}
    dependency.assert_not_called()


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("JWT_SECRET_KEY", ""),
        ("JWT_SECRET_KEY", "short"),
        ("JWT_ISSUER", ""),
        ("JWT_AUDIENCE", ""),
        ("JWT_ACCESS_TOKEN_EXPIRATION_MINUTES", "oops"),
        ("JWT_REFRESH_TOKEN_EXPIRATION_DAYS", "0"),
        ("JWT_REFRESH_TOKEN_GRACE_WINDOW_SECONDS", "-1"),
    ],
)
async def test_bad_config_fails_before_writing(client, repo, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    response = await client.post(
        "/api/auth/login", json={"username": "legacy", "password": PASSWORD}
    )
    assert response.status_code == 503
    repo.by_username.assert_not_awaited()


@pytest.mark.parametrize(
    "operation", ["lookup", "indexes", "insert", "login-write", "refresh-write"]
)
async def test_database_failure_sanitized(client, repo, operation):
    error = ServerSelectionTimeoutError("mongodb://private-user:private-password@internal")
    path = "register"
    body = {"username": "legacy", "email": "x@y.z", "password": PASSWORD}
    if operation == "lookup":
        repo.by_username.side_effect = error
    elif operation == "indexes":
        repo.ensure_indexes.side_effect = OperationFailure("private index details")
    elif operation == "insert":
        repo.insert.side_effect = error
    elif operation == "login-write":
        path = "login"
        repo.by_username.return_value = legacy_user()
        repo.save_login.side_effect = error
    else:
        path = "refresh"
        body = {"refreshToken": "legacy-refresh"}
        repo.by_refresh.return_value = legacy_user()
        repo.rotate.side_effect = error
    response = await client.post("/api/auth/" + path, json=body)
    assert response.status_code == 503
    assert response.json() == {"error": "Authentication service unavailable"}


@pytest.mark.parametrize("previous", [False, True])
async def test_refresh_contract_and_grace_rotation(client, repo, previous):
    repo.by_refresh.return_value = legacy_user()
    raw = "old-refresh" if previous else "legacy-refresh"
    response = await client.post("/api/auth/refresh", json={"refreshToken": raw})
    assert response.status_code == 200
    body = response.json()
    assert_tokens(body)
    repo.by_refresh.assert_awaited_once()
    assert repo.by_refresh.call_args.args[0] == hash_refresh(raw)
    fields = repo.rotate.call_args.args[2]
    assert fields["RefreshToken"] == hash_refresh(body["refreshToken"])
    assert fields["PreviousRefreshToken"] == (None if previous else hash_refresh(raw))
    if not previous:
        assert 58 < (fields["PreviousRefreshTokenExpiresAt"] - utcnow()).total_seconds() <= 60


@pytest.mark.parametrize(
    "kind",
    [
        "unknown",
        "inactive",
        "locked",
        "expired",
        "null-expiry",
        "grace-expired",
        "wrong-hash",
        "race",
    ],
)
async def test_refresh_failures(client, repo, kind):
    user = legacy_user()
    raw = "legacy-refresh"
    if kind == "inactive":
        user["IsActive"] = False
    elif kind == "locked":
        user["LockedUntil"] = utcnow() + timedelta(minutes=10)
    elif kind == "expired":
        user["RefreshTokenExpiresAt"] = utcnow() - timedelta(seconds=1)
    elif kind == "null-expiry":
        user["RefreshTokenExpiresAt"] = None
    elif kind == "grace-expired":
        raw = "old-refresh"
        user["PreviousRefreshTokenExpiresAt"] = utcnow() - timedelta(seconds=1)
    elif kind == "wrong-hash":
        raw = "not-stored"
    elif kind == "race":
        repo.rotate.return_value = False
    repo.by_refresh.return_value = None if kind == "unknown" else user
    response = await client.post("/api/auth/refresh", json={"refreshToken": raw})
    assert response.status_code == 401
    assert response.json() == {"error": INVALID_REFRESH}
    if kind == "race":
        assert repo.rotate.await_count == 2
    else:
        repo.rotate.assert_not_awaited()


async def test_rotation_loser_retries_using_grace(client, repo):
    original = legacy_user()
    rotated = deepcopy(original)
    rotated.update(
        RefreshToken=hash_refresh("concurrent-winner"),
        PreviousRefreshToken=original["RefreshToken"],
    )
    repo.by_refresh.side_effect = [original, rotated]
    repo.rotate.side_effect = [False, True]
    response = await client.post("/api/auth/refresh", json={"refreshToken": "legacy-refresh"})
    assert response.status_code == 200
    assert repo.rotate.await_count == 2
    assert repo.rotate.call_args.args[2]["PreviousRefreshToken"] is None


async def test_login_keeps_expired_lockout_and_counter_for_1186(repo):
    user = legacy_user(LockedUntil=utcnow() - timedelta(minutes=1))
    repo.by_username.return_value = user
    await AuthService(repo, TokenSettings(SECRET)).login(
        LoginRequest(username="legacy", password=PASSWORD)
    )
    assert user["FailedLoginAttempts"] == 3
    assert "LockedUntil" not in repo.save_login.call_args.args[1]


def test_setting_overrides(env, monkeypatch):
    monkeypatch.setenv("JWT_ACCESS_TOKEN_EXPIRATION_MINUTES", "15")
    monkeypatch.setenv("JWT_REFRESH_TOKEN_EXPIRATION_DAYS", "2")
    monkeypatch.setenv("JWT_REFRESH_TOKEN_GRACE_WINDOW_SECONDS", "0")
    settings = TokenSettings.from_env()
    assert (settings.access_minutes, settings.refresh_days, settings.grace_seconds) == (15, 2, 0)


async def test_missing_mongo_configuration(client, app, monkeypatch):
    app.dependency_overrides.clear()
    monkeypatch.delenv("MONGODB_URI", raising=False)
    response = await client.post(
        "/api/auth/login", json={"username": "legacy", "password": PASSWORD}
    )
    assert response.status_code == 503
    assert response.json() == {"error": "Authentication service unavailable"}

"""Real Mongo 8 proofs. Uses AUTH_TEST_MONGODB_URI or the CI MONGODB_URI.

Creates and drops only a random auth_port_test_* database. Never uses the app DB.
"""

import asyncio
import os
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

from app.auth.routes import get_auth_service, router
from app.auth.service import AuthService, TokenSettings, hash_refresh, utcnow
from app.db.users import MongoUserRepository
from tests.test_auth_port import PASSWORD, SECRET, assert_tokens, legacy_user


@pytest.fixture
async def collection():
    uri = os.environ.get("AUTH_TEST_MONGODB_URI") or os.environ.get("MONGODB_URI")
    if not uri:
        pytest.skip("Set AUTH_TEST_MONGODB_URI to run real Mongo auth integration tests")
    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=5000)
    database = client["auth_port_test_" + uuid4().hex]
    try:
        await client.admin.command("ping")
        yield database["users"]
    finally:
        await client.drop_database(database.name)
        client.close()


@pytest.fixture
async def repo(collection):
    result = MongoUserRepository(collection)
    await result.ensure_indexes()
    return result


@pytest.fixture
async def client(repo, monkeypatch):
    monkeypatch.setenv("PYTHON_AUTH_ENABLED", "true")
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_auth_service] = lambda: AuthService(repo, TokenSettings(SECRET))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as result:
        yield result


async def test_existing_user_login_refresh_grace_replay(client, collection):
    user = legacy_user()
    original = deepcopy(user)
    await collection.insert_one(user)
    login = await client.post(
        "/api/auth/login", json={"username": "LEGACY@example.com", "password": PASSWORD}
    )
    assert login.status_code == 200
    assert_tokens(login.json())
    current = login.json()["refreshToken"]
    stored = await collection.find_one({"_id": user["_id"]})
    assert stored["RefreshToken"] == hash_refresh(current)
    for key in ("PasswordHash", "FailedLoginAttempts", "LockedUntil", "UnrelatedPrivateField"):
        assert stored[key] == original[key]
    for raw in (current, current):
        response = await client.post("/api/auth/refresh", json={"refreshToken": raw})
        assert response.status_code == 200
        assert_tokens(response.json())
    replay = await client.post("/api/auth/refresh", json={"refreshToken": current})
    assert replay.status_code == 401
    assert (
        await client.post(
            "/api/auth/refresh", json={"refreshToken": response.json()["refreshToken"]}
        )
    ).status_code == 200


async def test_registration_to_login_to_refresh(client, collection):
    body = {"username": "new-user", "email": "New@example.com", "password": PASSWORD}
    registered = await client.post("/api/auth/register", json=body)
    assert registered.status_code == 201
    stored = await collection.find_one({"Username": "new-user"})
    assert stored["Email"] == "new@example.com"
    assert stored["PasswordHash"].startswith("$2b$12$")
    login = await client.post(
        "/api/auth/login", json={"username": "new-user", "password": PASSWORD}
    )
    assert login.status_code == 200
    assert (
        await client.post(
            "/api/auth/refresh", json={"refreshToken": registered.json()["refreshToken"]}
        )
    ).status_code == 401
    assert (
        await client.post("/api/auth/refresh", json={"refreshToken": login.json()["refreshToken"]})
    ).status_code == 200


async def test_indexes_match_dotnet_and_repeated_initialization(repo, collection):
    await repo.ensure_indexes()
    indexes = await collection.index_information()
    assert indexes["idx_username_unique"]["unique"]
    assert indexes["idx_email_unique"]["unique"]
    assert indexes["idx_email_unique"]["collation"]["strength"] == 2
    assert indexes["idx_refreshToken"]["key"] == [("RefreshToken", 1)]
    await collection.insert_one(legacy_user())
    with pytest.raises(DuplicateKeyError):
        await collection.insert_one(legacy_user(Username="different", Email="LEGACY@EXAMPLE.COM"))
    with pytest.raises(DuplicateKeyError):
        await collection.insert_one(legacy_user(Email="other@example.com"))


@pytest.mark.parametrize("shared", ["username", "email"])
async def test_concurrent_register_only_one_account(client, collection, shared):
    bodies = [
        {
            "username": "same" if shared == "username" else f"user{n}",
            "email": f"user{n}@example.com"
            if shared == "username"
            else ["Same@example.com", "SAME@example.com"][n],
            "password": PASSWORD,
        }
        for n in range(2)
    ]
    responses = await asyncio.gather(
        *(client.post("/api/auth/register", json=body) for body in bodies)
    )
    assert sorted(r.status_code for r in responses) == [201, 400]
    assert await collection.count_documents({}) == 1


async def test_email_regex_is_literal_and_username_case_sensitive(repo, collection):
    user = legacy_user(Email="a+b@example.com")
    await collection.insert_one(user)
    assert (await repo.by_email("A+B@EXAMPLE.COM"))["_id"] == user["_id"]
    assert await repo.by_email(".*@example.com") is None
    assert await repo.by_username("Legacy") is None


@pytest.mark.parametrize("security_change", ["password", "inactive", "locked", "demoted"])
async def test_login_rechecks_security_state(repo, collection, security_change):
    user = legacy_user()
    await collection.insert_one(user)
    change = {
        "password": {"PasswordHash": "changed"},
        "demoted": {"Role": "User"},
        "inactive": {"IsActive": False},
        "locked": {"LockedUntil": utcnow() + timedelta(minutes=1)},
    }[security_change]
    await collection.update_one({"_id": user["_id"]}, {"$set": change})
    assert not await repo.save_login(user, {"RefreshToken": "must-not-save"}, utcnow())
    assert (await collection.find_one({"_id": user["_id"]}))["RefreshToken"] == user["RefreshToken"]


async def test_targeted_login_preserves_concurrent_lockout_counter(repo, collection):
    user = legacy_user()
    await collection.insert_one(user)
    await collection.update_one(
        {"_id": user["_id"]},
        {"$inc": {"FailedLoginAttempts": 1}, "$set": {"ExtraField": "concurrent"}},
    )
    assert await repo.save_login(
        user, {"LastLoginAt": utcnow(), "RefreshToken": "new-hash"}, utcnow()
    )
    stored = await collection.find_one({"_id": user["_id"]})
    assert stored["FailedLoginAttempts"] == 4
    assert stored["ExtraField"] == "concurrent"
    assert stored["UnrelatedPrivateField"] == "must-never-leak"


@pytest.mark.parametrize(
    "change",
    [
        {"RefreshToken": None, "PreviousRefreshToken": None},
        {"RefreshToken": "new-login-hash", "PreviousRefreshToken": None},
        {"IsActive": False},
        {"Role": "User"},
        {"PasswordHash": "changed"},
    ],
)
async def test_refresh_cas_cannot_revive_revoked_state(repo, collection, change):
    user = legacy_user()
    await collection.insert_one(user)
    await collection.update_one({"_id": user["_id"]}, {"$set": change})
    assert not await repo.rotate(
        user, user["RefreshToken"], {"RefreshToken": "must-not-save"}, utcnow()
    )
    assert (await collection.find_one({"_id": user["_id"]}))["RefreshToken"] != "must-not-save"


async def test_concurrent_refresh_cas_one_winner(repo, collection):
    user = legacy_user()
    await collection.insert_one(user)
    writes = await asyncio.gather(
        *(
            repo.rotate(user, user["RefreshToken"], {"RefreshToken": f"new-hash-{n}"}, utcnow())
            for n in range(2)
        )
    )
    assert sorted(writes) == [False, True]


async def test_concurrent_http_refresh_bounded_grace(client, collection):
    await collection.insert_one(legacy_user())
    responses = await asyncio.gather(
        *(
            client.post("/api/auth/refresh", json={"refreshToken": "legacy-refresh"})
            for _ in range(2)
        )
    )
    assert [r.status_code for r in responses] == [200, 200]
    assert (
        await client.post("/api/auth/refresh", json={"refreshToken": "legacy-refresh"})
    ).status_code == 401
    stored = await collection.find_one({"Username": "legacy"})
    assert (
        sum(hash_refresh(r.json()["refreshToken"]) == stored["RefreshToken"] for r in responses)
        == 1
    )


@pytest.mark.parametrize("field", ["RefreshTokenExpiresAt", "PreviousRefreshTokenExpiresAt"])
async def test_expiration_boundary_is_exclusive(repo, collection, field):
    now = utcnow().replace(microsecond=0)
    user = legacy_user(**{field: now})
    await collection.insert_one(user)
    raw = "legacy-refresh" if field == "RefreshTokenExpiresAt" else "old-refresh"
    assert await repo.by_refresh(hash_refresh(raw), now) is None
    assert not await repo.rotate(user, hash_refresh(raw), {"RefreshToken": "must-not-save"}, now)


async def test_missing_optional_security_fields_match_dotnet_defaults(repo, collection):
    user = legacy_user()
    for field in ("LockedUntil", "IsActive", "FailedLoginAttempts"):
        del user[field]
    await collection.insert_one(user)
    assert await repo.save_login(user, {"LastLoginAt": utcnow()}, utcnow())

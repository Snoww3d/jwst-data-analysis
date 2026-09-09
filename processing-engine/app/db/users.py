"""Write repository for existing .NET users (PascalCase fields, ObjectId ids)."""

import re
from datetime import datetime
from typing import Protocol

from pymongo import IndexModel
from pymongo.collation import Collation


class UserRepository(Protocol):
    async def ensure_indexes(self) -> None: ...
    async def by_username(self, username: str) -> dict | None: ...
    async def by_email(self, email: str) -> dict | None: ...
    async def by_refresh(self, token_hash: str, now: datetime) -> dict | None: ...
    async def insert(self, user: dict) -> None: ...
    async def save_login(self, user: dict, fields: dict, now: datetime) -> bool: ...
    async def rotate(self, user: dict, token_hash: str, fields: dict, now: datetime) -> bool: ...


def _eligible(now: datetime) -> dict:
    # Missing IsActive defaults true in the .NET model. Missing lockout is unlocked.
    return {
        "IsActive": {"$ne": False},
        "$or": [{"LockedUntil": None}, {"LockedUntil": {"$lte": now}}],
    }


def _refresh_match(token_hash: str, now: datetime) -> dict:
    return {
        "$or": [
            {"RefreshToken": token_hash, "RefreshTokenExpiresAt": {"$gt": now}},
            {"PreviousRefreshToken": token_hash, "PreviousRefreshTokenExpiresAt": {"$gt": now}},
        ]
    }


class MongoUserRepository:
    def __init__(self, collection) -> None:
        self._col = collection

    async def ensure_indexes(self) -> None:
        # Same names/options as MongoDBService.EnsureUserIndexesAsync. Fail closed
        # if uniqueness cannot be enforced (including incompatible existing indexes).
        await self._col.create_indexes(
            [
                IndexModel("Username", name="idx_username_unique", unique=True, background=True),
                IndexModel(
                    "Email",
                    name="idx_email_unique",
                    unique=True,
                    background=True,
                    collation=Collation("en", strength=2),
                ),
                IndexModel("RefreshToken", name="idx_refreshToken", background=True),
            ]
        )

    async def by_username(self, username: str) -> dict | None:
        return await self._col.find_one({"Username": username})

    async def by_email(self, email: str) -> dict | None:
        return await self._col.find_one(
            {"Email": {"$regex": "^" + re.escape(email) + "$", "$options": "i"}}
        )

    async def by_refresh(self, token_hash: str, now: datetime) -> dict | None:
        return await self._col.find_one(_refresh_match(token_hash, now))

    async def insert(self, user: dict) -> None:
        await self._col.insert_one(user)

    async def save_login(self, user: dict, fields: dict, now: datetime) -> bool:
        result = await self._col.update_one(
            {
                "_id": user["_id"],
                "PasswordHash": user["PasswordHash"],
                "Role": user.get("Role"),
                **_eligible(now),
            },
            {"$set": fields},
        )
        return result.matched_count == 1

    async def rotate(self, user: dict, token_hash: str, fields: dict, now: datetime) -> bool:
        result = await self._col.update_one(
            {
                "_id": user["_id"],
                "RefreshToken": user.get("RefreshToken"),
                "Role": user.get("Role"),
                "PasswordHash": user["PasswordHash"],
                "$and": [_eligible(now), _refresh_match(token_hash, now)],
            },
            {"$set": fields},
        )
        return result.matched_count == 1

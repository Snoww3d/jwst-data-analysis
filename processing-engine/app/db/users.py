"""Write repository for existing .NET users (PascalCase fields, ObjectId ids)."""

import re
from datetime import datetime
from typing import Protocol

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import IndexModel, ReturnDocument
from pymongo.collation import Collation


class UserRepository(Protocol):
    async def ensure_indexes(self) -> None: ...
    async def by_username(self, username: str) -> dict | None: ...
    async def by_email(self, email: str) -> dict | None: ...
    async def by_refresh(self, token_hash: str, now: datetime) -> dict | None: ...
    async def by_id(self, user_id: str) -> dict | None: ...
    async def insert(self, user: dict) -> None: ...
    async def save_login(self, user: dict, fields: dict, now: datetime) -> bool: ...
    async def rotate(self, user: dict, token_hash: str, fields: dict, now: datetime) -> bool: ...
    async def record_failed_login(
        self, user: dict, max_attempts: int, locked_until: datetime
    ) -> int: ...
    async def reset_lockout(self, user_id: ObjectId) -> bool: ...


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

    async def by_id(self, user_id: str) -> dict | None:
        try:
            object_id = ObjectId(user_id)
        except (InvalidId, TypeError):
            # A malformed id cannot name a user: same answer as an unknown one.
            return None
        return await self._col.find_one({"_id": object_id})

    async def insert(self, user: dict) -> None:
        await self._col.insert_one(user)

    async def save_login(self, user: dict, fields: dict, now: datetime) -> bool:
        result = await self._col.update_one(
            {
                "_id": user["_id"],
                "PasswordHash": user.get("PasswordHash", ""),
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
                "PasswordHash": user.get("PasswordHash", ""),
                "$and": [_eligible(now), _refresh_match(token_hash, now)],
            },
            {"$set": fields},
        )
        return result.matched_count == 1

    async def record_failed_login(
        self, user: dict, max_attempts: int, locked_until: datetime
    ) -> int:
        # One atomic pipeline update: concurrent failures each count, and the
        # attempt that reaches the threshold sets LockedUntil (.NET parity).
        attempts = {"$add": [{"$ifNull": ["$FailedLoginAttempts", 0]}, 1]}
        updated = await self._col.find_one_and_update(
            {"_id": user["_id"]},
            [
                {"$set": {"FailedLoginAttempts": attempts}},
                {
                    "$set": {
                        "LockedUntil": {
                            "$cond": [
                                {"$gte": ["$FailedLoginAttempts", max_attempts]},
                                locked_until,
                                {"$ifNull": ["$LockedUntil", None]},
                            ]
                        }
                    }
                },
            ],
            projection={"FailedLoginAttempts": 1},
            return_document=ReturnDocument.AFTER,
        )
        return 0 if updated is None else int(updated["FailedLoginAttempts"])

    async def reset_lockout(self, user_id: ObjectId) -> bool:
        result = await self._col.update_one(
            {"_id": user_id}, {"$set": {"FailedLoginAttempts": 0, "LockedUntil": None}}
        )
        return result.matched_count == 1

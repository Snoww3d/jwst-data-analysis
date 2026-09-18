"""Auth foundation with .NET-compatible lockout (#1186)."""

import base64
import hashlib
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from uuid import uuid4

import bcrypt
import jwt
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

from app.auth.deps import _ALGORITHM, _DEFAULT_AUDIENCE, _DEFAULT_ISSUER, _ROLE_CLAIMS
from app.auth.models import (
    LockoutStatus,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserInfo,
)
from app.db.users import UserRepository


logger = logging.getLogger(__name__)

DUPLICATE = "An account with these details already exists. Please try different credentials."
INVALID_LOGIN = "Invalid username or password"
INVALID_REFRESH = "Invalid or expired refresh token"
USER_NOT_FOUND = "User not found"


class AuthError(Exception):
    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class TokenSettings:
    secret: str
    issuer: str = _DEFAULT_ISSUER
    audience: str = _DEFAULT_AUDIENCE
    access_minutes: int = 60
    refresh_days: int = 7
    grace_seconds: int = 60
    # JwtSettings.MaxFailedLoginAttempts / AccountLockoutMinutes defaults.
    max_failed_attempts: int = 5
    lockout_minutes: int = 15

    @classmethod
    def from_env(cls) -> "TokenSettings":
        try:
            settings = cls(
                secret=os.environ.get("JWT_SECRET_KEY", ""),
                issuer=os.environ.get("JWT_ISSUER", _DEFAULT_ISSUER),
                audience=os.environ.get("JWT_AUDIENCE", _DEFAULT_AUDIENCE),
                access_minutes=int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRATION_MINUTES", "60")),
                refresh_days=int(os.environ.get("JWT_REFRESH_TOKEN_EXPIRATION_DAYS", "7")),
                grace_seconds=int(os.environ.get("JWT_REFRESH_TOKEN_GRACE_WINDOW_SECONDS", "60")),
                max_failed_attempts=int(os.environ.get("JWT_MAX_FAILED_LOGIN_ATTEMPTS", "5")),
                lockout_minutes=int(os.environ.get("JWT_ACCOUNT_LOCKOUT_MINUTES", "15")),
            )
            if (
                len(settings.secret) < 32
                or not settings.issuer
                or not settings.audience
                or not 1 <= settings.access_minutes <= 525600
                or not 1 <= settings.refresh_days <= 3650
                or not 0 <= settings.grace_seconds <= 3600
                or not 1 <= settings.max_failed_attempts <= 100
                or not 1 <= settings.lockout_minutes <= 1440
            ):
                raise ValueError("Invalid auth configuration")
        except ValueError as exc:
            raise AuthError(503, "Authentication is not configured on the engine") from exc
        return settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def _future(value: datetime | None, now: datetime) -> bool:
    return value is not None and _utc(value) > now


def hash_refresh(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _password_bytes(password: str) -> bytes:
    # BCrypt.Net uses the first 72 UTF-8 bytes. bcrypt 5 raises instead of
    # truncating, so truncate explicitly for existing <=100-character passwords.
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt(rounds=12)).decode("ascii")


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return hash_password("dummy-timing-normalization")


def verify_password(password: str, stored_hash: str | None) -> bool:
    dummy = _dummy_hash()
    try:
        valid = bcrypt.checkpw(_password_bytes(password), (stored_hash or dummy).encode("ascii"))
        return bool(stored_hash) and valid
    except (ValueError, UnicodeError):
        # Malformed stored hashes fail like unknown users, with the same work.
        bcrypt.checkpw(_password_bytes(password), dummy.encode("ascii"))
        return False


def _user_info(user: dict) -> UserInfo:
    return UserInfo(
        id=str(user["_id"]),
        username=user.get("Username", ""),
        email=user.get("Email", ""),
        role=user.get("Role", "User"),
        display_name=user.get("DisplayName"),
        organization=user.get("Organization"),
        created_at=_utc(user.get("CreatedAt", utcnow())),
        last_login_at=_utc(user["LastLoginAt"]) if user.get("LastLoginAt") else None,
    )


def _lockout_status(user: dict, now: datetime) -> LockoutStatus:
    locked_until = user.get("LockedUntil")
    return LockoutStatus(
        user_id=str(user["_id"]),
        username=user.get("Username", ""),
        is_locked=_future(locked_until, now),
        failed_login_attempts=int(user.get("FailedLoginAttempts") or 0),
        locked_until=_utc(locked_until) if locked_until else None,
    )


class AuthService:
    def __init__(self, repository: UserRepository, settings: TokenSettings) -> None:
        self.repo = repository
        self.settings = settings

    def _tokens(self, user: dict, now: datetime) -> tuple[TokenResponse, dict]:
        expires = (now + timedelta(minutes=self.settings.access_minutes)).replace(microsecond=0)
        raw = base64.b64encode(secrets.token_bytes(64)).decode("ascii")
        access = jwt.encode(
            {
                "sub": str(user["_id"]),
                "unique_name": user.get("Username", ""),
                "email": user.get("Email", ""),
                _ROLE_CLAIMS[0]: user.get("Role", "User"),
                "jti": str(uuid4()),
                "iat": int(now.timestamp()),
                "exp": int(expires.timestamp()),
                "iss": self.settings.issuer,
                "aud": self.settings.audience,
            },
            self.settings.secret,
            algorithm=_ALGORITHM,
        )
        return TokenResponse(
            access_token=access, refresh_token=raw, expires_at=expires, user=_user_info(user)
        ), {
            "RefreshToken": hash_refresh(raw),
            "RefreshTokenExpiresAt": now + timedelta(days=self.settings.refresh_days),
            "PreviousRefreshToken": None,
            "PreviousRefreshTokenExpiresAt": None,
        }

    async def register(self, request: RegisterRequest) -> TokenResponse:
        if (
            await self.repo.by_username(request.username) is not None
            or await self.repo.by_email(request.email) is not None
        ):
            raise AuthError(400, DUPLICATE)
        await self.repo.ensure_indexes()
        password_hash = await run_in_threadpool(hash_password, request.password)
        now = utcnow()
        user = {
            "_id": ObjectId(),
            "Username": request.username,
            "Email": request.email.lower(),
            "PasswordHash": password_hash,
            "Role": "User",
            "CreatedAt": now,
            "LastLoginAt": None,
            "IsActive": True,
            "FailedLoginAttempts": 0,
            "LockedUntil": None,
            "DisplayName": request.display_name,
            "Organization": request.organization,
        }
        response, fields = self._tokens(user, now)
        user.update(fields)
        try:
            await self.repo.insert(user)
        except DuplicateKeyError as exc:
            raise AuthError(400, DUPLICATE) from exc
        return response

    async def login(self, request: LoginRequest) -> TokenResponse:
        user = await self.repo.by_username(request.username)
        if user is None and "@" in request.username:
            user = await self.repo.by_email(request.username)
        valid = await run_in_threadpool(
            verify_password, request.password, user.get("PasswordHash") if user else None
        )
        now = utcnow()
        if user is None or not user.get("IsActive", True):
            raise AuthError(401, INVALID_LOGIN)
        # Mirrors .NET AuthService.LoginAsync: an active lockout rejects without
        # counting; an expired one restarts the counter before this attempt.
        if _future(user.get("LockedUntil"), now):
            logger.warning("Login rejected for locked account %s", user["_id"])
            raise AuthError(401, INVALID_LOGIN)
        if user.get("LockedUntil") is not None:
            await self.repo.reset_lockout(user["_id"])
            user["FailedLoginAttempts"] = 0
            user["LockedUntil"] = None
        if not valid:
            attempts = await self.repo.record_failed_login(
                user,
                self.settings.max_failed_attempts,
                now + timedelta(minutes=self.settings.lockout_minutes),
            )
            if attempts >= self.settings.max_failed_attempts:
                logger.warning("Account %s locked after %d failed logins", user["_id"], attempts)
            raise AuthError(401, INVALID_LOGIN)
        user["LastLoginAt"] = now
        response, fields = self._tokens(user, now)
        fields["LastLoginAt"] = now
        if user.get("FailedLoginAttempts"):
            # Reset in the same conditional write that issues the tokens.
            fields.update(FailedLoginAttempts=0, LockedUntil=None)
        if not await self.repo.save_login(user, fields, utcnow()):
            raise AuthError(401, INVALID_LOGIN)
        return response

    async def refresh(self, raw: str) -> TokenResponse:
        incoming = hash_refresh(raw)
        # One loser can retry through the previous-token grace window. Bounded
        # retries never resurrect a hash revoked by login/logout/password change.
        for _ in range(2):
            now = utcnow()
            user = await self.repo.by_refresh(incoming, now)
            if (
                user is None
                or not user.get("IsActive", True)
                or _future(user.get("LockedUntil"), now)
            ):
                break
            previous = user.get("PreviousRefreshToken") == incoming and _future(
                user.get("PreviousRefreshTokenExpiresAt"), now
            )
            current = user.get("RefreshToken") == incoming and _future(
                user.get("RefreshTokenExpiresAt"), now
            )
            if not previous and not current:
                break
            response, fields = self._tokens(user, now)
            if not previous:
                fields.update(
                    PreviousRefreshToken=incoming,
                    PreviousRefreshTokenExpiresAt=now
                    + timedelta(seconds=self.settings.grace_seconds),
                )
            if await self.repo.rotate(user, incoming, fields, utcnow()):
                return response
        raise AuthError(401, INVALID_REFRESH)

    async def lockout_status(self, user_id: str) -> LockoutStatus:
        user = await self.repo.by_id(user_id)
        if user is None:
            raise AuthError(404, USER_NOT_FOUND)
        return _lockout_status(user, utcnow())

    async def unlock(self, user_id: str, admin_id: str) -> LockoutStatus:
        user = await self.repo.by_id(user_id)
        # Idempotent: unlocking an unlocked account is a successful no-op reset.
        if user is None or not await self.repo.reset_lockout(user["_id"]):
            raise AuthError(404, USER_NOT_FOUND)
        logger.info("Admin %s unlocked account %s", admin_id, user["_id"])
        user.update(FailedLoginAttempts=0, LockedUntil=None)
        return _lockout_status(user, utcnow())

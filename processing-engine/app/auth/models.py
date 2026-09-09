"""The camelCase .NET AuthModels contract, with explicit response allowlists."""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class AuthModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class LoginRequest(AuthModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=100)

    @field_validator("username", "password")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Field is required")
        return value


class RegisterRequest(LoginRequest):
    email: str = Field(max_length=255)
    display_name: str | None = Field(default=None, max_length=100)
    organization: str | None = Field(default=None, max_length=100)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        # Match .NET EmailAddressAttribute: exactly one @, neither end, no CR/LF.
        if (
            value.count("@") != 1
            or value.startswith("@")
            or value.endswith("@")
            or any(c in value for c in "\r\n")
        ):
            raise ValueError("Invalid email address")
        return value

    @field_validator("password")
    @classmethod
    def complex_password(cls, value: str) -> str:
        if not re.fullmatch(r"(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{8,}", value):
            raise ValueError(
                "Password must contain uppercase, lowercase, digit and special characters"
            )
        return value


class RefreshRequest(AuthModel):
    refresh_token: str = Field(min_length=1, max_length=1024)

    @field_validator("refresh_token")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Field is required")
        return value


class UserInfo(AuthModel):
    id: str
    username: str
    email: str
    role: str
    display_name: str | None = None
    organization: str | None = None
    created_at: datetime
    last_login_at: datetime | None = None


class TokenResponse(AuthModel):
    access_token: str
    refresh_token: str
    expires_at: datetime
    token_type: str = "Bearer"
    user: UserInfo

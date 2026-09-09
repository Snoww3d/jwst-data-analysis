"""Opt-in auth foundation. Production activation must wait for #1186 parity."""

import os

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pymongo.errors import PyMongoError

from app.auth.models import LoginRequest, RefreshRequest, RegisterRequest, TokenResponse
from app.auth.service import AuthError, AuthService, TokenSettings
from app.db.client import MongoNotConfiguredError, get_database
from app.db.users import MongoUserRepository


def require_auth_enabled() -> None:
    if os.environ.get("PYTHON_AUTH_ENABLED", "").lower() != "true":
        raise AuthError(503, "Python authentication is not enabled")


class AuthRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def sanitized(request: Request):
            try:
                # Check before parsing or resolving dependencies, including on
                # malformed requests. No auth work occurs without explicit opt-in.
                require_auth_enabled()
                response = await handler(request)
            except RequestValidationError:
                # FastAPI's default 422 includes input values (passwords/tokens).
                response = JSONResponse(
                    {"error": "Invalid authentication request"}, status_code=400
                )
            except AuthError as exc:
                response = JSONResponse({"error": exc.message}, status_code=exc.status)
            except (PyMongoError, MongoNotConfiguredError):
                response = JSONResponse(
                    {"error": "Authentication service unavailable"}, status_code=503
                )
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            return response

        return sanitized


def get_auth_service() -> AuthService:
    settings = TokenSettings.from_env()
    return AuthService(MongoUserRepository(get_database()["users"]), settings)


router = APIRouter(prefix="/api/auth", tags=["Auth"], route_class=AuthRoute)


@router.post("/register", status_code=201, response_model=TokenResponse)
async def register(request: RegisterRequest, service: AuthService = Depends(get_auth_service)):
    return await service.register(request)


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, service: AuthService = Depends(get_auth_service)):
    return await service.login(request)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: RefreshRequest, service: AuthService = Depends(get_auth_service)):
    return await service.refresh(request.refresh_token)

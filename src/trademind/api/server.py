"""Server entry point. Run: uvicorn trademind.api.server:create_app_from_env --factory
Create tables for development: python -m trademind.api.server (PostgreSQL uses migrations/002)."""

import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from trademind.accounts import AccountStore
from trademind.api.app import create_app
from trademind.api.main import app as market_app


def _engine_from_env() -> Engine:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("Set DATABASE_URL before starting the API")
    return create_engine(url, pool_pre_ping=True, hide_parameters=True)


def create_app_from_env() -> FastAPI:
    store = AccountStore(_engine_from_env())
    app = create_app(store, app=market_app)

    @app.middleware("http")
    async def require_auth_for_api(request: Request, call_next):
        if request.method != "OPTIONS" and request.url.path.startswith("/api/"):
            authorization = request.headers.get("Authorization", "")
            scheme, _, token = authorization.partition(" ")

            user = store.user_for_token(token) if scheme.lower() == "bearer" and token else None

            if user is None:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Not authenticated"},
                    headers={"WWW-Authenticate": "Bearer"},
                )

        return await call_next(request)

    return app


def init_database() -> None:
    AccountStore(_engine_from_env()).create_schema()


if __name__ == "__main__":
    init_database()
    print("Account tables are ready")

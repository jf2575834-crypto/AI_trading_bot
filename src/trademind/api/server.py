"""TradeMind API server entry point."""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
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

    return create_engine(
        url,
        pool_pre_ping=True,
        hide_parameters=True,
    )


def create_app_from_env() -> FastAPI:
    store = AccountStore(_engine_from_env())

    # Create a fresh application instead of reusing market_app.
    app = FastAPI(
        title="TradeMind Backend API",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )

    # Copy the existing market-data routes into the new application.
    # Include market-data routes, excluding the duplicate health endpoint.
    for route in market_app.router.routes:
        if getattr(route, "path", None) != "/health":
            app.router.routes.append(route)

    # Register authentication routes on the same application.
    create_app(store, app=app)

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

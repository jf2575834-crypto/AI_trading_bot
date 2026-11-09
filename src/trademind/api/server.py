"""Server entry point. Run: uvicorn trademind.api.server:create_app_from_env --factory
Create tables for development: python -m trademind.api.server (PostgreSQL uses migrations/002)."""

import os

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from trademind.accounts import AccountStore
from trademind.api.app import create_app


def _engine_from_env() -> Engine:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("Set DATABASE_URL before starting the API")
    return create_engine(url, pool_pre_ping=True, hide_parameters=True)


def create_app_from_env() -> FastAPI:
    return create_app(AccountStore(_engine_from_env()))


def init_database() -> None:
    AccountStore(_engine_from_env()).create_schema()


if __name__ == "__main__":
    init_database()
    print("Account tables are ready")

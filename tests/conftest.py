import os
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.schema import CreateSchema, DropSchema

from trademind.market_data.config import Settings
from trademind.market_data.storage import SQLCandleStore


@pytest.fixture
def settings():
    return Settings("test-key", "test-secret", max_retries=2, requests_per_minute=10000)


@pytest.fixture
def raw_bar():
    return {"t": "2026-10-01T14:30:00Z", "o": 100, "h": 102, "l": 99, "c": 101, "v": 500}


@pytest.fixture(params=["sqlite", pytest.param("postgresql", marks=pytest.mark.postgres)])
def store(request, tmp_path):
    if request.param == "sqlite":
        engine = create_engine(f"sqlite:///{tmp_path / 'candles.db'}")
        result = SQLCandleStore(engine)
        result.create_schema()
        yield result
        engine.dispose()
        return
    yield request.getfixturevalue("postgres_store")


@pytest.fixture
def postgres_store(monkeypatch):
    """! @brief Apply real team migrations in an isolated disposable PostgreSQL schema.
    @return Store using that schema; it is dropped after the test.
    """
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to exercise PostgreSQL persistence")
    from alembic import command
    from alembic.config import Config

    base_engine = create_engine(url, hide_parameters=True)
    schema = "test_market_data_" + uuid.uuid4().hex
    with base_engine.begin() as connection:
        connection.execute(CreateSchema(schema))
    scoped_url = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
    engine = create_engine(scoped_url, hide_parameters=True)
    try:
        monkeypatch.setenv("DATABASE_URL", scoped_url.render_as_string(hide_password=False))
        database = Path(__file__).resolve().parents[1] / "database"
        config = Config(str(database / "alembic.ini"))
        config.set_main_option("script_location", str(database / "migrations"))
        command.upgrade(config, "head")
        result = SQLCandleStore(engine)
        yield result
    finally:
        engine.dispose()
        with base_engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        base_engine.dispose()

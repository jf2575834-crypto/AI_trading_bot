import os
import uuid

import pytest
from sqlalchemy import create_engine
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
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to exercise PostgreSQL persistence")
    base_engine = create_engine(url, hide_parameters=True)
    schema = "test_market_data_" + uuid.uuid4().hex
    with base_engine.begin() as connection:
        connection.execute(CreateSchema(schema))
    engine = base_engine.execution_options(schema_translate_map={None: schema})
    try:
        result = SQLCandleStore(engine)
        result.create_schema()
        yield result
    finally:
        with base_engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        base_engine.dispose()

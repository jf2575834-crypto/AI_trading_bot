"""! @brief Verify ingestion against the team's actual PostgreSQL migrations."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from trademind.market_data.alpaca import AlpacaClient
from trademind.market_data.cli import main
from trademind.market_data.datasets import load_dataset
from trademind.market_data.models import Candle
from trademind.market_data.pipeline import IngestionPipeline
from trademind.market_data.shared_storage import assets, market_data

pytestmark = pytest.mark.postgres


def test_real_schema_correction_retains_uuid_and_asset(postgres_store, raw_bar):
    """! @brief Preserve row identities and asset metadata while accepting corrections."""
    store = postgres_store
    existing_id = uuid4()
    with store.engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO assets (id, symbol, company_name, exchange) "
                "VALUES (:id, 'AAPL', 'Apple Inc.', 'NASDAQ')"
            ),
            {"id": existing_id},
        )
    first = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    store.upsert([first])
    with store.engine.connect() as connection:
        before = connection.execute(select(market_data)).mappings().one()
        assert before["asset_id"] == existing_id
        assert before["timeframe"] == "1m"
        assert before["timestamp"].utcoffset() == timedelta(0)
    corrected = replace(first, close=Decimal("101.1234567890"), volume=Decimal("550.1234567890"))
    assert store.upsert([first, corrected]) == 1
    with store.engine.connect() as connection:
        after = connection.execute(select(market_data)).mappings().one()
        assert after["id"] == before["id"]
        assert after["ingested_at"] >= before["ingested_at"]
        assert after["close_price"] == corrected.close
        assert after["volume"] == corrected.volume
        assert connection.execute(text("SELECT company_name, exchange FROM assets")).one() == (
            "Apple Inc.",
            "NASDAQ",
        )
        assert "market_candles" not in inspect(connection).get_table_names()
    assert store.history(
        "AAPL", "1Min", first.timestamp, first.timestamp + timedelta(minutes=1)
    ) == (corrected,)
    with pytest.raises(ValueError, match="Alembic"):
        store.create_schema()


@pytest.mark.parametrize(
    "frame, stored",
    [
        ("1Min", "1m"),
        ("5Min", "5m"),
        ("15Min", "15m"),
        ("1Hour", "1h"),
        ("4Hour", "4h"),
        ("1Day", "1d"),
        ("1Week", "1w"),
    ],
)
def test_supported_intervals_round_trip(postgres_store, raw_bar, frame, stored):
    """! @brief Preserve each schema-supported duration and restore the provider interval."""
    candle = Candle.from_alpaca("MSFT", raw_bar, frame, "iex")
    postgres_store.upsert([candle])
    with postgres_store.engine.connect() as connection:
        assert connection.scalar(select(market_data.c.timeframe)) == stored
    assert postgres_store.history(
        "msft", frame, candle.timestamp, candle.timestamp + timedelta(days=8)
    ) == (candle,)


@pytest.mark.parametrize("frame", ["2Min", "2Hour", "1Month"])
def test_unsupported_intervals_create_no_assets(postgres_store, raw_bar, frame):
    """! @brief Reject unsupported durations before any asset or candle writes."""
    candle = Candle.from_alpaca("AAPL", raw_bar, frame, "iex")
    with pytest.raises(ValueError, match="Shared database supports"):
        postgres_store.upsert([candle])
    with postgres_store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(assets)) == 0


def test_concurrent_registration_keeps_one_asset_and_candle(postgres_store, raw_bar):
    """! @brief Concurrent ingestion of a new ticker remains idempotent."""
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda _: postgres_store.upsert([candle]), range(2))) == [1, 1]
    with postgres_store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(assets)) == 1
        assert connection.scalar(select(func.count()).select_from(market_data)) == 1
        asset = connection.execute(select(assets)).mappings().one()
        assert asset["asset_type"] == "stock" and asset["currency"] == "USD"


def test_invalid_batch_rolls_back_asset_registration(postgres_store, raw_bar):
    """! @brief A failed candle constraint leaves neither new candles nor new assets."""
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    invalid = replace(candle, symbol="MSFT")
    object.__setattr__(invalid, "volume", Decimal(-1))
    with pytest.raises(IntegrityError):
        postgres_store.upsert([candle, invalid])
    with postgres_store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(assets)) == 0
        assert connection.scalar(select(func.count()).select_from(market_data)) == 0


def test_reads_of_unknown_symbol_do_not_register_it(postgres_store, raw_bar):
    """! @brief An empty series lookup has no asset-creation side effects."""
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    assert postgres_store.latest_timestamp("AAPL", "iex") is None
    assert (
        postgres_store.history(
            "AAPL", "1Day", candle.timestamp, candle.timestamp + timedelta(days=1)
        )
        == ()
    )
    with postgres_store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(assets)) == 0


def test_existing_case_variant_is_reused_but_ambiguity_is_rejected(postgres_store, raw_bar):
    """! @brief Reuse a legacy lowercase symbol without merging ambiguous assets."""
    with postgres_store.engine.begin() as connection:
        connection.execute(text("INSERT INTO assets (symbol) VALUES ('aapl')"))
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    postgres_store.upsert([candle])
    assert postgres_store.latest_timestamp("AAPL", "iex") == candle.timestamp
    with postgres_store.engine.begin() as connection:
        assert connection.scalar(select(func.count()).select_from(assets)) == 1
        connection.execute(text("INSERT INTO assets (symbol) VALUES ('AAPL')"))
    with pytest.raises(ValueError, match="Multiple assets"):
        postgres_store.upsert([candle])
    with pytest.raises(ValueError, match="Multiple assets"):
        postgres_store.history(
            "AAPL", "1Min", candle.timestamp, candle.timestamp + timedelta(days=1)
        )


@pytest.mark.parametrize("kind, currency", [("crypto", "USD"), ("stock", "EUR")])
def test_incompatible_asset_metadata_is_not_overwritten(postgres_store, raw_bar, kind, currency):
    """! @brief Reject incompatible assets without changing their classification or currency."""
    with postgres_store.engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO assets (symbol, asset_type, currency) "
                "VALUES ('AAPL', :kind, :currency)"
            ),
            {"kind": kind, "currency": currency},
        )
    with pytest.raises(ValueError, match="USD stock or ETF"):
        postgres_store.upsert([Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")])
    with postgres_store.engine.connect() as connection:
        assert connection.execute(select(assets.c.asset_type, assets.c.currency)).one() == (
            kind,
            currency,
        )


def test_full_numeric_precision_round_trip(postgres_store, raw_bar):
    """! @brief Round-trip all 28 digits without converting prices or volume to floats."""
    value = Decimal("999999999999999999.1234567890")
    candle = replace(
        Candle.from_alpaca("AAPL", raw_bar, "1Day", "iex"),
        open=value,
        high=value,
        low=value,
        close=value,
        volume=value,
    )
    postgres_store.upsert([candle])
    assert postgres_store.history(
        "AAPL", "1Day", candle.timestamp, candle.timestamp + timedelta(days=1)
    ) == (candle,)


def test_paginated_pipeline_and_keyless_export_use_shared_schema(
    postgres_store, settings, raw_bar, monkeypatch, tmp_path, capsys
):
    """! @brief Fetch mocked provider history into the migrated schema and export without keys."""
    responses = iter(
        [
            {"bars": {"AAPL": [raw_bar]}, "next_page_token": "page2"},
            {"bars": {"MSFT": [raw_bar]}, "next_page_token": None},
        ]
    )
    with AlpacaClient(
        settings, transport=httpx.MockTransport(lambda _: httpx.Response(200, json=next(responses)))
    ) as client:
        first = Candle.from_alpaca("AAPL", raw_bar, "1Day", "iex")
        assert (
            IngestionPipeline(client, postgres_store).historical(
                ["AAPL", "MSFT"], "1Day", first.timestamp, first.timestamp + timedelta(days=1)
            )
            == 2
        )
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    path = tmp_path / "shared.json"
    monkeypatch.setattr(
        "sys.argv",
        [
            "trademind-data",
            "export",
            "--symbol",
            "AAPL",
            "--timeframe",
            "1Day",
            "--start",
            "2026-10-01T14:30:00Z",
            "--end",
            "2026-10-02T14:30:00Z",
            "--output",
            str(path),
        ],
    )
    assert main() == 0
    assert load_dataset(path).candles == (first,)
    capsys.readouterr()
    monkeypatch.setattr("sys.argv", ["trademind-data", "init-db"])
    assert main() == 1
    assert "Alembic" in capsys.readouterr().err

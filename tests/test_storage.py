from dataclasses import replace
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from trademind.market_data.models import Candle
from trademind.market_data.storage import KEY, market_candles


def test_upsert_duplicates_and_corrections(store, raw_bar):
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    corrected = replace(candle, close=Decimal("101.5"), volume=Decimal(550))
    assert store.upsert([candle, corrected]) == 1
    assert store.upsert([corrected]) == 1
    with store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(market_candles)) == 1
        assert connection.scalar(select(market_candles.c.close)) == Decimal("101.5")
    assert store.latest_timestamp("AAPL", "iex") == candle.timestamp
    assert store.latest_timestamp("AAPL", "sip") is None


def test_keeps_feeds_and_timeframes_separate(store, raw_bar):
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    assert (
        store.upsert([candle, replace(candle, feed="sip"), replace(candle, timeframe="1Day")]) == 3
    )
    with store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(market_candles)) == 3


def test_atomic_rollback_on_invalid_row(store, raw_bar):
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    # Simulate an invalid downstream write bypassing the normalization contract.
    bad = replace(candle, symbol="MSFT")
    object.__setattr__(bad, "volume", Decimal(-1))
    with pytest.raises(IntegrityError):
        store.upsert([candle, bad])
    with store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(market_candles)) == 0


def test_large_page_and_empty_batch(store, raw_bar):
    bars = [Candle.from_alpaca(f"S{i}", raw_bar, "1Min", "iex") for i in range(1000)]
    assert store.upsert(bars) == 1000
    assert store.upsert([]) == 0


def test_postgresql_conflict_statement_compiles():
    statement = insert(market_candles)
    sql = str(
        statement.on_conflict_do_update(
            index_elements=list(KEY),
            set_={"close": statement.excluded.close},
        ).compile(dialect=postgresql.dialect())
    )
    assert "ON CONFLICT" in sql and "DO UPDATE SET close = excluded.close" in sql

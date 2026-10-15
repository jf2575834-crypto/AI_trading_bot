"""Isolated market_candles table; the database owner can replace CandleStore."""

from collections.abc import Iterable
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Index,
    MetaData,
    Numeric,
    String,
    Table,
    create_engine,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine

from .models import Candle

metadata = MetaData()
KEY = ("provider", "feed", "adjustment", "currency", "symbol", "timeframe", "timestamp")
market_candles = Table(
    "market_candles",
    metadata,
    *(Column(name, String(32), primary_key=True) for name in KEY if name != "timestamp"),
    Column("timestamp", DateTime(timezone=True), primary_key=True),
    *(Column(name, Numeric(28, 10), nullable=False) for name in ("open", "high", "low", "close")),
    Column("volume", Numeric(28, 10), nullable=False),
    Column("ingested_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(
        "low >= 0 AND high >= low AND open >= low AND open <= high "
        "AND close >= low AND close <= high AND volume >= 0",
        name="ck_market_candles_ohlcv",
    ),
    Index("ix_market_candles_symbol_time", "symbol", "timeframe", "timestamp"),
)


class CandleStore(Protocol):
    def upsert(self, bars: Iterable[Candle]) -> int: ...
    def latest_timestamp(self, symbol: str, feed: str) -> datetime | None: ...


class SQLCandleStore:
    def __init__(self, engine: Engine):
        if engine.dialect.name not in {"postgresql", "sqlite"}:
            raise ValueError("Use PostgreSQL or SQLite for development")
        self.engine = engine

    @classmethod
    def from_url(cls, url: str) -> "SQLCandleStore":
        if not url:
            raise ValueError("Set DATABASE_URL before persisting market data")
        return cls(create_engine(url, pool_pre_ping=True, hide_parameters=True))

    def create_schema(self) -> None:
        """Explicit development bootstrap; never invoked automatically during ingestion."""
        metadata.create_all(self.engine)

    def upsert(self, bars: Iterable[Candle]) -> int:
        # Duplicate keys in a single PG INSERT must be folded before ON CONFLICT.
        rows = {}
        for candle in bars:
            values = asdict(candle)
            values["ingested_at"] = datetime.now(UTC)
            rows[tuple(values[k] for k in KEY)] = values
        if not rows:
            return 0
        insert = pg_insert if self.engine.dialect.name == "postgresql" else sqlite_insert
        # Executemany avoids SQLite's bind-parameter ceiling for large history pages.
        statement = insert(market_candles)
        statement = statement.on_conflict_do_update(
            index_elements=list(KEY),
            set_={
                name: statement.excluded[name]
                for name in (
                    "open",
                    "high",
                    "low",
                    "close",
                    "volume",
                    "ingested_at",
                )
            },
        )
        with self.engine.begin() as connection:
            connection.execute(statement, list(rows.values()))
        return len(rows)

    def latest_timestamp(self, symbol: str, feed: str) -> datetime | None:
        with self.engine.connect() as connection:
            value = connection.scalar(
                select(func.max(market_candles.c.timestamp)).where(
                    market_candles.c.symbol == symbol,
                    market_candles.c.provider == "alpaca",
                    market_candles.c.feed == feed,
                    market_candles.c.timeframe == "1Min",
                    market_candles.c.adjustment == "raw",
                    market_candles.c.currency == "USD",
                )
            )
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)

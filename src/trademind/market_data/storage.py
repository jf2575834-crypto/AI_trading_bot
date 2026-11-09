"""! @brief Use shared PostgreSQL storage or the original SQLite demo database."""

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
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine

from .models import Candle, symbols, timeframe, utc_datetime
from .shared_storage import SharedMarketDataStore

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
    """! @brief Persistence interface consumed by history ingestion and stream recovery."""

    def upsert(self, bars: Iterable[Candle]) -> int:
        """! @brief Store one page of candles and update any corrected identities.
        @param bars Normalized candles with explicit provenance and UTC timestamps.
        @return Number of distinct candle identities written.
        """
        ...

    def latest_timestamp(self, symbol: str, feed: str) -> datetime | None:
        """! @brief Find the newest stored minute candle for stream recovery.
        @param symbol Stock ticker.
        @param feed Alpaca feed, IEX or SIP.
        @return Latest UTC timestamp, or None when this series has no stored bars.
        """
        ...


class SQLCandleStore:
    """! @brief Select shared market_data for PostgreSQL and legacy market_candles for SQLite.
    PostgreSQL must already have the team's Alembic migrations applied.
    SQLite remains available for existing local demo databases and offline exports.
    """

    def __init__(self, engine: Engine):
        """! @brief Bind storage to an existing SQLAlchemy engine without connecting.
        @param engine PostgreSQL or SQLite engine; the caller disposes it after use.
        @exception ValueError For unsupported database dialects.
        """
        if engine.dialect.name not in {"postgresql", "sqlite"}:
            raise ValueError("Use PostgreSQL or SQLite for development")
        self.engine = engine
        backend = (
            SharedMarketDataStore if engine.dialect.name == "postgresql" else _SQLiteCandleStore
        )
        self._backend = backend(engine)

    @classmethod
    def from_url(cls, url: str) -> "SQLCandleStore":
        """! @brief Configure the shared or local demo store from DATABASE_URL.
        @param url SQLAlchemy connection URL, obtained from private environment settings.
        @return Store whose engine hides bound parameters in database errors.
        @exception ValueError If no URL is configured or its dialect is unsupported.
        """
        if not url:
            raise ValueError("Set DATABASE_URL before persisting market data")
        return cls(create_engine(url, pool_pre_ping=True, hide_parameters=True))

    def create_schema(self) -> None:
        """! @brief Explicitly create only the SQLite demo table.
        @exception ValueError For PostgreSQL, which must use database/Alembic migrations.
        """
        if self.engine.dialect.name == "postgresql":
            raise ValueError(
                "Shared PostgreSQL setup requires Alembic; follow database/README.md "
                "and run python -m alembic upgrade head from database/"
            )
        self._backend.create_schema()

    def upsert(self, bars: Iterable[Candle]) -> int:
        """! @brief Persist a page atomically, folding duplicate identities and corrections.
        @param bars Normalized raw USD candles with UTC timestamps and Decimal values.
        @return Number of distinct identities written, including corrected records.
        @exception ValueError If a candle cannot fit the selected storage contract.
        PostgreSQL also resolves or creates stock assets in the same transaction.
        """
        return self._backend.upsert(bars)

    def latest_timestamp(self, symbol: str, feed: str) -> datetime | None:
        """! @brief Read the latest Alpaca raw USD minute timestamp for recovery.
        @param symbol Stock ticker.
        @param feed Explicit Alpaca IEX or SIP feed.
        @return UTC-aware timestamp or None if no matching records exist.
        """
        return self._backend.latest_timestamp(symbol, feed)

    def history(
        self, symbol: str, frame: str, start: datetime, end: datetime, *, feed: str = "iex"
    ) -> tuple[Candle, ...]:
        """! @brief Read an ordered, inclusive range from one Alpaca raw USD series.
        @param symbol Stock ticker.
        @param frame Alpaca interval, such as 1Min or 1Day.
        @param start Inclusive timezone-aware range beginning.
        @param end Inclusive timezone-aware range end, after start.
        @param feed Explicit Alpaca IEX or SIP feed.
        @return Immutable UTC candles with Decimal prices and volume; empty if not found.
        @exception ValueError If the range or series cannot fit the storage contract.
        Reads never create assets or write candles.
        """
        return self._backend.history(symbol, frame, start, end, feed=feed)


class _SQLiteCandleStore:
    """! @brief Preserve the original SQLite demo schema and snapshot behavior."""

    def __init__(self, engine: Engine):
        """! @brief Bind the local SQLite demo database.
        @param engine Existing SQLite engine owned by the facade.
        """
        self.engine = engine

    def create_schema(self) -> None:
        """! @brief Explicitly bootstrap the local market_candles demo table."""
        metadata.create_all(self.engine)

    def upsert(self, bars: Iterable[Candle]) -> int:
        """! @brief Atomically write a local demo page, including corrected candles.
        @param bars Normalized candles with UTC timestamps and Decimal values.
        @return Number of distinct candle identities written.
        """
        rows = {}
        for candle in bars:
            values = asdict(candle)
            values["ingested_at"] = datetime.now(UTC)
            rows[tuple(values[k] for k in KEY)] = values
        if not rows:
            return 0
        # Executemany avoids SQLite's bind-parameter ceiling for large history pages.
        statement = sqlite_insert(market_candles)
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
        """! @brief Read the latest persisted local minute timestamp for recovery.
        @param symbol Stock ticker.
        @param feed Explicit Alpaca feed.
        @return UTC-aware timestamp or None if no matching candle exists.
        """
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

    def history(
        self, symbol: str, frame: str, start: datetime, end: datetime, *, feed: str = "iex"
    ) -> tuple[Candle, ...]:
        """! @brief Read one raw USD Alpaca series in ascending UTC timestamp order.
        @param symbol Stock ticker to retrieve.
        @param frame Candle interval, such as 1Min.
        @param start Inclusive, timezone-aware beginning of the requested range.
        @param end Inclusive, timezone-aware end of the requested range.
        @param feed Explicit feed; IEX and SIP records are never combined.
        @return Immutable candles; empty when no stored records match. No database writes.
        @exception ValueError If the symbol, timeframe, feed or range is invalid.
        """
        ticker, frame = symbols([symbol])[0], timeframe(frame)
        start, end = utc_datetime(start), utc_datetime(end)
        if end <= start or feed not in {"iex", "sip"}:
            raise ValueError("Use end after start and feed iex or sip")
        statement = (
            select(market_candles)
            .where(
                market_candles.c.symbol == ticker,
                market_candles.c.timeframe == frame,
                market_candles.c.timestamp >= start,
                market_candles.c.timestamp <= end,
                market_candles.c.provider == "alpaca",
                market_candles.c.feed == feed,
                market_candles.c.adjustment == "raw",
                market_candles.c.currency == "USD",
            )
            .order_by(market_candles.c.timestamp)
        )
        with self.engine.connect() as connection:
            result = []
            for row in connection.execute(statement).mappings():
                values = {
                    name: row[name] for name in market_candles.c.keys() if name != "ingested_at"
                }
                # SQLite drops tzinfo; this table's persistence contract is always UTC.
                if values["timestamp"].tzinfo is None:
                    values["timestamp"] = values["timestamp"].replace(tzinfo=UTC)
                result.append(Candle(**values))
        return tuple(result)

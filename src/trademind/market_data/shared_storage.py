"""! @brief Store stock candles in the team's Alembic-managed PostgreSQL schema."""

from collections.abc import Iterable
from dataclasses import asdict
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, MetaData, Numeric, String, Table, Uuid, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Connection, Engine

from .models import Candle, symbols, utc_datetime

# These are query interfaces, not schema definitions. Only database/Alembic creates tables.
metadata = MetaData()
assets = Table(
    "assets",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("symbol", String(20)),
    Column("asset_type", String(30)),
    Column("currency", String(3)),
)
KEY = ("asset_id", "provider", "feed", "adjustment", "currency", "timeframe", "timestamp")
market_data = Table(
    "market_data",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("asset_id", Uuid),
    Column("timestamp", DateTime(timezone=True)),
    Column("timeframe", String(10)),
    *(Column(name + "_price", Numeric(28, 10)) for name in ("open", "high", "low", "close")),
    Column("volume", Numeric(28, 10)),
    *(Column(name, String(32)) for name in ("provider", "feed", "adjustment", "currency")),
    Column("ingested_at", DateTime(timezone=True)),
)
TIMEFRAMES = {
    "1Min": "1m",
    "5Min": "5m",
    "15Min": "15m",
    "1Hour": "1h",
    "4Hour": "4h",
    "1Day": "1d",
    "1Week": "1w",
}


def shared_timeframe(frame: str) -> str:
    """! @brief Map an Alpaca interval without changing its duration.
    @param frame Provider interval, such as 1Day.
    @return Matching interval accepted by the shared database.
    @exception ValueError If the shared schema cannot represent the interval.
    """
    if frame not in TIMEFRAMES:
        raise ValueError("Shared database supports only " + ", ".join(TIMEFRAMES))
    return TIMEFRAMES[frame]


def _symbol(value: str) -> str:
    """! @brief Normalize a ticker and enforce the shared assets symbol limit.
    @param value Stock ticker supplied to a read or write.
    @return Uppercase ticker, at most 20 characters.
    @exception ValueError If the ticker cannot fit the shared assets table.
    """
    ticker = symbols([value])[0]
    if len(ticker) > 20:
        raise ValueError("Shared assets.symbol supports at most 20 characters")
    return ticker


class SharedMarketDataStore:
    """! @brief Read/write migrated PostgreSQL assets and market_data in UTC.
    Missing symbols are registered as stock/USD, using the shared defaults for
    other metadata. Register ETFs or other classifications before ingestion.
    Existing asset metadata is retained. This class never creates tables.
    """

    def __init__(self, engine: Engine):
        """! @brief Bind a migrated PostgreSQL database without opening a connection.
        @param engine SQLAlchemy PostgreSQL engine owned by the caller.
        @exception ValueError If the engine uses another database dialect.
        """
        if engine.dialect.name != "postgresql":
            raise ValueError("Shared market_data requires PostgreSQL")
        self.engine = engine

    def _find_assets(self, connection: Connection, tickers: set[str]) -> dict:
        """! @brief Resolve existing USD stock/ETF assets without changing metadata.
        @param connection Active database connection.
        @param tickers Normalized tickers to look up.
        @return Mapping from existing normalized ticker to asset UUID.
        @exception ValueError For ambiguous symbols or incompatible asset metadata.
        """
        query = select(assets).where(func.upper(assets.c.symbol).in_(sorted(tickers)))
        result = {}
        for row in connection.execute(query).mappings():
            ticker = row["symbol"].upper()
            if ticker in result:
                raise ValueError(f"Multiple assets match normalized symbol {ticker}")
            if row["currency"] != "USD" or row["asset_type"] not in {"stock", "etf"}:
                raise ValueError(f"Asset {ticker} is not a USD stock or ETF")
            result[ticker] = row["id"]
        return result

    def _assets(self, connection: Connection, tickers: set[str]) -> dict:
        """! @brief Atomically register any missing stock/USD symbols during a candle write.
        @param connection Transaction shared with the candle upsert.
        @param tickers Normalized tickers in the current batch.
        @return Mapping from ticker to its existing or newly generated asset UUID.
        @exception ValueError For ambiguous symbols or incompatible asset metadata.
        """
        result = self._find_assets(connection, tickers)
        missing = tickers - result.keys()
        if missing:
            # The symbol constraint arbitrates simultaneous writers; never replace asset metadata.
            statement = insert(assets).on_conflict_do_nothing(index_elements=["symbol"])
            connection.execute(
                statement,
                [
                    {"id": uuid4(), "symbol": ticker, "asset_type": "stock", "currency": "USD"}
                    for ticker in sorted(missing)
                ],
            )
            result = self._find_assets(connection, tickers)
        return result

    def upsert(self, bars: Iterable[Candle]) -> int:
        """! @brief Commit one page of candles and any new assets in one transaction.
        @param bars Raw USD stock candles with Decimal prices/volume and UTC-aware timestamps.
        @return Number of distinct candle identities written, including corrections.
        @exception ValueError For unsupported intervals, symbols or asset metadata.
        Database errors roll back both asset creation and all candle writes.
        Corrections update OHLCV/ingested_at and retain the existing candle UUID.
        """
        rows = {}
        for candle in bars:
            values = asdict(candle)
            values["symbol"] = _symbol(candle.symbol)
            values["timeframe"] = shared_timeframe(candle.timeframe)
            for name in ("open", "high", "low", "close"):
                values[name + "_price"] = values.pop(name)
            identity = tuple(values[name] for name in KEY if name != "asset_id")
            rows[(values["symbol"], *identity)] = values
        if not rows:
            return 0
        with self.engine.begin() as connection:
            ids = self._assets(connection, {row["symbol"] for row in rows.values()})
            now = datetime.now(UTC)
            records = [
                {**row, "asset_id": ids[row["symbol"]], "id": uuid4(), "ingested_at": now}
                for row in rows.values()
            ]
            for record in records:
                record.pop("symbol")
            statement = insert(market_data)
            statement = statement.on_conflict_do_update(
                index_elements=list(KEY),
                set_={
                    name: statement.excluded[name]
                    for name in (
                        "open_price",
                        "high_price",
                        "low_price",
                        "close_price",
                        "volume",
                        "ingested_at",
                    )
                },
            )
            connection.execute(statement, records)
        return len(rows)

    @staticmethod
    def _series(asset_id, frame: str, feed: str):
        """! @brief Build the common asset and provenance filters for stored reads.
        @param asset_id Resolved asset UUID.
        @param frame Shared database interval.
        @param feed Explicit Alpaca feed, IEX or SIP.
        @return SQL filters for one Alpaca raw USD series.
        """
        return (
            market_data.c.asset_id == asset_id,
            market_data.c.timeframe == frame,
            market_data.c.provider == "alpaca",
            market_data.c.feed == feed,
            market_data.c.adjustment == "raw",
            market_data.c.currency == "USD",
        )

    def latest_timestamp(self, symbol: str, feed: str) -> datetime | None:
        """! @brief Read the latest raw USD minute candle for stream recovery.
        @param symbol Stock ticker; absent symbols are not created by reads.
        @param feed Explicit Alpaca feed, IEX or SIP.
        @return UTC-aware timestamp, or None when the selected series is empty.
        @exception ValueError If the ticker or feed is invalid.
        """
        ticker = _symbol(symbol)
        if feed not in {"iex", "sip"}:
            raise ValueError("Use feed iex or sip")
        with self.engine.connect() as connection:
            asset_id = self._find_assets(connection, {ticker}).get(ticker)
            if asset_id is None:
                return None
            query = select(func.max(market_data.c.timestamp)).where(
                *self._series(asset_id, "1m", feed)
            )
            value = connection.scalar(query)
        return utc_datetime(value) if value is not None else None

    def history(
        self, symbol: str, frame: str, start: datetime, end: datetime, *, feed: str = "iex"
    ) -> tuple[Candle, ...]:
        """! @brief Read one stored series in ascending UTC order without database writes.
        @param symbol Stock ticker; absent symbols return an empty tuple.
        @param frame Alpaca interval; converted to the shared timeframe for querying.
        @param start Inclusive timezone-aware range beginning.
        @param end Inclusive timezone-aware range end, after start.
        @param feed Explicit Alpaca feed, IEX or SIP.
        @return Immutable candles with provider intervals and Decimal prices/volume.
        @exception ValueError If the symbol, interval, feed or range is invalid.
        """
        ticker, stored_frame = _symbol(symbol), shared_timeframe(frame)
        start, end = utc_datetime(start), utc_datetime(end)
        if end <= start or feed not in {"iex", "sip"}:
            raise ValueError("Use end after start and feed iex or sip")
        with self.engine.connect() as connection:
            asset_id = self._find_assets(connection, {ticker}).get(ticker)
            if asset_id is None:
                return ()
            query = (
                select(
                    market_data.c.timestamp,
                    *(
                        market_data.c[name + "_price"].label(name)
                        for name in ("open", "high", "low", "close")
                    ),
                    *(
                        market_data.c[name]
                        for name in ("volume", "provider", "feed", "adjustment", "currency")
                    ),
                )
                .where(
                    *self._series(asset_id, stored_frame, feed),
                    market_data.c.timestamp >= start,
                    market_data.c.timestamp <= end,
                )
                .order_by(market_data.c.timestamp)
            )
            return tuple(
                Candle(**dict(row), symbol=ticker, timeframe=frame)
                for row in connection.execute(query).mappings()
            )

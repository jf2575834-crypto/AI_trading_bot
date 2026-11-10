# KAN-6: Market data client and ingestion pipeline

This module retrieves historical, latest, and streamed US stock candles and persists
normalized records for TradeMind. It implements the market-data scope of
[KAN-6](https://bulldogs-team-wo34d7kp.atlassian.net/browse/KAN-6), including the
historical retrieval and live buffer described in TTBT-32 through TTBT-37.

## Provider decision

Initial implementation target: **Alpaca, IEX feed**. The table records an engineering
evaluation as of October 13, 2026; it is not a measured data-accuracy benchmark.

| Provider | Historical data and streaming | Limits and coverage | Decision |
| --- | --- | --- | --- |
| Alpaca | REST OHLCV and WebSocket minute bars with later bar corrections | Basic stock plan documents 200 historical calls/minute and 30 streamed symbols; live IEX is a single exchange, while SIP needs suitable entitlements | Selected for its native bar streams and one REST/live authentication model. Default throttle is 180 calls/minute. [Plan details](https://docs.alpaca.markets/us/docs/about-market-data-api), [feed coverage](https://docs.alpaca.markets/us/docs/market-data-faq). |
| Twelve Data | Historical time series and WebSocket price events | API and WebSocket credits depend on the plan; price events would require local OHLCV aggregation for this contract | Alternative if broader instrument coverage becomes necessary. [History](https://support.twelvedata.com/en/articles/5656039-how-to-get-historical-prices), [streaming](https://support.twelvedata.com/en/articles/5620516-how-to-stream-the-data), [credits](https://support.twelvedata.com/en/articles/5615854-credits). |

Feed choice affects both prices and volumes. Do not mix IEX with consolidated SIP
data in one strategy series. Availability, accuracy against a reference source,
and account entitlements still need validation with the team's account. The broker
execution provider remains a separate decision.

## Install and configure

Python 3.11 or later:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e '.[dev]'
```

Register an Alpaca developer/paper account and generate keys in its dashboard.
Enter those keys in your local environment or secret manager. The implementation
does not register accounts or create keys. `.env` files are ignored by Git; the CLI
reads environment variables directly and does not load a `.env` file automatically.

```powershell
$env:ALPACA_API_KEY = '<your key>'
$env:ALPACA_SECRET_KEY = '<your secret>'
$env:ALPACA_DATA_FEED = 'iex'
$env:DATABASE_URL = 'postgresql+psycopg://user:password@localhost:5432/trademind'
```

Optional settings: `MARKET_DATA_TIMEOUT=15`, `MARKET_DATA_MAX_RETRIES=5`, and
`MARKET_DATA_REQUESTS_PER_MINUTE=180`. REST uses key headers and HTTPS at
`https://data.alpaca.markets`; streaming authenticates over
`wss://stream.data.alpaca.markets/v2/iex` (or `/sip`). The endpoints are fixed to
Alpaca so environment settings cannot redirect credentials to another service.
Application errors omit credentials and provider response bodies.

## Run

For shared PostgreSQL, follow [database setup](../database/README.md) first and apply
the Alembic migrations. Set the ingestion process's `DATABASE_URL` to that same
database. The ingestion CLI does not automatically load `database/.env`.
PostgreSQL connections now write to `assets` and `market_data`:

```powershell
.venv/Scripts/trademind-data.exe history --symbols AAPL MSFT --timeframe 1Min --start 2026-10-01T00:00:00Z --end 2026-10-02T00:00:00Z
.venv/Scripts/trademind-data.exe latest --symbols AAPL MSFT
.venv/Scripts/trademind-data.exe stream --symbols AAPL MSFT
```

On Linux/macOS use `.venv/bin/trademind-data` instead. For a local demonstration
without PostgreSQL, set `DATABASE_URL=sqlite:///market-data.db` and explicitly run
`trademind-data init-db` to create the original `market_candles` demo table.
`init-db` rejects PostgreSQL connections and directs you to Alembic.
The `latest` command
prints JSON and does not need a database. History and streaming persist data; the
stream command also prints each persisted live event as a JSON line. Ctrl+C stops it.

Historical start/end timestamps must include a timezone and end must follow start.
Alpaca's boundaries are inclusive. Queries follow all pagination tokens, including
when a page is empty, and use bounded retries for transport failures, 429, and 5xx.
Authentication and other client errors stop immediately. History commits one page
at a time; if a later page fails, rerun the same range to safely resume. The printed
count includes upserted overlaps, rather than counting only new records.

## Normalized contract

Every historical/latest/live bar becomes an immutable `Candle`:

```json
{
  "symbol": "AAPL",
  "timestamp": "2026-10-01T14:30:00Z",
  "timeframe": "1Min",
  "open": "100",
  "high": "102",
  "low": "99",
  "close": "101",
  "volume": "500",
  "provider": "alpaca",
  "feed": "iex",
  "adjustment": "raw",
  "currency": "USD"
}
```

The timestamp identifies the bar's beginning, not its arrival time. Python values
use UTC-aware datetimes and Decimal numbers; JSON encodes numbers as decimal
strings to preserve precision. Invalid OHLC bounds, negative or nonfinite values,
missing fields, naive timestamps, and values outside NUMERIC(28,10) precision are
rejected before persistence. Only raw USD bars are supported in this version.
Historical symbol mapping is disabled (`asof=-`) for stable ticker identities.
Historical timeframes accept 1–59Min, 1–23Hour, 1Day, 1Week, and supported Month
intervals. Shared PostgreSQL storage accepts only `1Min`, `5Min`, `15Min`, `1Hour`,
`4Hour`, `1Day`, and `1Week`, matching the shared schema. Unsupported durations
raise an error before writing a batch; they are never relabelled. SQLite retains
the original provider intervals. Latest and streamed candles are always 1Min.

## Shared database storage (KAN-60 / KAN-31)

`SQLCandleStore` selects `SharedMarketDataStore` for PostgreSQL and the original
demo store for SQLite. PostgreSQL uses the existing migrations in `database/`;
ingestion never creates, replaces or migrates shared tables.

The writer resolves uppercase tickers through `assets.symbol` and writes the
asset UUID into `market_data.asset_id`. Missing symbols are registered as
`stock`/`USD` in the candle transaction, with a generated UUID and the shared
defaults for other fields. Company name and exchange remain unset when unknown.
Pre-register ETFs with their correct asset type. Existing USD stocks/ETFs are
reused without overwriting company name, exchange, active state or other metadata.
Non-USD or incompatible asset types, symbols longer than 20 characters, and
ambiguous case variants are rejected. Historical reads never create assets.

OHLC fields map to `open_price`, `high_price`, `low_price`, `close_price`. Prices
and volume remain Decimal/NUMERIC(28,10), and timestamps are UTC-aware. Intervals
map as follows: `1Min`/`5Min`/`15Min` to `1m`/`5m`/`15m`, `1Hour`/`4Hour` to
`1h`/`4h`, and `1Day`/`1Week` to `1d`/`1w`. Reads restore the original provider
interval so existing Candle and JSON consumers keep the same contract.

The conflict identity is
`(asset_id, provider, feed, adjustment, currency, timeframe, timestamp)`.
Each page is atomic, including new assets. Concurrent writers use the existing
unique symbol constraint to avoid registering duplicate canonical symbols.
Repeated candle keys within a page are folded before insertion. Corrections
update OHLCV and `ingested_at` while retaining the existing candle UUID.
Historical reads filter the resolved asset and the same provenance, interval,
and inclusive UTC range. Stream recovery selects only Alpaca/raw/USD/1m records
from the requested feed.

Existing SQLite data and snapshots are not automatically copied into PostgreSQL.
Re-ingest the selected range, or load a validated saved dataset and call
`SQLCandleStore.from_url(shared_url).upsert(dataset.candles)`; this requires no
Alpaca keys. Keep the shared URL in private environment configuration and dispose
the engine after use. The old `migrations/001_market_candles.sql` describes the
legacy standalone table and must not be applied to the shared database.

## Live consumers and recovery

```python
import asyncio
from datetime import timedelta
from trademind.market_data.alpaca import AlpacaClient, AlpacaStream
from trademind.market_data.config import Settings
from trademind.market_data.pipeline import IngestionPipeline, LiveBuffer
from trademind.market_data.storage import SQLCandleStore


async def example():
    settings = Settings.from_env()
    store = SQLCandleStore.from_url(settings.database_url)
    buffer = LiveBuffer(capacity=1000)
    with AlpacaClient(settings) as client:
        producer = asyncio.create_task(
            IngestionPipeline(client, store).stream(["AAPL"], AlpacaStream(settings), buffer)
        )
        try:
            candle = await buffer.next_for_decision(max_age=timedelta(minutes=2))
            # Pass candle to the strategy's market-data handler.
            print(candle.to_json())
            buffer.queue.task_done()
        finally:
            producer.cancel()
            await asyncio.gather(producer, return_exceptions=True)
            store.engine.dispose()
```

`LiveBuffer.latest` retains the latest timestamp per symbol, and `queue` dispatches
persisted bars using bounded backpressure. A consumer must continuously drain it.
Late corrected bars share the original timestamp; consumers must treat them as
updates to that candle and avoid producing duplicate trade decisions. Stored
history recovery is not replayed as fresh strategy signals.

For new live decisions, use `next_for_decision(max_age=...)` rather than reading
the raw queue. It checks age when a candle leaves the queue, so time spent waiting
counts toward the limit. It skips future timestamps, older/superseded candles,
and timestamps already returned for the same provider/feed/adjustment/currency/
symbol/timeframe series. When a correction is already queued before selection,
only its latest version is eligible. Later corrections remain saved but cannot
trigger a second decision for that timestamp on this buffer.

The caller must choose a positive age limit. The two-minute example is measured
from the minute bar's **start** timestamp, not its arrival or close time. Use one
decision consumer per buffer and call `queue.task_done()` after processing each
returned candle; skipped items are acknowledged internally. The method waits for
a new eligible candle if every queued candle is rejected and can be cancelled.
The CLI intentionally prints every persisted event from the raw queue, including
corrections; that output is a diagnostic feed, not a filtered decision feed.

This filter does not place orders, replay missed signals, or provide durable
decision deduplication across restarts. Strategies must reload history after gaps
and recheck freshness before submitting orders if computation takes time.

On connection or reconnect, the pipeline backfills from the persisted latest 1Min
timestamp with a one-minute overlap before dispatching live data. Seed history
first if the database has no bars. Stream authentication and subscription are
acknowledged before use; transient disconnects retry with bounded exponential
backoff. Invalid payloads, rejected subscriptions, and storage failures propagate.
Strategies must inspect timestamps for freshness and reload history after a gap.
Minute bars are aggregates rather than tick quotes; periods with no provider bars
are not synthesized. This module does not submit broker orders.

Protocol references: [historical bars](https://docs.alpaca.markets/us/reference/stockbars),
[latest bars](https://docs.alpaca.markets/us/reference/stocklatestbars-1),
[authentication](https://docs.alpaca.markets/us/docs/streaming-market-data), and
[bar/correction channels](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data).

## Verification and remaining acceptance work

```powershell
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/ruff.exe check .
.venv/Scripts/ruff.exe format --check .
```

Tests cover request pagination, rate limits, failed authorization, decimal/UTC
normalization, invalid data, transactional persistence, deduplication, corrected
bars, WebSocket reconnects, shutdown, buffer behavior, and recovery. A local
WebSocket server exercises a complete auth/subscription/bar exchange without an
Alpaca account. The same storage tests run against SQLite and, when
`TEST_DATABASE_URL` is set, PostgreSQL in isolated temporary schemas.

GitHub Actions supplies PostgreSQL 16 and runs every test plus lint/format checks.
Live provider acceptance still needs the team's Alpaca credentials and entitled
feed: ingest a known historical range, compare records to the chosen reference,
observe bars during market hours, and confirm reconnect recovery. The database
owner's review and the deployed backend/algorithm integration are still required.

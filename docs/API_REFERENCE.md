# TradeMind market-data API and code guide

This is the generated-code reference and a guide to how the market-data module
works. It documents the code contributed in [PR #2](https://github.com/jf2575834-crypto/AI_trading_bot/pull/2),
[PR #5](https://github.com/jf2575834-crypto/AI_trading_bot/pull/5), and
[PR #11](https://github.com/jf2575834-crypto/AI_trading_bot/pull/11). PR #3 changed
the README only, so it had no source code to annotate.

The module turns Alpaca historical bars and live minute bars into one validated
`Candle` format. It can save those candles to the team's PostgreSQL tables, the
SQLite demo table, or a versioned JSON snapshot. The snapshot loader lets a
strategy or FPGA benchmark replay the same historical prices without calling
Alpaca again.

## How the pieces fit together

```text
Alpaca REST history ─┐
                     ├─> Candle validation ─> Storage ─> history / JSON dataset
Alpaca live stream ──┘                         │
                                               └─> LiveBuffer queue ─> consumer
```

1. **Settings** (`config.py`) read Alpaca keys, feed choice, retry/rate limits,
   and an optional database URL from the environment. Credentials are hidden
   from the settings representation and are not written into candles.
2. **Provider clients** (`alpaca.py`) request historical pages over HTTPS or
   receive minute bars over the Alpaca WebSocket. History pagination and bounded
   retries happen here; provider payloads are converted into `Candle` objects.
3. **The candle model** (`models.py`) normalizes symbols, requires timezone-aware
   timestamps, converts prices and volume to `Decimal`, and rejects invalid OHLC
   ranges or values that exceed the database's numeric precision. Each candle
   records its symbol, interval, provider, feed, adjustment and currency.
4. **The pipeline** (`pipeline.py`) connects the provider, store and live
   consumer. Historical candles are stored a page at a time. For live bars, the
   pipeline stores each bar before publishing it to the bounded `LiveBuffer`.
   On a new connection or reconnect, it backfills from the latest stored minute
   with a one-minute overlap so corrected bars can update storage.
5. **Storage** (`storage.py`, `shared_storage.py`) selects the PostgreSQL adapter
   for PostgreSQL URLs and the original demo adapter for SQLite URLs. PostgreSQL
   maps ticker symbols through `assets`, writes OHLCV into `market_data`, and
   uses an upsert so a corrected bar updates its existing row. The adapter uses
   the team's migrations; it does not create or alter the shared schema.
6. **Offline datasets** (`datasets.py`) save a single chronological series as
   versioned JSON. Decimal values are strings, and a SHA-256 checksum detects
   file changes. Loading rechecks the checksum and candle series before returning
   them to a caller.
7. **The command line** (`cli.py`) exposes history, latest, stream, export and
   local SQLite initialization commands. `trademind-data --help` lists the
   options. `init-db` is only for the SQLite demo; PostgreSQL setup uses Alembic.

## Common data flows

### Download and store historical bars

The `history` command asks Alpaca for the requested ticker, interval and inclusive
UTC range. It follows every pagination token. Each page becomes normalized candles
and is upserted before the next page is fetched. If a later page fails, rerunning
the same request is safe: matching candle identities update existing records.
The command's count is the number of identities upserted, including overlaps and
corrections; it is not a count of newly inserted rows.

For application code, `IngestionPipeline.historical(...)` performs the same
fetch-and-store loop. It returns the store's combined upsert count. It does not
create trade signals or submit orders.

### Read stored history for an algorithm

`SQLCandleStore.history(symbol, frame, start, end, feed=...)` returns immutable
candles in timestamp order. Both range boundaries are inclusive. The requested
feed and interval are part of the query, so IEX and SIP data are not combined.
The PostgreSQL reader resolves an existing asset and never creates one during a
read. An unknown symbol returns an empty tuple.

```python
from datetime import UTC, datetime
from trademind.market_data.storage import SQLCandleStore

store = SQLCandleStore.from_url(database_url)
try:
    bars = store.history(
        "AAPL",
        "1Day",
        datetime(2026, 5, 1, tzinfo=UTC),
        datetime(2026, 11, 6, 23, 59, 59, tzinfo=UTC),
        feed="iex",
    )
    closes = tuple(bar.close for bar in bars)  # Decimal prices, oldest first
finally:
    store.engine.dispose()
```

The storage layer returns market data only. The algorithm owner decides how many
bars to require for warmup, how to calculate indicators, and how to interpret a
signal.

### Replay a fixed dataset without Alpaca or a database

`save_dataset(...)` writes an immutable JSON file and refuses to overwrite an
existing path. `load_dataset(...)` checks the format, checksum, requested range,
single-series identity, ascending timestamps and minimum candle count. This
provides a repeatable input for offline development; it does not calculate
BUY/SELL/HOLD signals or convert values to FPGA fixed-point representation.

```python
from trademind.market_data.datasets import load_dataset

dataset = load_dataset("data/local/aapl-iex-1day-2026-05-01-to-2026-11-06-v1.json", min_bars=51)
prices = dataset.closes  # Decimal values, oldest first
timestamps = tuple(c.timestamp for c in dataset.candles)  # UTC-aware
print(dataset.sha256)  # Identify this exact input in results
```

The minimum count is supplied by the caller. Fifty closes provide one 50-period
average; 51 provide two adjacent 50-period windows for comparing a crossover.
No bars are invented for weekends or other dates without provider data.

### Stream bars to a consumer

`IngestionPipeline.stream(...)` subscribes to minute bars. It writes a received
bar to storage before putting it on `LiveBuffer.queue`; a storage failure
therefore stops publication instead of sending an unsaved candle downstream.
Consumers should continuously drain the bounded queue. If it fills, publishing
waits for a consumer. `LiveBuffer.latest` separately keeps the newest candle for
each ticker. A corrected bar at the same timestamp is still queued, so consumers
should update that bar rather than treat it as a new time period.

For a new decision, call `await buffer.next_for_decision(max_age=...)` with a
positive `datetime.timedelta`. It filters at dequeue time, skipping stale or
future minute bars, superseded versions, and timestamps already returned in that
series. Age is measured from the candle's start timestamp. Use a single decision
consumer and acknowledge returned items with `buffer.queue.task_done()`. Raw queue
reads remain available for diagnostics/correction consumers; do not mix raw reads
with the decision consumer on the same buffer. Deduplication is per buffer lifetime,
and freshness must be checked again before orders if processing is delayed.

Recovery backfills missing history into storage but does not replay those old
bars as new live signals. After a gap, a strategy should reload the stored
history it needs. This module provides the data flow; the strategy and backend
must decide how to handle stale data and missed signals.

## Code navigation

Use the generated page's **Files** menu to see module-level descriptions and
their declarations, or **Classes** to find classes such as `Candle`,
`IngestionPipeline`, and `SQLCandleStore`. The Doxygen search box can find a
symbol by name. Each public class and function has a docstring describing its
purpose, arguments, return value and relevant errors or side effects.

| Module | What it does |
| --- | --- |
| `alpaca.py` | Alpaca REST requests, paging, latest bars and WebSocket stream |
| `config.py` | Environment settings and private API credentials |
| `models.py` | `Candle` contract, UTC, symbol, timeframe and decimal validation |
| `pipeline.py` | Historical ingestion, reconnect recovery and live queue delivery |
| `storage.py` | Storage interface, PostgreSQL/SQLite selection and SQLite demo store |
| `shared_storage.py` | Adapter for the team's existing `assets` and `market_data` schema |
| `datasets.py` | Versioned JSON snapshots, checksum validation and offline reads |
| `cli.py` | `trademind-data` command-line interface |

For installation, credentials, exact CLI commands, provider limitations, database
setup and test coverage, see the [market-data operating guide](https://github.com/jf2575834-crypto/AI_trading_bot/blob/main/docs/market-data.md).
For the daily AAPL/MSFT samples and backend/FPGA handoff, see the [prototype
market-data guide](https://github.com/jf2575834-crypto/AI_trading_bot/blob/main/docs/prototype-market-data.md).

## Open the generated HTML

Each push or pull request builds the HTML reference as a GitHub Actions artifact.
Open the repository's **Actions** tab, select the **Build API reference** run
for the branch or pull request, and download **TradeMind-API-Reference**. Unzip
it and open `html/index.html` in a browser. GitHub keeps workflow artifacts for
up to 90 days, subject to repository settings.

You can read this overview and the source comments in the repository any time.
To build the HTML locally, install Doxygen, create the output folder (`mkdir -p
build/doxygen` on macOS/Linux or `New-Item -ItemType Directory -Force build\doxygen`
in PowerShell), run `doxygen Doxyfile` from the repository root, and open
`build/doxygen/html/index.html`.

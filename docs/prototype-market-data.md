# Joel's prototype market-data handoff

Your assignment is to supply historical prices, repeatable strategy/FPGA test
datasets, and a Python interface the backend can call.

## Jira tracking and scope

This change contributes the market-data portion of these existing tasks:

- [KAN-31 - Normalize Market and Disclosure API Data](https://bulldogs-team-wo34d7kp.atlassian.net/browse/KAN-31):
  versioned historical dataset format, explicit provenance, and Python input types.
- [KAN-48 - Implement Reliable Market Data Ingestion and Validation](https://bulldogs-team-wo34d7kp.atlassian.net/browse/KAN-48):
  ordered single-series reads, dataset validation, and checksum verification.
- [KAN-57 - Document Cross-Component API and Data Contracts](https://bulldogs-team-wo34d7kp.atlassian.net/browse/KAN-57):
  the market-data handoff and outstanding integration decisions in this guide.

These are partial contributions. Disclosure normalization, operational monitoring,
the complete API contracts and the end-to-end demonstration remain outside this change.
CPU/FPGA benchmarking is tracked in
[KAN-38](https://bulldogs-team-wo34d7kp.atlassian.net/browse/KAN-38).
Shared database access is tracked in
[KAN-60](https://bulldogs-team-wo34d7kp.atlassian.net/browse/KAN-60), with migration
changes in [KAN-19](https://bulldogs-team-wo34d7kp.atlassian.net/browse/KAN-19).

## Verified local results

The existing Alpaca ingestion implementation is already merged into GitHub main.
Merged PR #5 added a stored-history reader,
offline JSON snapshot export, checksum verification and tests.

On November 8, 2026, a real authenticated Alpaca historical request retrieved
780 candles: 390 each for AAPL and MSFT, using IEX, raw USD prices and 1Min bars.
The requested and observed range is October 16, 2026, 13:30 through 19:59 UTC,
inclusive. Each symbol has one record at every minute in that range. This is a
fixed historical demonstration sample, not current prices or proof of accuracy
against a second source.

Files in this checkout:

| Dataset | Records | Content SHA-256 |
| --- | ---: | --- |
| `data/local/aapl-iex-1min-2026-10-16-v1.json` | 390 | `9155f73593d92d826375d5cdcc11014686d0e2cc7ee9446c32b280d46ee50fea` |
| `data/local/msft-iex-1min-2026-10-16-v1.json` | 390 | `9e18c9e81f2cd9f4462caf78f7e0fcc41c795f0da0ee5530124347d2d0ade0a1` |

Daily snapshots were also downloaded and verified on November 8 for the daily
20-period/50-period moving-average inputs described in KAN-8. Both cover May 1
through November 6, 2026, with 132 provider-reported daily candles each:

| Dataset | Records | Content SHA-256 |
| --- | ---: | --- |
| `data/local/aapl-iex-1day-2026-05-01-to-2026-11-06-v1.json` | 132 | `a0c10ea577bd07a76cb0390f50f75b4def85d56b0fc60c63c1892655a87deeca` |
| `data/local/msft-iex-1day-2026-05-01-to-2026-11-06-v1.json` | 132 | `be166aacfd4afe59a52342cfddeafb5435f360793a268fcc5c9e4bd98b0c4b80` |

Daily bars were fetched using the provider's `1Day` interval, not calculated from
the one-day minute samples. They retain the same Alpaca/IEX/raw/USD provenance.
The close is the close reported by that feed. These datasets do not establish
agreement with another feed or implement the trading strategy.

The source records are also stored in local SQLite database `demo_market_data.db`.
The database and downloaded datasets are ignored by Git. They are not included
when another member clones the repository. Share the selected snapshot through
the team's agreed channel after checking the provider's sharing terms, or have
each member retrieve data with their own access and compare dataset identifiers.
No credentials are included in the snapshots or this guide.

## Try the saved input now

Open a terminal in this TradeMind repository and run:

```powershell
.\.venv\Scripts\python.exe examples\read_demo_data.py
.\.venv\Scripts\python.exe examples\read_demo_data.py --timeframe 1Day
```

This loads both local snapshots without network access or API keys, validates
their contents, and prints their record counts, ranges and identifiers.
The default selects minute bars; `--timeframe 1Day` selects daily bars and checks
that each contains at least 51 observations. The verifier also checks that each
file's symbol, timeframe, provider and feed match the selected demonstration.

Xa-Quan can read the same prices in Python:

```python
from trademind.market_data.datasets import load_dataset

dataset = load_dataset("data/local/aapl-iex-1min-2026-10-16-v1.json", min_bars=100)
prices = dataset.closes  # tuple[Decimal, ...], oldest first, USD per share
timestamps = tuple(c.timestamp for c in dataset.candles)  # timezone-aware UTC
print(dataset.sha256)
# Pass prices into the trading algorithm's agreed input interface.
```

`100` is an example minimum sample count, not an agreed moving-average window.
The loader rejects insufficient records. It does not compute trading signals,
fill missing bars or silently convert prices to floats or FPGA fixed-point values.
Each candle also contains open, high, low, close, volume, symbol, timeframe,
provider, feed, adjustment and currency. JSON prices/volume are decimal strings;
the Python loader returns Decimal values.

## Daily inputs for 20-day and 50-day averages

Use the daily snapshot with a minimum of 51 candles:

```python
from trademind.market_data.datasets import load_dataset

dataset = load_dataset(
    "data/local/aapl-iex-1day-2026-05-01-to-2026-11-06-v1.json",
    min_bars=51,
)
prices = dataset.closes
timestamps = tuple(candle.timestamp for candle in dataset.candles)
```

Twenty and fifty refer to consecutive daily candle observations, not calendar
days. Fifty closes supply the first 50-period average; 51 supply two consecutive
50-period windows for a crossover comparison. Weekends and other dates without
provider bars are not filled with invented prices. Preserve the provider's UTC
timestamps; do not assume every daily bar starts at the same UTC hour across
daylight-saving changes. Values remain raw, unadjusted prices, so corporate-action
handling must be agreed with the strategy owner before selecting a final dataset.
The 132-bar samples allow warmup and later comparisons; no BUY/SELL/HOLD outputs
or CPU/FPGA equivalence have been verified yet.

To recreate the daily inputs, load the private environment configuration as
described below, initialize a development database and create `data/local`, then run:

```powershell
.\.venv\Scripts\trademind-data.exe history --symbols AAPL MSFT --timeframe 1Day --start 2026-05-01T00:00:00Z --end 2026-11-06T23:59:59Z
.\.venv\Scripts\trademind-data.exe export --symbol AAPL --feed iex --timeframe 1Day --start 2026-05-01T00:00:00Z --end 2026-11-06T23:59:59Z --min-bars 51 --output data/local/aapl-iex-1day-2026-05-01-to-2026-11-06-v1.json
.\.venv\Scripts\trademind-data.exe export --symbol MSFT --feed iex --timeframe 1Day --start 2026-05-01T00:00:00Z --end 2026-11-06T23:59:59Z --min-bars 51 --output data/local/msft-iex-1day-2026-05-01-to-2026-11-06-v1.json
```

Existing files remain protected from overwrite. The generic `history`/`export`
commands already support `1Day`; no provider API or database schema change is
required. Daily and minute bars are stored and queried as separate series.

## Retrieve another fixed range

Install the project as described in README.md, then load the environment variables
from your private local configuration as described in docs/market-data.md. Set
`DATABASE_URL` to your development database and create the output directory.
For PostgreSQL, first apply the migrations in [database/README.md](../database/README.md).
For a standalone SQLite demo only, run `trademind-data init-db` after setting its
SQLite URL. Do not use that command for PostgreSQL:

```powershell
New-Item -ItemType Directory -Force data/local | Out-Null
.\.venv\Scripts\trademind-data.exe history --symbols AAPL MSFT --timeframe 1Min --start 2026-10-16T13:30:00Z --end 2026-10-16T19:59:00Z
.\.venv\Scripts\trademind-data.exe export --symbol AAPL --feed iex --timeframe 1Min --start 2026-10-16T13:30:00Z --end 2026-10-16T19:59:00Z --min-bars 100 --output data/local/aapl-iex-1min-2026-10-16-v1.json
.\.venv\Scripts\trademind-data.exe export --symbol MSFT --feed iex --timeframe 1Min --start 2026-10-16T13:30:00Z --end 2026-10-16T19:59:00Z --min-bars 100 --output data/local/msft-iex-1min-2026-10-16-v1.json
```

The output directory must exist. Use a new filename: export never overwrites an
existing dataset. The export reads stored data and needs no provider credentials;
only `DATABASE_URL` is required when invoking `trademind-data export` directly.
Both time boundaries are inclusive, matching the
[Alpaca historical-bars contract](https://docs.alpaca.markets/us/reference/stockbars).
An empty result is an error rather than a successful empty export. A requested
range and minimum count do not prove all expected market sessions are present.

## Backend interface

The backend can read persisted history without fetching the provider again:

```python
import os
from datetime import datetime
from trademind.market_data.storage import SQLCandleStore

store = SQLCandleStore.from_url(os.environ["DATABASE_URL"])
try:
    bars = store.history(
        "AAPL",
        "1Min",
        datetime.fromisoformat("2026-10-16T13:30:00+00:00"),
        datetime.fromisoformat("2026-10-16T19:59:00+00:00"),
        feed="iex",
    )
    response = [bar.to_json() for bar in bars]
finally:
    store.engine.dispose()
```

The reader automatically uses shared `assets`/`market_data` for PostgreSQL and the
existing `market_candles` table for SQLite. It returns ascending, immutable candles
from one explicit feed. It does not create HTTP routes.
In a server, manage the engine at application lifetime rather than per request.
SQLite is for the local demonstration; PostgreSQL is the intended shared store.

## Integration decisions still needed

- With Xa-Quan: confirm the input type, close-price field, bar interval, selected
  assets, date range and sample count, including the warmup needed for his windows.
  The Decimal tuple above is available now; it is not yet confirmed as his interface.
- With Alejandro and Xa-Quan: agree numeric representation, scaling, overflow and
  rounding rules. Convert the same saved prices identically for both calculation
  paths. Record the dataset identifier and sample count in benchmark results.
  Load data before timing compute-only benchmarks; report transfers separately
  when measuring end-to-end performance.
- With the database owner: review the shared storage adapter under KAN-31/KAN-60.
  It targets the merged `market_data` schema using asset UUIDs, mapped OHLC columns
  and intervals, UTC-aware timestamps, NUMERIC(28,10), and the seven-field provenance
  identity. See [storage behavior](market-data.md#shared-database-storage-kan-60--kan-31).
  The adapter uses the existing migrations; it does not change shared schema or
  automatically transfer the local SQLite records or JSON snapshots.
- With the backend owner: connect the agreed reader/adapter to the API and verify
  a real algorithm run consumes it. PostgreSQL storage is exercised against the
  team's migrations in isolated test schemas; a deployed shared database, backend
  algorithm integration and FPGA execution are not established by those tests.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check src tests examples
.\.venv\Scripts\python.exe -m ruff format --check src tests examples
```

Tests cover series/range isolation, sorting, preserved snapshots after corrections,
checksum changes, invalid/undersized data, and offline export without API keys.
PostgreSQL cases skip unless a disposable `TEST_DATABASE_URL` is configured.

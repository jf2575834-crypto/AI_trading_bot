# TradeMind database setup

This guide sets up the shared PostgreSQL database using Alembic migrations.
Run commands from your own clone of TradeMindRepo. You do not need Alpaca keys
to create or inspect the database.

## 1. Install PostgreSQL and Python

Install Python 3.11 or later and PostgreSQL with its command-line tools (`psql`
and `pg_dump`). The project's CI configuration uses PostgreSQL 16.
Use the [official PostgreSQL downloads](https://www.postgresql.org/download/)
for Windows, macOS, or Linux and follow the installer instructions for your OS.
Start the PostgreSQL service. Record the administrator username, password and port
(normally 5432). Some macOS installations use your OS username rather than `postgres`.

Confirm installation:

```sh
python --version
psql --version
```

On macOS/Linux, use `python3` instead of `python` if needed. If `psql` is missing,
add your PostgreSQL installation's `bin` directory to PATH and reopen the terminal.

## 2. Create a local development database

Skip this step if you already have the correct database. Connect as your PostgreSQL
administrator (replace `postgres` if your administrator has another name):

```sh
psql -h localhost -U postgres -d postgres
```

Run these commands inside psql, one at a time:

```sql
CREATE ROLE trademind_app LOGIN;
\password trademind_app
CREATE DATABASE trademind OWNER trademind_app;
\q
```

The password prompt avoids placing your password in SQL command history. Keep it
for step 4. This local role owns the database so it can run migrations; deployed
application accounts may use different permissions.

If the role/database already exists, use the existing setup instead of recreating it.

## 3. Create the Python environment

From the repository root:

```sh
cd database
python -m venv .venv
```

Activate it on macOS/Linux:

```sh
source .venv/bin/activate
```

Or on Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, use `.\.venv\Scripts\python.exe` in place of
`python` for the commands below; activation is optional.

Install the database dependencies in this environment:

```sh
python -m pip install "SQLAlchemy>=2.0,<2.1" "psycopg[binary]>=3.2,<4" "alembic>=1.13,<2" "python-dotenv>=1,<2"
```

The repository's root package dependencies do not install all migration tools,
so this command explicitly includes Alembic and python-dotenv.

## 4. Configure the connection

Create `database/.env` from `database/.env.example`. While still in `database`:

```sh
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` in your text editor:

```dotenv
DATABASE_URL=postgresql+psycopg://trademind_app:YOUR_PASSWORD@localhost:5432/trademind
```

Use your actual password, host, port and database name. URL-encode special characters
in the password (for example, `@` becomes `%40`). The `postgresql+psycopg` prefix
selects the installed Psycopg 3 driver; see the
[SQLAlchemy driver documentation](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#module-sqlalchemy.dialects.postgresql.psycopg).

Alembic and `test_connection.py` load `.env` automatically. An already exported
`DATABASE_URL` takes precedence for those tools; check it if they connect to the wrong
database. `inspect_market_data.py` and `verify_migration.py` instead read the file
path you pass explicitly. Keep both settings consistent.

## 5. Check the connection

Still in `database`, run:

```sh
python test_connection.py
```

Expect `Connected to database: trademind`. On a fresh database it is normal to see
zero tables and `Orders portfolio_id column not found!` before migrations run.

## 6. Create or upgrade the schema

### New empty database

```sh
python -m alembic upgrade head
```

This runs the initial schema and subsequent migration. It creates shared tables,
including `assets` and `market_data`. It does not seed assets or download candles.
Do not run Joel's `trademind-data init-db` for shared database setup: its current
implementation creates the separate `market_candles` table.

### Existing database

Back up the database before changing it. For example, run the following from
`database`, using your actual host, role, and database name:

```sh
pg_dump -h localhost -U trademind_app -d trademind -Fc -f trademind_before_upgrade.dump
python -m alembic current
python -m alembic heads
```

For an existing schema with the initial revision applied, inspect it first:

```sh
python inspect_market_data.py .env
```

This tool is read-only. If the revision is `08aa74f8bd83`, review
[MIGRATION_NOTES.md](MIGRATION_NOTES.md) for the approved backfills and then run:

```sh
python -m alembic upgrade head
```

If populated timestamps are naive, the migration stops until the historical writer's
timezone convention is verified. If evidence establishes UTC, supply it explicitly:

```sh
python -m alembic -x legacy_timezone=UTC -x "legacy_timezone_evidence=Describe the verified historical writer here" upgrade head
```

Do not assume naive values are UTC based on the server timezone or Joel's current
writer. Already timezone-aware timestamps are preserved without reinterpretation.
If tables exist but Alembic has no recorded revision, ask the database owner to
reconcile the schema; do not blindly stamp it or rerun the initial migration.

## 7. Verify the result

```sh
python -m alembic current
python test_connection.py
python inspect_market_data.py .env
```

At the time this guide was written, the expected head is `b9d41e720c6a`.
If newer migrations are added, compare `current` with `heads` instead.
Check that `market_data` has:

- UUID primary key `id` and the existing `asset_id` foreign key to `assets.id`.
- OHLC columns `open_price`, `high_price`, `low_price`, `close_price` and `volume`
  using `NUMERIC(28,10)`.
- Required `provider`, `feed`, `adjustment`, `currency`, and timezone-aware `ingested_at`.
- Timezone-aware `timestamp`. The inspector's printed type label alone can say
  `TIMESTAMP`; verify explicitly in psql if needed:

```sql
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'market_data'
ORDER BY ordinal_position;
```

- Unique identity `(asset_id, provider, feed, adjustment, currency, timeframe, timestamp)`.
- Historical-read index `ix_market_data_asset_time` and price/volume/provenance checks.

For migration development, use a separate disposable development database:

```sh
python verify_migration.py .env
```

This runs upgrade/downgrade scenarios in temporary schemas and rolls them back.
It requires permission to create schemas. It is optional for teammates setting up
the application; it does not replace applying migrations in step 6.

## 8. Connect the market-data writer

The database is ready after step 7, but Joel's current writer needs adaptation:

- Target `market_data` and resolve candle symbols through `assets` to `asset_id`.
- Map `open/high/low/close` to the existing `*_price` columns.
- Use the seven-column unique identity above for upserts, updating prices, volume,
  and `ingested_at` while retaining the row's UUID.
- Supply real source metadata and UTC-aware timestamps on new writes.
- Translate provider intervals to the supported database values: `1m`, `5m`, `15m`,
  `1h`, `4h`, `1d`, `1w`. For example `1Min` must map to `1m`. Other intervals
  need an agreed schema change before storage; do not silently relabel them.
- Update historical/latest-timestamp reads to use the same asset and provenance filters.

See [Joel's module guide](../docs/market-data.md) for ingestion behavior; its separate-table
setup instructions describe his original implementation, not this shared schema.

## Troubleshooting

| Message | Action |
| --- | --- |
| Connection refused | Start PostgreSQL and check the host/port. |
| Password authentication failed | Check the role/password and URL encoding in `.env`. |
| No module named alembic, dotenv, or psycopg | Use the Python environment from step 3 and install its dependencies. |
| No module named psycopg2 | Change the URL prefix to `postgresql+psycopg://`. |
| Permission denied for schema public | Connect as the database owner or ask the administrator for the required migration permissions. |
| Lock timeout during migration | Pause ingestion/other transactions and retry when the database is idle. |
| Timezone evidence required | Verify the old writer's convention before supplying the migration options. |
| Blank/overlength source or missing currency | Resolve the flagged rows explicitly; the migration will not guess or truncate values. |
| Duplicate table during initial migration | Confirm the target database and reconcile existing tables with migration history. |

Downgrade is not a routine setup step. It can discard provenance metadata and is
blocked when the old schema cannot represent the data exactly. See the migration notes.

## Files to share

Commit migrations, this README, verification scripts, and the placeholder `.env.example`.
Keep `.env`, virtual environments, database dumps, and `market_data_before_*.json`
snapshots local. Check `git status` before committing; dumps and JSON snapshots may
need explicit ignore rules if generated inside the repository.

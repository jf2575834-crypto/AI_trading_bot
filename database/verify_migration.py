"""Exercise real PostgreSQL DDL in a temporary schema, rolling everything back."""
import importlib.util
import sys
import uuid
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from dotenv import dotenv_values
from sqlalchemy import create_engine, inspect, text


def load(name, filename):
    migration_path = Path(__file__).parent / "migrations/versions" / filename
    spec = importlib.util.spec_from_file_location(name, migration_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load("initial", "08aa74f8bd83_initial_trademind_schema.py")
change = load("provenance", "b9d41e720c6a_market_data_provenance.py")
url = dotenv_values(sys.argv[1])["DATABASE_URL"].replace(
    "postgresql://", "postgresql+psycopg://", 1
)
engine = create_engine(url, connect_args={"connect_timeout": 5})
with engine.connect() as conn:
    timestamp_type = inspect(conn).get_columns("market_data")[2]["type"]
    print("Existing timestamp timezone:", timestamp_type.timezone)
    conn.rollback()
    for aware in (False, True):
        tx = conn.begin()
        try:
            schema = "verify_market_" + uuid.uuid4().hex
            conn.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
            conn.exec_driver_sql(f'SET LOCAL search_path TO "{schema}", public')
            ops = Operations(MigrationContext.configure(conn))
            base.op = ops
            base.upgrade()
            if aware:
                conn.exec_driver_sql(
                    'ALTER TABLE market_data ALTER COLUMN "timestamp" TYPE timestamptz '
                    'USING "timestamp" AT TIME ZONE \'UTC\''
                )
            conn.exec_driver_sql("INSERT INTO assets (symbol) VALUES ('FIXTURE')")
            conn.exec_driver_sql(
                "INSERT INTO market_data "
                "(asset_id, timestamp, open_price, high_price, low_price, close_price, "
                "volume, data_source) "
                "SELECT id, '2026-10-12 20:00:00', 10, 12, 9, 11, 100, 'TEST_DATA' FROM assets"
            )
            before = conn.execute(text('SELECT id, asset_id, "timestamp" FROM market_data')).one()
            change.op = ops
            class Context:
                @staticmethod
                def is_offline_mode(): return False
                @staticmethod
                def get_x_argument(**kwargs): return arguments
            change.context = Context
            arguments = {}
            if not aware:
                try:
                    change.upgrade()
                except RuntimeError as exc:
                    assert "historical timestamp" in str(exc)
                else:
                    raise AssertionError("Missing timezone evidence accepted")
            arguments = {
                "legacy_timezone": "UTC",
                "legacy_timezone_evidence": "Synthetic fixture explicitly written in UTC",
            }
            change.upgrade()
            row = conn.execute(text("SELECT * FROM market_data")).mappings().one()
            assert row["id"] == before.id and row["asset_id"] == before.asset_id
            assert row["timestamp"].hour == (before.timestamp.hour if aware else 15)
            assert row["provider"] == "TEST_DATA" and row["feed"] == "legacy_unknown"
            assert row["currency"] == "USD" and row["ingested_at"].tzinfo
            assert inspect(conn).get_columns("market_data")[2]["type"].timezone
            assert inspect(conn).get_pk_constraint("market_data")["constrained_columns"] == ["id"]
            foreign_keys = inspect(conn).get_foreign_keys("market_data")
            assert foreign_keys[0]["options"]["ondelete"] == "CASCADE"
            # Upsert updates one existing identity.
            conn.exec_driver_sql(
                "INSERT INTO market_data "
                "(asset_id,timestamp,timeframe,provider,feed,adjustment,currency,ingested_at,"
                "open_price,high_price,low_price,close_price,volume) "
                "SELECT asset_id,timestamp,timeframe,provider,feed,adjustment,currency,"
                "now(),10,12,9,11,101 FROM market_data "
                "ON CONFLICT (asset_id,provider,feed,adjustment,currency,timeframe,timestamp) "
                "DO UPDATE SET volume=excluded.volume"
            )
            assert conn.execute(text("SELECT count(*) FROM market_data")).scalar() == 1
            conn.exec_driver_sql("UPDATE market_data SET volume=100.5")
            arguments = {"allow_provenance_loss": "yes"}
            try:
                change.downgrade()
            except RuntimeError as exc:
                assert "BIGINT" in str(exc)
            else:
                raise AssertionError("Lossy volume downgrade accepted")
            conn.exec_driver_sql("UPDATE market_data SET volume=100")
            change.downgrade()
            assert not inspect(conn).get_columns("market_data")[2]["type"].timezone
            assert conn.execute(text("SELECT id FROM market_data")).scalar() == before.id
            print(
                "PASS:",
                "aware" if aware else "naive",
                "upgrade, backfill, upsert, loss guard, downgrade, UUID/FK",
            )
        finally:
            tx.rollback()
engine.dispose()
print("All verification changes rolled back; existing tables untouched")

"""Add market-data provenance without replacing market_data.

Revision ID: b9d41e720c6a
Revises: 08aa74f8bd83

Online PostgreSQL migration. For populated naive timestamps, supply
``-x legacy_timezone=UTC -x legacy_timezone_evidence='verified writer ...'``
only after checking the historical writer. Other verified PostgreSQL timezone
names are supported. Unknown feed/adjustment are deliberately labelled legacy_unknown.
"""

import sqlalchemy as sa
from alembic import context, op

revision = "b9d41e720c6a"
down_revision = "08aa74f8bd83"
branch_labels = depends_on = None

KEY = ["asset_id", "provider", "feed", "adjustment", "currency", "timeframe", "timestamp"]
PRICES = ["open_price", "high_price", "low_price", "close_price"]
OLD_PRICES = (
    "open_price > 0 AND high_price > 0 AND low_price > 0 AND close_price > 0 "
    "AND high_price >= low_price AND high_price >= GREATEST(open_price, close_price) "
    "AND low_price <= LEAST(open_price, close_price)"
)


def connection():
    if context.is_offline_mode():
        raise RuntimeError("Run online: data and timezone checks are required")
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        raise RuntimeError("This migration requires PostgreSQL")
    # Stop concurrent ingestion from invalidating preflight/backfill checks.
    conn.exec_driver_sql("SET LOCAL lock_timeout = '10s'")
    conn.exec_driver_sql("LOCK TABLE assets IN SHARE MODE")
    conn.exec_driver_sql("LOCK TABLE market_data IN ACCESS EXCLUSIVE MODE")
    return conn


def reject(conn, query, message):
    if conn.execute(sa.text(query)).scalar():
        raise RuntimeError(message)


def upgrade():
    conn = connection()
    cols = {c["name"]: c for c in sa.inspect(conn).get_columns("market_data")}
    naive = not cols["timestamp"]["type"].timezone
    populated = conn.execute(sa.text("SELECT EXISTS (SELECT 1 FROM market_data)")).scalar()
    args = context.get_x_argument(as_dictionary=True)
    zone = args.get("legacy_timezone")
    if naive and populated and (not zone or not args.get("legacy_timezone_evidence", "").strip()):
        raise RuntimeError(
            "Verify historical timestamp convention; supply "
            "legacy_timezone and legacy_timezone_evidence"
        )
    if naive:
        # UTC is irrelevant for an empty table; never infer it for existing rows.
        zone = zone or "UTC"
        timezone_exists = conn.execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :z)"),
            {"z": zone},
        ).scalar()
        if not timezone_exists:
            raise RuntimeError("legacy_timezone must be a PostgreSQL timezone name")
    reject(
        conn,
        "SELECT EXISTS (SELECT 1 FROM market_data WHERE data_source IS NOT NULL "
        "AND (length(data_source) > 32 OR btrim(data_source) = ''))",
        "Resolve blank or overlength data_source values explicitly; provider will not be truncated",
    )
    reject(
        conn,
        "SELECT EXISTS (SELECT 1 FROM market_data m LEFT JOIN assets a ON a.id=m.asset_id "
        "WHERE a.currency IS NULL OR btrim(a.currency) = '' OR length(a.currency)>32)",
        "Every legacy candle requires an asset with a valid currency",
    )
    for name in ("provider", "feed", "adjustment", "currency"):
        op.add_column("market_data", sa.Column(name, sa.String(32), nullable=True))
    op.add_column(
        "market_data",
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Use migration time, not unverified naive created_at, as the observed ingestion time.
    conn.execute(
        sa.text("""UPDATE market_data m SET
        provider = COALESCE(m.data_source, 'legacy_unknown'),
        feed = 'legacy_unknown', adjustment = 'legacy_unknown',
        currency = a.currency, ingested_at = transaction_timestamp()
        FROM assets a WHERE a.id = m.asset_id""")
    )
    for name in ("provider", "feed", "adjustment", "currency", "ingested_at"):
        op.alter_column("market_data", name, nullable=False)
    for name in PRICES + ["volume"]:
        op.alter_column(
            "market_data",
            name,
            type_=sa.Numeric(28, 10),
            postgresql_using=f'"{name}"::numeric(28,10)',
        )
    if naive:
        # PostgreSQL utility statements require a safely quoted SQL literal.
        literal = str(
            sa.literal(zone).compile(
                dialect=conn.dialect,
                compile_kwargs={"literal_binds": True},
            )
        )
        conn.exec_driver_sql(
            'ALTER TABLE market_data ALTER COLUMN "timestamp" TYPE timestamptz '
            'USING "timestamp" AT TIME ZONE ' + literal
        )
    op.drop_constraint("uq_market_data_asset_timeframe", "market_data", type_="unique")
    op.create_unique_constraint("uq_market_data_provenance", "market_data", KEY)
    op.drop_constraint("chk_market_data_prices", "market_data", type_="check")
    op.create_check_constraint(
        "chk_market_data_prices",
        "market_data",
        "low_price >= 0 AND high_price >= low_price AND open_price >= low_price "
        "AND open_price <= high_price AND close_price >= low_price AND close_price <= high_price "
        "AND high_price < 'Infinity'::numeric",
    )
    op.drop_constraint("chk_market_data_volume", "market_data", type_="check")
    op.create_check_constraint(
        "chk_market_data_volume",
        "market_data",
        "volume >= 0 AND volume < 'Infinity'::numeric",
    )
    op.create_check_constraint(
        "chk_market_data_provenance",
        "market_data",
        " AND ".join(f"btrim({n}) <> ''" for n in ("provider", "feed", "adjustment", "currency")),
    )
    op.create_index(
        "ix_market_data_asset_time",
        "market_data",
        ["asset_id", "timeframe", "timestamp"],
    )


def downgrade():
    conn = connection()
    reject(
        conn,
        "SELECT EXISTS (SELECT 1 FROM market_data "
        "GROUP BY asset_id, timestamp, timeframe HAVING count(*) > 1)",
        "Downgrade blocked: multiple provenances collide under the old unique key",
    )
    reject(
        conn,
        "SELECT EXISTS (SELECT 1 FROM market_data WHERE "
        + " OR ".join(f"{n} <= 0 OR {n} >= 1000000000 OR {n} <> round({n}, 6)" for n in PRICES)
        + ")",
        "Downgrade blocked: prices cannot be represented exactly as positive NUMERIC(15,6)",
    )
    reject(
        conn,
        "SELECT EXISTS (SELECT 1 FROM market_data "
        "WHERE volume <> trunc(volume) OR volume > 9223372036854775807)",
        "Downgrade blocked: volume cannot be represented exactly as BIGINT",
    )
    if context.get_x_argument(as_dictionary=True).get("allow_provenance_loss") != "yes":
        raise RuntimeError(
            "Downgrade discards provenance/ingestion metadata; explicitly pass "
            "-x allow_provenance_loss=yes after backup"
        )
    op.drop_index("ix_market_data_asset_time", table_name="market_data")
    op.drop_constraint("uq_market_data_provenance", "market_data", type_="unique")
    for name in ("chk_market_data_prices", "chk_market_data_volume", "chk_market_data_provenance"):
        op.drop_constraint(name, "market_data", type_="check")
    for name in PRICES:
        op.alter_column(
            "market_data",
            name,
            type_=sa.Numeric(15, 6),
            postgresql_using=f'"{name}"::numeric(15,6)',
        )
    op.alter_column(
        "market_data",
        "volume",
        type_=sa.BigInteger(),
        postgresql_using="volume::bigint",
    )
    # The old schema has no timezone; downgrade explicitly emits UTC wall times.
    op.alter_column(
        "market_data",
        "timestamp",
        type_=sa.DateTime(),
        postgresql_using="\"timestamp\" AT TIME ZONE 'UTC'",
    )
    op.create_unique_constraint(
        "uq_market_data_asset_timeframe",
        "market_data",
        ["asset_id", "timestamp", "timeframe"],
    )
    op.create_check_constraint("chk_market_data_prices", "market_data", OLD_PRICES)
    op.create_check_constraint("chk_market_data_volume", "market_data", "volume >= 0")
    for name in ("provider", "feed", "adjustment", "currency", "ingested_at"):
        op.drop_column("market_data", name)

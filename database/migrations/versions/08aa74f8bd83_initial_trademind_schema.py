"""initial_trademind_schema

Revision ID: 08aa74f8bd83
Revises:
Create Date: 2026-10-20 11:18:57.661041

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "08aa74f8bd83"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:

    # -----------------------------------
    # USERS TABLE
    # -----------------------------------
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("username", sa.String(50), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "account_status", sa.String(20), nullable=False, server_default="active"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "account_status IN ('active', 'suspended', 'closed')",
            name="chk_users_account_status",
        ),
        sa.PrimaryKeyConstraint("id", name="users_pkey"),
        sa.UniqueConstraint("username", name="users_username_key"),
        sa.UniqueConstraint("email", name="users_email_key"),
    )

    # -----------------------------------
    # ASSETS TABLE
    # -----------------------------------
    op.create_table(
        "assets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("company_name", sa.String(255), nullable=True),
        sa.Column("asset_type", sa.String(30), nullable=False, server_default="stock"),
        sa.Column("exchange", sa.String(50), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "asset_type IN ('stock', 'etf', 'option', 'crypto', 'other')",
            name="chk_assets_type",
        ),
        sa.PrimaryKeyConstraint("id", name="assets_pkey"),
        sa.UniqueConstraint("symbol", name="assets_symbol_key"),
    )

    # -----------------------------------
    # USER PREFERENCES TABLE
    # -----------------------------------
    op.create_table(
        "user_preferences",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("max_position_size", sa.Numeric(15, 2)),
        sa.Column("max_portfolio_exposure", sa.Numeric(15, 2)),
        sa.Column("default_stop_loss_pct", sa.Numeric(5, 2)),
        sa.Column(
            "paper_trading",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "auto_execute",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "trade_approval_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="user_preferences_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("user_id", name="user_preferences_user_id_key"),
        sa.CheckConstraint(
            "max_position_size IS NULL OR max_position_size > 0",
            name="chk_preferences_position_size",
        ),
        sa.CheckConstraint(
            "max_portfolio_exposure IS NULL OR max_portfolio_exposure > 0",
            name="chk_preferences_portfolio_exposure",
        ),
        sa.CheckConstraint(
            "default_stop_loss_pct IS NULL OR "
            "(default_stop_loss_pct > 0 AND default_stop_loss_pct <= 100)",
            name="chk_preferences_stop_loss",
        ),
        sa.PrimaryKeyConstraint("id", name="user_preferences_pkey"),
    )

    # -----------------------------------
    # PORTFOLIOS TABLE
    # -----------------------------------
    op.create_table(
        "portfolios",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "portfolio_type", sa.String(20), nullable=False, server_default="paper"
        ),
        sa.Column(
            "initial_balance",
            sa.Numeric(18, 2),
            nullable=False,
            server_default=sa.text("100000.00"),
        ),
        sa.Column(
            "cash_balance",
            sa.Numeric(18, 2),
            nullable=False,
            server_default=sa.text("100000.00"),
        ),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="portfolios_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("user_id", "name", name="uq_user_portfolio_name"),
        sa.UniqueConstraint("id", "user_id", name="uq_portfolios_id_user"),
        sa.CheckConstraint(
            "portfolio_type IN ('paper', 'live')", name="chk_portfolio_type"
        ),
        sa.CheckConstraint("initial_balance >= 0", name="chk_initial_balance"),
        sa.CheckConstraint("cash_balance >= 0", name="chk_cash_balance"),
        sa.PrimaryKeyConstraint("id", name="portfolios_pkey"),
    )

    # -----------------------------------
    # STRATEGIES TABLE
    # -----------------------------------
    op.create_table(
        "strategies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("strategy_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="inactive"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="strategies_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("user_id", "name", name="uq_strategies_user_name"),
        sa.CheckConstraint(
            "strategy_type IN ('technical', 'disclosure', 'hybrid')",
            name="chk_strategies_type",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'inactive', 'testing', 'archived')",
            name="chk_strategies_status",
        ),
        sa.PrimaryKeyConstraint("id", name="strategies_pkey"),
    )

    # -----------------------------------
    # STRATEGY CONFIGURATIONS
    # -----------------------------------
    op.create_table(
        "strategy_configurations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("strategy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parameter_name", sa.String(100), nullable=False),
        sa.Column("parameter_value", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["strategy_id"],
            ["strategies.id"],
            name="strategy_configurations_strategy_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "strategy_id", "parameter_name", name="uq_strategy_parameter"
        ),
        sa.PrimaryKeyConstraint("id", name="strategy_configurations_pkey"),
    )

    # -----------------------------------
    # POSITIONS
    # -----------------------------------
    op.create_table(
        "positions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("portfolio_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "quantity", sa.Numeric(20, 8), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "average_entry_price",
            sa.Numeric(15, 6),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "realized_profit_loss",
            sa.Numeric(18, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["portfolio_id"],
            ["portfolios.id"],
            name="positions_portfolio_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["assets.id"],
            name="positions_asset_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("portfolio_id", "asset_id", name="uq_portfolio_asset"),
        sa.CheckConstraint("quantity >= 0", name="chk_position_quantity"),
        sa.CheckConstraint("average_entry_price >= 0", name="chk_average_entry_price"),
        sa.PrimaryKeyConstraint("id", name="positions_pkey"),
    )

    # -----------------------------------
    # PORTFOLIO SNAPSHOTS
    # -----------------------------------
    op.create_table(
        "portfolio_snapshots",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("portfolio_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cash_balance", sa.Numeric(18, 2), nullable=False),
        sa.Column("holdings_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("total_portfolio_value", sa.Numeric(18, 2), nullable=False),
        sa.Column(
            "unrealized_profit_loss",
            sa.Numeric(18, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "realized_profit_loss",
            sa.Numeric(18, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "recorded_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["portfolio_id"],
            ["portfolios.id"],
            name="portfolio_snapshots_portfolio_id_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("cash_balance >= 0", name="chk_snapshot_cash"),
        sa.CheckConstraint("holdings_value >= 0", name="chk_snapshot_holdings"),
        sa.CheckConstraint("total_portfolio_value >= 0", name="chk_snapshot_total"),
        sa.PrimaryKeyConstraint("id", name="portfolio_snapshots_pkey"),
    )

    # -----------------------------------
    # TRADE DECISIONS
    # -----------------------------------
    op.create_table(
        "trade_decisions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("strategy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decision_type", sa.String(10), nullable=False),
        sa.Column("confidence_score", sa.Numeric(5, 2)),
        sa.Column("reference_price", sa.Numeric(15, 6)),
        sa.Column("reasoning", sa.Text(), nullable=False),
        sa.Column(
            "risk_check_passed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("risk_check_details", postgresql.JSONB()),
        sa.Column(
            "approval_status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="trade_decisions_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["strategy_id"],
            ["strategies.id"],
            name="trade_decisions_strategy_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["assets.id"],
            name="trade_decisions_asset_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "decision_type IN ('buy', 'sell', 'hold')", name="chk_trade_decision_type"
        ),
        sa.CheckConstraint(
            "confidence_score IS NULL OR "
            "(confidence_score >= 0 AND confidence_score <= 100)",
            name="chk_trade_confidence",
        ),
        sa.CheckConstraint(
            "reference_price IS NULL OR reference_price >= 0",
            name="chk_trade_reference_price",
        ),
        sa.CheckConstraint(
            "approval_status IN "
            "('pending', 'approved', 'rejected', 'auto_approved')",
            name="chk_trade_approval_status",
        ),
        sa.PrimaryKeyConstraint("id", name="trade_decisions_pkey"),
    )

    # -----------------------------------
    # ORDERS
    # -----------------------------------
    op.create_table(
        "orders",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trade_decision_id", postgresql.UUID(as_uuid=True)),
        sa.Column("broker_order_id", sa.String(100)),
        sa.Column("order_type", sa.String(20), nullable=False),
        sa.Column("side", sa.String(10), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 8), nullable=False),
        sa.Column("limit_price", sa.Numeric(15, 6)),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "is_paper_trade",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("submitted_at", sa.DateTime()),
        sa.Column("filled_at", sa.DateTime()),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("portfolio_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="orders_user_id_fkey", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["assets.id"],
            name="orders_asset_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["trade_decision_id"],
            ["trade_decisions.id"],
            name="orders_trade_decision_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["portfolio_id"],
            ["portfolios.id"],
            name="fk_orders_portfolio",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["portfolio_id", "user_id"],
            ["portfolios.id", "portfolios.user_id"],
            name="fk_orders_portfolio_owner",
        ),
        sa.UniqueConstraint("broker_order_id", name="uq_order_broker_id"),
        sa.CheckConstraint(
            "order_type IN ('market', 'limit', 'stop', 'stop_limit')",
            name="chk_order_type",
        ),
        sa.CheckConstraint("side IN ('buy', 'sell')", name="chk_order_side"),
        sa.CheckConstraint("quantity > 0", name="chk_order_quantity"),
        sa.CheckConstraint(
            "limit_price IS NULL OR limit_price > 0", name="chk_order_limit_price"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'submitted', 'partially_filled', "
            "'filled', 'cancelled', 'rejected', 'failed')",
            name="chk_order_status",
        ),
        sa.PrimaryKeyConstraint("id", name="orders_pkey"),
    )

    # -----------------------------------
    # EXECUTIONS
    # -----------------------------------
    op.create_table(
        "executions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("execution_quantity", sa.Numeric(20, 8), nullable=False),
        sa.Column("execution_price", sa.Numeric(15, 6), nullable=False),
        sa.Column(
            "fees", sa.Numeric(15, 6), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "executed_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name="executions_order_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("execution_quantity > 0", name="chk_execution_quantity"),
        sa.CheckConstraint("execution_price > 0", name="chk_execution_price"),
        sa.CheckConstraint("fees >= 0", name="chk_execution_fees"),
        sa.PrimaryKeyConstraint("id", name="executions_pkey"),
    )

    # -----------------------------------
    # MARKET DATA
    # -----------------------------------
    op.create_table(
        "market_data",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("timeframe", sa.String(10), nullable=False, server_default="1d"),
        sa.Column("open_price", sa.Numeric(15, 6), nullable=False),
        sa.Column("high_price", sa.Numeric(15, 6), nullable=False),
        sa.Column("low_price", sa.Numeric(15, 6), nullable=False),
        sa.Column("close_price", sa.Numeric(15, 6), nullable=False),
        sa.Column(
            "volume", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("data_source", sa.String(100)),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["assets.id"],
            name="market_data_asset_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "asset_id", "timestamp", "timeframe", name="uq_market_data_asset_timeframe"
        ),
        sa.CheckConstraint(
            "timeframe IN ('1m', '5m', '15m', '1h', '4h', '1d', '1w')",
            name="chk_market_data_timeframe",
        ),
        sa.CheckConstraint("volume >= 0", name="chk_market_data_volume"),
        sa.CheckConstraint(
            "open_price > 0 AND high_price > 0 AND "
            "low_price > 0 AND close_price > 0 AND "
            "high_price >= low_price AND "
            "high_price >= GREATEST(open_price, close_price) AND "
            "low_price <= LEAST(open_price, close_price)",
            name="chk_market_data_prices",
        ),
        sa.PrimaryKeyConstraint("id", name="market_data_pkey"),
    )

    # -----------------------------------
    # TECHNICAL INDICATORS
    # -----------------------------------
    op.create_table(
        "technical_indicators",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("indicator_name", sa.String(50), nullable=False),
        sa.Column(
            "indicator_parameters",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("indicator_value", postgresql.JSONB(), nullable=False),
        sa.Column("timeframe", sa.String(10), nullable=False, server_default="1d"),
        sa.Column("calculated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["assets.id"],
            name="technical_indicators_asset_id_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "timeframe IN ('1m', '5m', '15m', '1h', '4h', '1d', '1w')",
            name="chk_indicator_timeframe",
        ),
        sa.PrimaryKeyConstraint("id", name="technical_indicators_pkey"),
    )


def downgrade() -> None:
    op.drop_table("technical_indicators")
    op.drop_table("market_data")
    op.drop_table("executions")
    op.drop_table("orders")
    op.drop_table("trade_decisions")
    op.drop_table("portfolio_snapshots")
    op.drop_table("positions")
    op.drop_table("strategy_configurations")
    op.drop_table("strategies")
    op.drop_table("portfolios")
    op.drop_table("user_preferences")
    op.drop_table("assets")
    op.drop_table("users")

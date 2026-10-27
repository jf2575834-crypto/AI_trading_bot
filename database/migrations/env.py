import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine, pool

# Step 1: Load environment variables
# Locate the database folder relative to this file.
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# Step 2: Get Alembic configuration
config = context.config

# Step 3: Configure logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Step 4: Retrieve PostgreSQL connection URL
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not found. Check your .env file.")

# Step 5: SQLAlchemy metadata
# We will add our TradeMind models later.
target_metadata = None


def run_migrations_offline():
    """Run migrations without a database connection."""

    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations using a PostgreSQL connection."""

    engine = create_engine(
        DATABASE_URL,
        poolclass=pool.NullPool,
    )

    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()

    engine.dispose()


# Step 6: Determine migration mode
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

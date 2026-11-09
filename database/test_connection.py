import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load database credentials
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing.")

# Connect to PostgreSQL
engine = create_engine(DATABASE_URL)

with engine.connect() as connection:

    # Verify database name
    database_name = connection.execute(text("SELECT current_database()")).scalar()

    print(f"Connected to database: {database_name}")

    # Count existing tables
    table_count = connection.execute(text("""
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
        """)).scalar()

    print(f"Number of tables: {table_count}")

    # Verify portfolio relationship in orders
    result = connection.execute(text("""
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'orders'
              AND column_name = 'portfolio_id'
        """)).fetchone()

    if result:
        print(f"Orders portfolio_id nullable: {result[1]}")
    else:
        print("Orders portfolio_id column not found!")

engine.dispose()

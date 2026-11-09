import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

database_url = os.getenv("DATABASE_URL")

if not database_url:
    raise RuntimeError("DATABASE_URL is missing.")

engine = create_engine(database_url)
inspector = inspect(engine)

tables = inspector.get_table_names(schema="public")

for table_name in sorted(tables):
    print(f"\n{'=' * 60}")
    print(f"TABLE: {table_name}")
    print("=" * 60)

    print("\nCOLUMNS:")
    for column in inspector.get_columns(table_name, schema="public"):
        print(
            f"  {column['name']}: "
            f"{column['type']} "
            f"nullable={column['nullable']} "
            f"default={column.get('default')}"
        )

    print("\nPRIMARY KEY:")
    print(inspector.get_pk_constraint(table_name, schema="public"))

    print("\nFOREIGN KEYS:")
    for fk in inspector.get_foreign_keys(table_name, schema="public"):
        print(f"  {fk}")

    print("\nUNIQUE CONSTRAINTS:")
    for constraint in inspector.get_unique_constraints(table_name, schema="public"):
        print(f"  {constraint}")

    print("\nCHECK CONSTRAINTS:")
    for constraint in inspector.get_check_constraints(table_name, schema="public"):
        print(f"  {constraint}")

    print("\nINDEXES:")
    for index in inspector.get_indexes(table_name, schema="public"):
        print(f"  {index}")

engine.dispose()

"""Read-only preflight. Usage: python inspect_market_data.py /path/to/database/.env"""

import json
import sys

from dotenv import dotenv_values
from sqlalchemy import create_engine, inspect, text

url = dotenv_values(sys.argv[1]).get("DATABASE_URL")
if not url:
    raise SystemExit("DATABASE_URL missing")
if url.startswith("postgresql://"):
    url = url.replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(url, connect_args={"connect_timeout": 5})
with engine.connect() as conn:
    conn.execute(text("SET TRANSACTION READ ONLY"))
    conn.execute(text("SET LOCAL statement_timeout = '10s'"))
    for label, query in {
        "revision": "SELECT * FROM alembic_version",
        "timezone": "SHOW timezone",
        "summary": (
            'SELECT count(*) AS rows, min("timestamp") AS earliest, '
            'max("timestamp") AS latest FROM market_data'
        ),
        "sources": "SELECT data_source, count(*) FROM market_data GROUP BY data_source",
        "currencies": (
            "SELECT a.currency, count(*) FROM market_data m "
            "LEFT JOIN assets a ON a.id=m.asset_id GROUP BY a.currency"
        ),
    }.items():
        rows = [dict(r) for r in conn.execute(text(query)).mappings()]
        print(label, json.dumps(rows, default=str))
    inspector = inspect(conn)
    methods = (
        "get_columns",
        "get_pk_constraint",
        "get_foreign_keys",
        "get_unique_constraints",
        "get_check_constraints",
        "get_indexes",
    )
    for method in methods:
        print(method, json.dumps(getattr(inspector, method)("market_data"), default=str))
engine.dispose()

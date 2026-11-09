from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from trademind.accounts import AccountStore
from trademind.api import create_app


def test_health_reports_ok(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'accounts.db'}")
    store = AccountStore(engine)
    store.create_schema()
    client = TestClient(create_app(store))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    engine.dispose()

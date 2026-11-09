import pytest
from fastapi.testclient import TestClient

from trademind.api.server import create_app_from_env, init_database


def test_app_from_env_reads_database_url(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'api.db'}")

    client = TestClient(create_app_from_env())

    assert client.get("/health").json() == {"status": "ok"}


def test_app_from_env_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        create_app_from_env()


def test_init_database_creates_tables_for_sign_up(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'api.db'}")
    init_database()

    client = TestClient(create_app_from_env())
    response = client.post(
        "/auth/signup",
        json={"email": "trader@example.com", "password": "correct horse battery"},
    )

    assert response.status_code == 201

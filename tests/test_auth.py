from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from trademind.accounts import AccountStore
from trademind.accounts.passwords import hash_password, verify_password
from trademind.api import create_app

PASSWORD = "correct horse battery"


@pytest.fixture
def account_store(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'accounts.db'}")
    store = AccountStore(engine)
    store.create_schema()
    yield store
    engine.dispose()


@pytest.fixture
def client(account_store):
    return TestClient(create_app(account_store))


def sign_up(client, email="trader@example.com", password=PASSWORD):
    return client.post("/auth/signup", json={"email": email, "password": password})


def log_in(client, email="trader@example.com", password=PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})


def test_sign_up_returns_user_without_password(client):
    response = sign_up(client, email="Trader@Example.com")

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "trader@example.com"
    assert "password" not in body and "password_hash" not in body


def test_sign_up_rejects_duplicate_email(client):
    sign_up(client)

    response = sign_up(client, email="TRADER@example.com")

    assert response.status_code == 409


def test_sign_up_rejects_short_password_and_bad_email(client):
    assert sign_up(client, password="short").status_code == 422
    assert sign_up(client, email="not-an-email").status_code == 422


def test_login_returns_token_that_authenticates_me(client):
    sign_up(client)

    token = log_in(client).json()["access_token"]
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "trader@example.com"


def test_login_failures_share_one_message(client):
    sign_up(client)

    wrong_password = log_in(client, password="wrong password here")
    unknown_email = log_in(client, email="nobody@example.com")

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()


def test_me_requires_a_valid_token(client):
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_logout_invalidates_token(client):
    sign_up(client)
    token = log_in(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/auth/me", headers=headers).status_code == 401


def test_expired_session_is_rejected(account_store):
    client = TestClient(create_app(AccountStore(account_store.engine, timedelta(seconds=-1))))
    sign_up(client)
    token = log_in(client).json()["access_token"]

    assert client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_password_hash_verifies_and_is_salted():
    first = hash_password(PASSWORD)
    second = hash_password(PASSWORD)

    assert first != second
    assert verify_password(PASSWORD, first)
    assert not verify_password("wrong password here", first)

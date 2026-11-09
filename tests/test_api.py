from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from trademind.api.main import app
from trademind.market_data.models import Candle

client = TestClient(app)


def test_health():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_market_data():
    sample_candle = Candle(
        symbol="AAPL",
        timestamp=datetime(2026, 10, 1, tzinfo=UTC),
        timeframe="1Day",
        open="100.00",
        high="105.00",
        low="99.00",
        close="103.00",
        volume="10000",
    )

    with (
        patch("trademind.api.main.Settings.from_env") as mock_settings,
        patch("trademind.api.main.AlpacaClient") as mock_alpaca,
    ):
        mock_settings.return_value = object()
        mock_alpaca.return_value.__enter__.return_value.historical_pages.return_value = [
            [sample_candle]
        ]

        response = client.get(
            "/api/v1/market-data",
            params={
                "symbol": "AAPL",
                "timeframe": "1Day",
                "limit": 20,
            },
        )

    assert response.status_code == 200
    data = response.json()

    assert data["symbol"] == "AAPL"
    assert data["count"] == 1
    assert data["candles"][0]["close"] == "103.00"


def test_invalid_symbol():
    response = client.get(
        "/api/v1/market-data",
        params={"symbol": "INVALID SYMBOL"},
    )

    assert response.status_code == 400


def test_get_dataset():
    sample_candle = Candle(
        symbol="AAPL",
        timestamp=datetime(2026, 10, 1, tzinfo=UTC),
        timeframe="1Day",
        open="100.00",
        high="105.00",
        low="99.00",
        close="103.00",
        volume="10000",
        feed="iex",
        provider="alpaca",
    )

    mock_dataset = SimpleNamespace(
        candles=(sample_candle,) * 51,
        sha256="a" * 64,
    )

    with patch(
        "trademind.api.main.load_dataset",
        return_value=mock_dataset,
    ):
        response = client.get("/api/v1/datasets/AAPL")

    assert response.status_code == 200

    data = response.json()

    assert data["symbol"] == "AAPL"
    assert data["timeframe"] == "1Day"
    assert data["feed"] == "iex"
    assert data["count"] == 51
    assert len(data["candles"]) == 51
    assert data["sha256"] == "a" * 64

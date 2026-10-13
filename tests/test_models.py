import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from trademind.market_data.alpaca import decode
from trademind.market_data.config import Settings
from trademind.market_data.models import Candle, MarketDataError, symbols, timeframe, utc_datetime


def test_normalizes_timezone_symbol_and_preserves_decimal(raw_bar):
    raw_bar["t"] = "2026-10-01T09:30:00-05:00"
    raw_bar["o"] = Decimal("100.1234567890")
    candle = Candle.from_alpaca(" aapl ", raw_bar, "1Min", "iex")
    assert candle.timestamp == datetime(2026, 10, 1, 14, 30, tzinfo=UTC)
    assert candle.symbol == "AAPL"
    assert candle.to_json()["open"] == "100.1234567890"
    assert json.loads(json.dumps(candle.to_json()))["timestamp"].endswith("Z")


@pytest.mark.parametrize(
    "field,value",
    [
        ("h", 90),
        ("l", 105),
        ("v", -1),
        ("c", "NaN"),
        ("c", "Infinity"),
        ("v", True),
        ("t", "bad"),
        ("t", "2026-10-01T14:30:00"),
        ("o", "100.12345678901"),
        ("o", "1000000000000000000"),
        ("o", None),
    ],
)
def test_rejects_invalid_candles(raw_bar, field, value):
    raw_bar[field] = value
    with pytest.raises(MarketDataError):
        Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")


def test_missing_required_field(raw_bar):
    del raw_bar["v"]
    with pytest.raises(MarketDataError):
        Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")


def test_decoder_preserves_original_decimal_digits():
    assert decode('{"price":100.1234567890}')["price"] == Decimal("100.1234567890")
    with pytest.raises(MarketDataError):
        decode("not-json")


def test_validated_inputs():
    assert symbols(["aapl", "AAPL", "brk.b"]) == ("AAPL", "BRK.B")
    assert timeframe("59Min") == "59Min"
    for frame in ["60Min", "24Hour", "0Min", "5D", ""]:
        with pytest.raises(ValueError):
            timeframe(frame)
    for tickers in [[], ["*"], ["AAPL,TSLA"], [""]]:
        with pytest.raises(ValueError):
            symbols(tickers)
    with pytest.raises(ValueError):
        utc_datetime(datetime(2026, 10, 1))


def test_config_validates_and_hides_secrets(monkeypatch):
    settings = Settings("test-key", "test-secret", "postgresql://user:password@host/db")
    assert "test-key" not in repr(settings)
    assert "test-secret" not in repr(settings)
    assert "password" not in repr(settings)
    with pytest.raises(ValueError):
        Settings("", "secret")
    with pytest.raises(ValueError):
        Settings("key", "secret", feed="bad")
    with pytest.raises(ValueError):
        Settings("key", "secret", timeout=float("nan"))
    monkeypatch.setenv("ALPACA_API_KEY", "key")
    monkeypatch.setenv("ALPACA_SECRET_KEY", "secret")
    assert Settings.from_env().feed == "iex"

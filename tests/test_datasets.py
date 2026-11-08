import json
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import pytest

from trademind.market_data.cli import main
from trademind.market_data.datasets import load_dataset, save_dataset
from trademind.market_data.models import Candle


def test_history_filters_series_and_range_and_sorts(store, raw_bar):
    first = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    second = replace(
        first, timestamp=first.timestamp + timedelta(minutes=1), close=Decimal("101.5")
    )
    store.upsert(
        [
            second,
            first,
            replace(first, symbol="MSFT"),
            replace(first, feed="sip"),
            replace(first, timeframe="1Day"),
            replace(first, provider="another"),
            replace(first, timestamp=first.timestamp - timedelta(minutes=1)),
            replace(first, timestamp=second.timestamp + timedelta(minutes=1)),
        ]
    )
    assert store.history("aapl", "1Min", first.timestamp, second.timestamp) == (first, second)
    assert store.history("AAPL", "1Min", first.timestamp, second.timestamp, feed="sip") == (
        replace(first, feed="sip"),
    )


def test_snapshot_stays_frozen_after_database_correction(store, raw_bar, tmp_path):
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    start, end = candle.timestamp, candle.timestamp + timedelta(minutes=1)
    store.upsert([candle])
    path = tmp_path / "snapshot.json"
    saved = save_dataset(path, store.history("AAPL", "1Min", start, end), start, end)
    store.upsert([replace(candle, close=Decimal("101.5"))])
    loaded = load_dataset(path)
    assert loaded == saved
    assert loaded.closes == (Decimal("101"),)
    assert store.history("AAPL", "1Min", start, end)[0].close == Decimal("101.5")
    second = save_dataset(tmp_path / "same.json", loaded.candles, start, end)
    assert second.sha256 == loaded.sha256
    assert len(loaded.sha256) == 64
    with pytest.raises(FileExistsError):
        save_dataset(path, loaded.candles, start, end)


@pytest.mark.parametrize(
    "bad_series", ["empty", "mixed", "duplicate", "reversed", "outside", "short"]
)
def test_invalid_series_does_not_create_file(raw_bar, tmp_path, bad_series):
    first = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    second = replace(first, timestamp=first.timestamp + timedelta(minutes=1))
    series = {
        "empty": (),
        "mixed": (first, replace(second, feed="sip")),
        "duplicate": (first, first),
        "reversed": (second, first),
        "outside": (replace(first, timestamp=first.timestamp - timedelta(minutes=1)),),
        "short": (first,),
    }[bad_series]
    path = tmp_path / "invalid.json"
    with pytest.raises(ValueError):
        save_dataset(
            path,
            series,
            first.timestamp,
            second.timestamp,
            min_bars=2 if bad_series == "short" else 1,
        )
    assert not path.exists()


def test_loader_rejects_changed_content_and_wrong_format(raw_bar, tmp_path):
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    path = tmp_path / "snapshot.json"
    save_dataset(path, (candle,), candle.timestamp, candle.timestamp + timedelta(minutes=1))
    original = path.read_text()
    with pytest.raises(ValueError):
        load_dataset(path, min_bars=2)
    document = json.loads(original)
    document["candles"][0]["close"] = "101.5"
    path.write_text(json.dumps(document))
    with pytest.raises(ValueError):
        load_dataset(path)
    for invalid in ("null", "[]", "{}", "not json"):
        path.write_text(invalid)
        with pytest.raises(ValueError):
            load_dataset(path)


def test_export_cli_needs_no_api_keys_and_handles_missing_data(
    monkeypatch, tmp_path, raw_bar, capsys
):
    from trademind.market_data.storage import SQLCandleStore

    url = f"sqlite:///{tmp_path / 'history.db'}"
    store = SQLCandleStore.from_url(url)
    store.create_schema()
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    store.upsert([candle])
    store.engine.dispose()
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    path = tmp_path / "demo.json"
    argv = [
        "trademind-data",
        "export",
        "--symbol",
        "AAPL",
        "--feed",
        "iex",
        "--start",
        "2026-10-01T14:30:00Z",
        "--end",
        "2026-10-01T14:31:00Z",
        "--output",
        str(path),
    ]
    monkeypatch.setattr("sys.argv", argv)
    assert main() == 0
    assert json.loads(capsys.readouterr().out)["candles"] == 1
    assert load_dataset(path).candles == (candle,)
    original = path.read_bytes()
    assert main() == 1
    assert path.read_bytes() == original
    argv[3] = "MSFT"
    assert main() == 1
    assert "found 0" in capsys.readouterr().err

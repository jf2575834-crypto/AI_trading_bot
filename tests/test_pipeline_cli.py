from datetime import UTC, datetime

import httpx
from sqlalchemy import create_engine, func, select

from trademind.market_data.alpaca import AlpacaClient
from trademind.market_data.cli import main
from trademind.market_data.pipeline import IngestionPipeline
from trademind.market_data.storage import SQLCandleStore, market_candles


def test_history_pipeline_can_be_rerun_without_duplicates(settings, raw_bar, tmp_path):
    store = SQLCandleStore(create_engine(f"sqlite:///{tmp_path / 'history.db'}"))
    store.create_schema()
    responses = [
        {"bars": {"AAPL": [raw_bar]}, "next_page_token": "p2"},
        {"bars": {"MSFT": [raw_bar]}, "next_page_token": None},
    ]
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=responses[(len(calls) - 1) % 2])

    try:
        with AlpacaClient(
            settings, transport=httpx.MockTransport(handler), sleep=lambda _: None
        ) as client:
            pipeline = IngestionPipeline(client, store)
            for _ in range(2):
                assert (
                    pipeline.historical(["AAPL", "MSFT"], "1Min", datetime(2026, 10, 1, tzinfo=UTC))
                    == 2
                )
        with store.engine.connect() as connection:
            assert connection.scalar(select(func.count()).select_from(market_candles)) == 2
    finally:
        store.engine.dispose()


def test_init_db_cli_does_not_require_api_keys(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'cli.db'}")
    monkeypatch.setattr("sys.argv", ["trademind-data", "init-db"])
    assert main() == 0
    assert "table ready" in capsys.readouterr().out


def test_cli_reports_missing_api_keys(monkeypatch, capsys):
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    monkeypatch.setattr("sys.argv", ["trademind-data", "latest", "--symbols", "AAPL"])
    assert main() == 1
    assert "Set ALPACA_API_KEY" in capsys.readouterr().err

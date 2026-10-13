"""CLI for schema bootstrap, history ingestion, latest bars, and live dispatch."""

import argparse
import asyncio
import contextlib
import json
import sys

from sqlalchemy.exc import SQLAlchemyError

from .alpaca import AlpacaClient, AlpacaStream
from .config import Settings
from .models import MarketDataError, symbols, timeframe, utc_datetime
from .pipeline import IngestionPipeline, LiveBuffer
from .storage import SQLCandleStore


async def run_stream(pipeline, settings, tickers):
    buffer = LiveBuffer()
    producer = asyncio.create_task(pipeline.stream(tickers, AlpacaStream(settings), buffer))

    async def print_events():
        while True:
            candle = await buffer.queue.get()
            print(json.dumps(candle.to_json()), flush=True)

    consumer = asyncio.create_task(print_events())
    try:
        done, _ = await asyncio.wait({producer, consumer}, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in (producer, consumer):
            task.cancel()
        await asyncio.gather(producer, consumer, return_exceptions=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="TradeMind stock market data ingestion")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-db", help="Explicitly create the market_candles development table")
    history = commands.add_parser("history")
    history.add_argument("--symbols", nargs="+", required=True)
    history.add_argument("--timeframe", type=timeframe, default="1Min")
    history.add_argument("--start", type=utc_datetime, required=True)
    history.add_argument("--end", type=utc_datetime, required=True)
    latest = commands.add_parser("latest")
    latest.add_argument("--symbols", nargs="+", required=True)
    live = commands.add_parser("stream")
    live.add_argument("--symbols", nargs="+", required=True)
    args = parser.parse_args()
    store = None
    try:
        # init-db needs only a database URL, not a market-data account.
        if args.command == "init-db":
            import os

            store = SQLCandleStore.from_url(os.getenv("DATABASE_URL", ""))
            store.create_schema()
            print("market_candles table ready")
            return 0
        settings = Settings.from_env()
        selected = symbols(args.symbols)
        with AlpacaClient(settings) as client:
            if args.command == "latest":
                for bar in client.latest(selected):
                    print(json.dumps(bar.to_json()))
                return 0
            store = SQLCandleStore.from_url(settings.database_url)
            pipeline = IngestionPipeline(client, store)
            if args.command == "history":
                count = pipeline.historical(selected, args.timeframe, args.start, args.end)
                print(f"Upserted {count} candles (includes overlapping records)")
            elif args.command == "stream":
                asyncio.run(run_stream(pipeline, settings, selected))
        return 0
    except (ValueError, MarketDataError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except SQLAlchemyError:
        print(
            "Database operation failed; check DATABASE_URL and the market_candles schema",
            file=sys.stderr,
        )
        return 1
    except KeyboardInterrupt:
        return 130
    finally:
        if store:
            with contextlib.suppress(Exception):
                store.engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

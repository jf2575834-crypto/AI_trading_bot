"""! @brief CLI for ingestion, live dispatch and reproducible historical dataset export."""

import argparse
import asyncio
import contextlib
import json
import os
import sys
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from .alpaca import AlpacaClient, AlpacaStream
from .config import Settings
from .datasets import save_dataset
from .models import MarketDataError, symbols, timeframe, utc_datetime
from .pipeline import IngestionPipeline, LiveBuffer
from .storage import SQLCandleStore


async def run_stream(pipeline, settings, tickers):
    """! @brief Persist a live stream and print each queued candle as JSON.
    @param pipeline Ingestion pipeline that stores bars before dispatch.
    @param settings Validated Alpaca credentials, feed, and timeout/retry limits.
    @param tickers Explicit symbols to stream.
    The producer and consumer are cancelled and awaited when either finishes or fails.
    """
    buffer = LiveBuffer()
    producer = asyncio.create_task(pipeline.stream(tickers, AlpacaStream(settings), buffer))

    async def print_events():
        """! @brief Drain the live queue and print newline-delimited candle JSON."""
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
    """! @brief Run a data command using environment configuration and command-line inputs.
    @return Zero on success, one on a handled error, or 130 on keyboard interruption.
    """
    parser = argparse.ArgumentParser(description="TradeMind stock market data ingestion")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-db", help="Create the SQLite demo table; PostgreSQL uses Alembic")
    history = commands.add_parser("history")
    history.add_argument("--symbols", nargs="+", required=True)
    history.add_argument("--timeframe", type=timeframe, default="1Min")
    history.add_argument("--start", type=utc_datetime, required=True)
    history.add_argument("--end", type=utc_datetime, required=True)
    latest = commands.add_parser("latest")
    latest.add_argument("--symbols", nargs="+", required=True)
    live = commands.add_parser("stream")
    live.add_argument("--symbols", nargs="+", required=True)
    export = commands.add_parser("export", help="Freeze stored history for offline CPU/FPGA inputs")
    export.add_argument("--symbol", required=True)
    export.add_argument(
        "--feed", choices=("iex", "sip"), default=os.getenv("ALPACA_DATA_FEED", "iex")
    )
    export.add_argument("--timeframe", type=timeframe, default="1Min")
    export.add_argument("--start", type=utc_datetime, required=True)
    export.add_argument("--end", type=utc_datetime, required=True)
    export.add_argument("--min-bars", type=int, default=1)
    export.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    store = None
    try:
        # Stored-data commands need only a database URL, not a market-data account.
        if args.command in {"init-db", "export"}:
            store = SQLCandleStore.from_url(os.getenv("DATABASE_URL", ""))
        if args.command == "export":
            bars = store.history(args.symbol, args.timeframe, args.start, args.end, feed=args.feed)
            dataset = save_dataset(args.output, bars, args.start, args.end, min_bars=args.min_bars)
            print(
                json.dumps(
                    {"candles": len(bars), "sha256": dataset.sha256, "output": str(args.output)}
                )
            )
            return 0
        if args.command == "init-db":
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
            "Database operation failed; check DATABASE_URL and the schema. "
            "PostgreSQL requires the migrations in database/README.md",
            file=sys.stderr,
        )
        return 1
    except OSError:
        print(
            "Dataset file operation failed; check the path and use a new output filename",
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

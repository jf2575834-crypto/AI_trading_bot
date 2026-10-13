"""Persist first, then dispatch; propagate storage failures to the caller."""

import asyncio
from datetime import UTC, datetime, timedelta

from .alpaca import AlpacaClient, AlpacaStream
from .models import Candle
from .storage import CandleStore


class LiveBuffer:
    """Bounded dispatch queue plus the latest bar per explicit symbol."""

    def __init__(self, capacity: int = 1000):
        if capacity < 1:
            raise ValueError("Buffer capacity must be positive")
        self.queue: asyncio.Queue[Candle] = asyncio.Queue(maxsize=capacity)
        self.latest: dict[str, Candle] = {}

    async def publish(self, candle: Candle) -> None:
        previous = self.latest.get(candle.symbol)
        if previous is None or candle.timestamp >= previous.timestamp:
            self.latest[candle.symbol] = candle
        # Full queue applies backpressure; a consumer must drain it.
        await self.queue.put(candle)


class IngestionPipeline:
    def __init__(self, client: AlpacaClient, store: CandleStore):
        self.client, self.store = client, store

    def historical(self, tickers, frame, start, end=None) -> int:
        written = 0
        for page in self.client.historical_pages(tickers, frame, start, end):
            written += self.store.upsert(page)
        return written

    async def stream(self, tickers, stream: AlpacaStream, buffer: LiveBuffer) -> None:
        async def recover():
            # Runs on first connection (restart recovery) and every reconnect.
            # Overlap incorporates late corrections. Replay is persisted, not dispatched
            # as new live signals; strategies should reload history after a gap.
            for ticker in tickers:
                stamp = await asyncio.to_thread(
                    self.store.latest_timestamp,
                    ticker,
                    self.client.settings.feed,
                )
                if stamp is not None:
                    end = datetime.now(UTC)
                    start = stamp - timedelta(minutes=1)
                    if start < end:
                        await asyncio.to_thread(self.historical, [ticker], "1Min", start, end)

        async for candle in stream.bars(tickers, on_connected=recover):
            await asyncio.to_thread(self.store.upsert, [candle])
            await buffer.publish(candle)

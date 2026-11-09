"""! @brief Persist historical and live candles before exposing them to consumers.
Storage failures propagate so callers do not mistake an unpersisted bar for a saved one.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from .alpaca import AlpacaClient, AlpacaStream
from .models import Candle
from .storage import CandleStore


class LiveBuffer:
    """! @brief Bounded live-candle queue and latest candle snapshot per symbol.
    A full queue applies backpressure until a consumer reads an item.
    """

    def __init__(self, capacity: int = 1000):
        """! @brief Create an empty live queue with a positive maximum size.
        @param capacity Maximum queued candles before publishers wait for a consumer.
        @exception ValueError If capacity is less than one.
        """
        if capacity < 1:
            raise ValueError("Buffer capacity must be positive")
        self.queue: asyncio.Queue[Candle] = asyncio.Queue(maxsize=capacity)
        self.latest: dict[str, Candle] = {}

    async def publish(self, candle: Candle) -> None:
        """! @brief Save the newest symbol snapshot and enqueue the persisted candle.
        @param candle Candle already committed by the ingestion pipeline.
        The latest snapshot never moves backward in time; corrected bars at the same
        timestamp still enter the queue for consumers to process.
        """
        previous = self.latest.get(candle.symbol)
        if previous is None or candle.timestamp >= previous.timestamp:
            self.latest[candle.symbol] = candle
        # Full queue applies backpressure; a consumer must drain it.
        await self.queue.put(candle)


class IngestionPipeline:
    """! @brief Coordinate Alpaca history/streams with transactional candle storage."""

    def __init__(self, client: AlpacaClient, store: CandleStore):
        """! @brief Bind a provider client and candle store.
        @param client Alpaca REST client used for historical backfills.
        @param store Store implementing transactional upserts and latest-timestamp reads.
        """
        self.client, self.store = client, store

    def historical(self, tickers, frame, start, end=None) -> int:
        """! @brief Fetch every history page and upsert each page before continuing.
        @param tickers Explicit stock symbols requested from Alpaca.
        @param frame Alpaca interval such as 1Min or 1Day.
        @param start Inclusive timezone-aware UTC start.
        @param end Optional timezone-aware end.
        @return Number of distinct candles reported as upserted across all pages.
        @exception ValueError For invalid symbols, interval or date range.
        Provider/storage failures stop iteration and propagate to the caller.
        """
        written = 0
        for page in self.client.historical_pages(tickers, frame, start, end):
            written += self.store.upsert(page)
        return written

    async def stream(self, tickers, stream: AlpacaStream, buffer: LiveBuffer) -> None:
        """! @brief Persist streamed minute bars, recover gaps, then publish to consumers.
        @param tickers Explicit symbols subscribed to by the stream client.
        @param stream Alpaca WebSocket source of current/corrected bars.
        @param buffer Bounded queue that receives each candle after its database write.
        @exception ValueError For invalid subscription symbols.
        Provider, network, or database failures propagate; caller controls cancellation.
        """

        async def recover():
            """! @brief Backfill with a one-minute overlap after connection or reconnect.
            The overlap lets stored upserts capture late corrections; recovery bars are
            stored for history but are not replayed as new live strategy signals.
            """
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

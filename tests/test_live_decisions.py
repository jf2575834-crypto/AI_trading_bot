import asyncio
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import pytest

from trademind.market_data.models import Candle
from trademind.market_data.pipeline import IngestionPipeline, LiveBuffer


def test_skips_backlog_future_and_superseded_bars(raw_bar):
    async def run():
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        buffer = LiveBuffer()
        # Different symbols ensure these are rejected by age, not supersession.
        await buffer.publish(
            replace(candle, symbol="OLD", timestamp=candle.timestamp - timedelta(days=1))
        )
        await buffer.publish(
            replace(candle, symbol="FUTURE", timestamp=candle.timestamp + timedelta(days=1))
        )
        await buffer.publish(candle)
        newest = replace(candle, timestamp=candle.timestamp + timedelta(minutes=1))
        await buffer.publish(newest)
        result = await asyncio.wait_for(
            buffer.next_for_decision(max_age=timedelta(minutes=2), now=lambda: newest.timestamp),
            timeout=1,
        )
        assert result == newest
        buffer.queue.task_done()
        await asyncio.wait_for(buffer.queue.join(), timeout=1)

    asyncio.run(run())


def test_age_checked_after_waiting_in_queue(raw_bar):
    async def run():
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        buffer = LiveBuffer(capacity=1)
        await buffer.publish(candle)
        clock = candle.timestamp + timedelta(minutes=10)
        waiting = asyncio.create_task(
            buffer.next_for_decision(max_age=timedelta(minutes=2), now=lambda: clock)
        )
        await asyncio.sleep(0)
        assert buffer.queue.empty() and not waiting.done()
        fresh = replace(candle, timestamp=clock - timedelta(minutes=1))
        await buffer.publish(fresh)
        assert await asyncio.wait_for(waiting, timeout=1) == fresh
        buffer.queue.task_done()
        await asyncio.wait_for(buffer.queue.join(), timeout=1)

    asyncio.run(run())


def test_corrections_and_out_of_order_bars_do_not_repeat_decisions(raw_bar):
    async def run():
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        buffer = LiveBuffer()
        corrected = replace(candle, close=Decimal("101.5"))
        await buffer.publish(candle)
        await buffer.publish(corrected)
        clock = candle.timestamp + timedelta(minutes=1)
        assert (
            await buffer.next_for_decision(max_age=timedelta(minutes=2), now=lambda: clock)
            == corrected
        )
        buffer.queue.task_done()
        await buffer.publish(corrected)
        await buffer.publish(replace(candle, timestamp=candle.timestamp - timedelta(minutes=1)))
        waiting = asyncio.create_task(
            buffer.next_for_decision(max_age=timedelta(minutes=2), now=lambda: clock)
        )
        await asyncio.sleep(0)
        assert buffer.queue.empty() and not waiting.done()
        next_bar = replace(candle, timestamp=clock)
        await buffer.publish(next_bar)
        assert await waiting == next_bar
        buffer.queue.task_done()
        await asyncio.wait_for(buffer.queue.join(), timeout=1)

    asyncio.run(asyncio.wait_for(run(), timeout=2))


def test_future_bar_does_not_suppress_valid_bar_in_same_series(raw_bar):
    async def run():
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        buffer = LiveBuffer()
        await buffer.publish(replace(candle, timestamp=candle.timestamp + timedelta(days=1)))
        await buffer.publish(candle)
        assert (
            await buffer.next_for_decision(
                max_age=timedelta(minutes=2), now=lambda: candle.timestamp
            )
            == candle
        )

    asyncio.run(asyncio.wait_for(run(), timeout=2))


def test_decision_deduplication_keeps_series_separate(raw_bar):
    async def run():
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        buffer = LiveBuffer()
        for bar in [candle, replace(candle, symbol="MSFT"), replace(candle, feed="sip")]:
            await buffer.publish(bar)
        returned = []
        for _ in range(3):
            returned.append(
                await buffer.next_for_decision(
                    max_age=timedelta(minutes=2), now=lambda: candle.timestamp
                )
            )
            buffer.queue.task_done()
        assert [(c.symbol, c.feed) for c in returned] == [
            ("AAPL", "iex"),
            ("MSFT", "iex"),
            ("AAPL", "sip"),
        ]

    asyncio.run(asyncio.wait_for(run(), timeout=2))


def test_all_stream_updates_persist_even_when_decision_filter_skips_them(raw_bar):
    async def run():
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        corrected = replace(candle, close=Decimal("101.5"))
        writes = []

        class Store:
            def upsert(self, bars):
                writes.extend(bars)

        class Stream:
            async def bars(self, tickers, on_connected):
                yield candle
                yield corrected

        buffer = LiveBuffer()
        await IngestionPipeline(None, Store()).stream(["AAPL"], Stream(), buffer)
        assert writes == [candle, corrected]
        assert (
            await buffer.next_for_decision(
                max_age=timedelta(minutes=2), now=lambda: candle.timestamp
            )
            == corrected
        )

    asyncio.run(asyncio.wait_for(run(), timeout=2))


def test_invalid_age_and_waiter_cancellation(raw_bar):
    async def run():
        buffer = LiveBuffer()
        for max_age in [timedelta(0), timedelta(seconds=-1)]:
            with pytest.raises(ValueError, match="positive"):
                await buffer.next_for_decision(max_age=max_age)
        waiting = asyncio.create_task(buffer.next_for_decision(max_age=timedelta(minutes=2)))
        await asyncio.sleep(0)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        await buffer.publish(candle)
        assert await buffer.queue.get() == candle

    asyncio.run(run())

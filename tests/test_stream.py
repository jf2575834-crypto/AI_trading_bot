import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from trademind.market_data.alpaca import AlpacaStream
from trademind.market_data.models import Candle, MarketDataError
from trademind.market_data.pipeline import IngestionPipeline, LiveBuffer


class FakeSocket:
    def __init__(self, events):
        self.events = iter(events)
        self.sent = []

    async def send(self, message):
        self.sent.append(json.loads(message))

    async def recv(self):
        event = next(self.events)
        if isinstance(event, Exception):
            raise event
        return json.dumps(event)


def handshake():
    return [
        [{"T": "success", "msg": "connected"}],
        [{"T": "success", "msg": "authenticated"}],
        [{"T": "subscription", "bars": ["AAPL"], "updatedBars": ["AAPL"]}],
    ]


def test_reconnect_resubscribes_and_replays_connection_callback(settings, raw_bar):
    first = FakeSocket(handshake() + [OSError("lost")])
    second = FakeSocket(handshake() + [[{"T": "b", "S": "AAPL", **raw_bar}]])
    sockets = iter([first, second])
    callbacks, waits = [], []

    @asynccontextmanager
    async def connector(*args, **kwargs):
        yield next(sockets)

    async def sleep(delay):
        waits.append(delay)

    async def connected():
        callbacks.append(True)

    async def run():
        stream = AlpacaStream(settings, connector=connector, sleep=sleep)
        bars = stream.bars(["AAPL"], on_connected=connected)
        try:
            candle = await anext(bars)
            assert candle.symbol == "AAPL"
        finally:
            await bars.aclose()

    asyncio.run(run())
    assert len(callbacks) == 2 and len(waits) == 1
    for socket in (first, second):
        assert [e["action"] for e in socket.sent] == ["auth", "subscribe"]


def test_provider_auth_error_is_fatal(settings):
    socket = FakeSocket([[{"T": "error", "code": 402, "msg": "test-secret"}]])

    @asynccontextmanager
    async def connector(*args, **kwargs):
        yield socket

    async def run():
        with pytest.raises(MarketDataError, match="code 402") as error:
            await anext(AlpacaStream(settings, connector=connector).bars(["AAPL"]))
        assert "test-secret" not in str(error.value)

    asyncio.run(run())
    assert len(socket.sent) == 1


def test_exhausts_reconnects_and_cancels_cleanly(settings):
    attempts = []

    @asynccontextmanager
    async def connector(*args, **kwargs):
        attempts.append(True)
        raise OSError("offline")
        yield  # pragma: no cover

    async def no_wait(_):
        pass

    async def run():
        with pytest.raises(MarketDataError, match="after retries"):
            await anext(AlpacaStream(settings, connector=connector, sleep=no_wait).bars(["AAPL"]))

        @asynccontextmanager
        async def blocked(*args, **kwargs):
            await asyncio.Future()
            yield  # pragma: no cover

        task = asyncio.create_task(anext(AlpacaStream(settings, connector=blocked).bars(["AAPL"])))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert len(attempts) == settings.max_retries + 1


def test_local_websocket_round_trip_and_updated_bar(settings, raw_bar):
    async def run():
        async def handler(socket):
            await socket.send(json.dumps([{"T": "success", "msg": "connected"}]))
            assert json.loads(await socket.recv())["action"] == "auth"
            await socket.send(json.dumps([{"T": "success", "msg": "authenticated"}]))
            subscription = json.loads(await socket.recv())
            assert subscription["updatedBars"] == ["AAPL"]
            await socket.send(
                json.dumps(
                    [
                        {
                            "T": "subscription",
                            "bars": ["AAPL"],
                            "updatedBars": ["AAPL"],
                        }
                    ]
                )
            )
            await socket.send(
                json.dumps(
                    [
                        {"T": "b", "S": "AAPL", **raw_bar},
                        {"T": "u", "S": "AAPL", **raw_bar, "c": 101.5},
                    ]
                )
            )
            await socket.wait_closed()

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]

            def connector(_url, **kwargs):
                return connect(f"ws://127.0.0.1:{port}", proxy=None, **kwargs)

            bars = AlpacaStream(settings, connector=connector).bars(["AAPL"])
            try:
                first, second = await anext(bars), await anext(bars)
                assert first.timestamp == second.timestamp
                assert second.close > first.close
            finally:
                await bars.aclose()

    asyncio.run(asyncio.wait_for(run(), timeout=5))


def test_buffer_backpressure_and_old_correction_does_not_replace_latest(raw_bar):
    async def run():
        candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
        older = replace(candle, timestamp=candle.timestamp - timedelta(minutes=1))
        buffer = LiveBuffer(capacity=1)
        await buffer.publish(candle)
        pending = asyncio.create_task(buffer.publish(older))
        await asyncio.sleep(0)
        assert not pending.done()
        assert await buffer.queue.get() == candle
        await pending
        assert buffer.latest["AAPL"] == candle
        assert await buffer.queue.get() == older

    asyncio.run(run())


def test_stream_persists_before_dispatch_and_recovers_history(settings, raw_bar):
    candle = Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")
    writes, recoveries = [], []

    class Store:
        def latest_timestamp(self, symbol, feed):
            return candle.timestamp

        def upsert(self, bars):
            writes.extend(bars)
            return len(bars)

    class Stream:
        async def bars(self, tickers, on_connected):
            await on_connected()
            yield candle

    class Client:
        settings = SimpleNamespace(feed="iex")

        def historical_pages(self, *args):
            recoveries.append(args)
            yield [candle]

    async def run():
        buffer = LiveBuffer()
        await IngestionPipeline(Client(), Store()).stream(["AAPL"], Stream(), buffer)
        assert writes == [candle, candle]
        assert await buffer.queue.get() == candle

    asyncio.run(run())
    assert recoveries[0][2] == candle.timestamp - timedelta(minutes=1)


def test_storage_failure_propagates_without_dispatch(settings, raw_bar):
    class Store:
        def upsert(self, _):
            raise RuntimeError("database unavailable")

    class Stream:
        async def bars(self, tickers, on_connected):
            yield Candle.from_alpaca("AAPL", raw_bar, "1Min", "iex")

    async def run():
        buffer = LiveBuffer()
        with pytest.raises(RuntimeError, match="database unavailable"):
            await IngestionPipeline(None, Store()).stream(["AAPL"], Stream(), buffer)
        assert buffer.queue.empty()

    asyncio.run(run())

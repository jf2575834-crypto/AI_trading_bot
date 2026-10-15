"""Read-only Alpaca stock data, using documented REST and WebSocket protocols."""

import asyncio
import json
import random
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from datetime import UTC, datetime
from decimal import Decimal
from email.utils import parsedate_to_datetime

import httpx
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from .config import Settings
from .models import Candle, MarketDataError, symbols, timeframe, utc_datetime

DATA_URL = "https://data.alpaca.markets"


def decode(payload: str | bytes):
    try:
        return json.loads(payload, parse_float=Decimal)
    except (ValueError, TypeError) as exc:
        raise MarketDataError("Invalid market data JSON") from exc


def retry_after(response: httpx.Response, fallback: float) -> float:
    value = response.headers.get("Retry-After")
    if value:
        try:
            seconds = float(value)
        except ValueError:
            try:
                seconds = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
            except (ValueError, TypeError):
                seconds = fallback
        if 0 <= seconds <= 300:
            return seconds
    reset = response.headers.get("X-RateLimit-Reset")
    if reset:
        try:
            seconds = float(reset) - time.time()
            if 0 <= seconds <= 300:
                return seconds
        except ValueError:
            pass
    return fallback


class AlpacaClient:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.settings = settings
        self._sleep, self._clock = sleep, clock
        self._last_request: float | None = None
        self._client = httpx.Client(
            base_url=DATA_URL,
            headers=settings.headers,
            timeout=settings.timeout,
            transport=transport,
            follow_redirects=False,
        )

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._client.close()

    def _request(self, path: str, params: dict) -> dict:
        for attempt in range(self.settings.max_retries + 1):
            if self._last_request is not None:
                wait = 60 / self.settings.requests_per_minute - (self._clock() - self._last_request)
                if wait > 0:
                    self._sleep(wait)
            self._last_request = self._clock()
            delay = min(2**attempt, 30) + random.uniform(0, 0.25)
            try:
                response = self._client.get(path, params=params)
            except httpx.TransportError:
                if attempt == self.settings.max_retries:
                    raise MarketDataError("Market data request failed after retries") from None
                self._sleep(delay)
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == self.settings.max_retries:
                    raise MarketDataError(f"Market data HTTP {response.status_code} after retries")
                self._sleep(retry_after(response, delay))
                continue
            if response.status_code != 200:
                # Do not echo provider bodies or credential-bearing request objects.
                raise MarketDataError(
                    f"Market data HTTP {response.status_code}; check access/inputs"
                )
            data = decode(response.content)
            if not isinstance(data, dict):
                raise MarketDataError("Expected an Alpaca response object")
            return data
        raise AssertionError("Unreachable retry state")

    def historical_pages(
        self,
        tickers: list[str] | tuple[str, ...],
        frame: str,
        start: datetime,
        end: datetime | None = None,
        *,
        page_size: int = 1000,
    ) -> Iterator[list[Candle]]:
        selected = symbols(tickers)
        frame, start = timeframe(frame), utc_datetime(start)
        if not 1 <= page_size <= 10000:
            raise ValueError("page_size must be between 1 and 10000")
        params = {
            "symbols": ",".join(selected),
            "timeframe": frame,
            "start": start.isoformat(),
            "limit": page_size,
            "feed": self.settings.feed,
            "adjustment": "raw",
            "sort": "asc",
            "currency": "USD",
            "asof": "-",
        }
        if end is not None:
            end = utc_datetime(end)
            if end <= start:
                raise ValueError("end must be after start")
            params["end"] = end.isoformat()
        seen_tokens = set()
        while True:
            data = self._request("/v2/stocks/bars", params)
            yield self._bars(data, selected, frame)
            token = data.get("next_page_token")
            if token is None:
                break
            if not isinstance(token, str) or not token or token in seen_tokens:
                raise MarketDataError("Invalid or repeated pagination token")
            seen_tokens.add(token)
            params["page_token"] = token

    def latest(self, tickers: list[str] | tuple[str, ...]) -> list[Candle]:
        selected = symbols(tickers)
        data = self._request(
            "/v2/stocks/bars/latest",
            {"symbols": ",".join(selected), "feed": self.settings.feed, "currency": "USD"},
        )
        return self._bars(data, selected, "1Min", latest=True)

    def _bars(
        self, data: dict, selected: tuple[str, ...], frame: str, latest=False
    ) -> list[Candle]:
        # Alpaca can return bars=null when no bars match the query.
        if "bars" not in data:
            raise MarketDataError("Missing bars in Alpaca response")
        raw = data["bars"]
        if raw is None:
            return []
        if not isinstance(raw, dict):
            raise MarketDataError("Invalid Alpaca bars map")
        result = []
        for ticker, records in raw.items():
            if ticker not in selected:
                raise MarketDataError("Unexpected symbol in Alpaca response")
            if latest:
                records = [records] if records is not None else []
            if not isinstance(records, list):
                raise MarketDataError("Invalid Alpaca bars list")
            result.extend(
                Candle.from_alpaca(ticker, bar, frame, self.settings.feed) for bar in records
            )
        return result


class AlpacaStream:
    def __init__(self, settings: Settings, *, connector=connect, sleep=asyncio.sleep):
        self.settings, self._connect, self._sleep = settings, connector, sleep

    async def _events(self, socket) -> list[dict]:
        events = decode(await socket.recv())
        if not isinstance(events, list) or any(not isinstance(item, dict) for item in events):
            raise MarketDataError("Expected an Alpaca stream event array")
        for event in events:
            if event.get("T") == "error":
                # Error messages can contain external input. Report only the numeric code.
                code = event.get("code")
                code = code if isinstance(code, int) else "unknown"
                raise MarketDataError(f"Alpaca stream rejected the request (code {code})")
        return events

    async def _subscribe(self, socket, selected: tuple[str, ...]) -> list[dict]:
        await socket.send(
            json.dumps(
                {
                    "action": "auth",
                    "key": self.settings.api_key,
                    "secret": self.settings.secret_key,
                }
            )
        )
        async with asyncio.timeout(min(self.settings.timeout, 10)):
            while True:
                events = await self._events(socket)
                if any(e.get("T") == "success" and e.get("msg") == "authenticated" for e in events):
                    break
            await socket.send(
                json.dumps(
                    {
                        "action": "subscribe",
                        "bars": selected,
                        "updatedBars": selected,
                    }
                )
            )
            while True:
                events = await self._events(socket)
                for event in events:
                    if event.get("T") == "subscription":
                        if not all(
                            set(selected).issubset(event.get(channel, []))
                            for channel in ("bars", "updatedBars")
                        ):
                            raise MarketDataError("Alpaca did not confirm all bar subscriptions")
                        return events

    async def bars(
        self,
        tickers: list[str] | tuple[str, ...],
        *,
        on_connected: Callable[[], Awaitable[None]] | None = None,
    ) -> AsyncIterator[Candle]:
        selected = symbols(tickers)
        failures = 0
        while True:
            try:
                async with self._connect(
                    self.settings.stream_url,
                    open_timeout=self.settings.timeout,
                    ping_interval=20,
                    ping_timeout=20,
                    max_queue=16,
                ) as socket:
                    pending = await self._subscribe(socket, selected)
                    if on_connected:
                        await on_connected()
                    while True:
                        for event in pending:
                            if event.get("T") in {"b", "u"}:
                                if event.get("S") not in selected:
                                    raise MarketDataError("Unexpected symbol in Alpaca stream")
                                candle = Candle.from_alpaca(
                                    event["S"],
                                    event,
                                    "1Min",
                                    self.settings.feed,
                                )
                                failures = 0
                                yield candle
                        pending = await self._events(socket)
            except InvalidStatus as exc:
                if exc.response.status_code not in {429, 500, 502, 503, 504}:
                    raise MarketDataError("Alpaca WebSocket handshake rejected") from None
            except (OSError, ConnectionClosed, TimeoutError):
                pass
            if failures >= self.settings.max_retries:
                raise MarketDataError("Alpaca stream disconnected after retries")
            await self._sleep(min(2**failures, 30) + random.uniform(0, 0.25))
            failures += 1

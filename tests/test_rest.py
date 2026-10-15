from datetime import UTC, datetime, timedelta

import httpx
import pytest

from trademind.market_data.alpaca import AlpacaClient
from trademind.market_data.models import MarketDataError

START = datetime(2026, 10, 1, tzinfo=UTC)


def test_history_paginates_across_symbols(settings, raw_bar):
    requests = []

    def handler(request):
        requests.append(request)
        assert request.headers["APCA-API-KEY-ID"] == "test-key"
        assert request.url.params["feed"] == "iex"
        assert request.url.params["asof"] == "-"
        if len(requests) == 1:
            return httpx.Response(200, json={"bars": {"AAPL": [raw_bar]}, "next_page_token": "p2"})
        assert request.url.params["page_token"] == "p2"
        return httpx.Response(200, json={"bars": {"MSFT": [raw_bar]}, "next_page_token": None})

    with AlpacaClient(
        settings, transport=httpx.MockTransport(handler), sleep=lambda _: None
    ) as client:
        pages = list(
            client.historical_pages(["AAPL", "MSFT"], "1Min", START, START + timedelta(days=1))
        )
    assert [[bar.symbol for bar in page] for page in pages] == [["AAPL"], ["MSFT"]]
    assert len(requests) == 2


def test_empty_page_still_follows_token(settings, raw_bar):
    responses = iter(
        [
            {"bars": None, "next_page_token": "next"},
            {"bars": {"AAPL": [raw_bar]}, "next_page_token": None},
        ]
    )
    with AlpacaClient(
        settings,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=next(responses)),
        ),
        sleep=lambda _: None,
    ) as client:
        pages = list(client.historical_pages(["AAPL"], "1Min", START))
    assert len(pages) == 2 and len(pages[0]) == 0 and len(pages[1]) == 1


def test_repeated_page_token_fails(settings):
    with AlpacaClient(
        settings,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"bars": {}, "next_page_token": "same"}),
        ),
        sleep=lambda _: None,
    ) as client:
        with pytest.raises(MarketDataError, match="pagination"):
            list(client.historical_pages(["AAPL"], "1Min", START))


@pytest.mark.parametrize("status", [401, 403, 400])
def test_access_errors_do_not_retry_or_echo_body(settings, status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, text="test-secret")

    with AlpacaClient(settings, transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(MarketDataError) as error:
            client.latest(["AAPL"])
    assert len(requests) == 1 and "test-secret" not in str(error.value)


def test_retries_rate_limit_server_and_transport_errors(settings, raw_bar):
    requests, waits = [], []

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": "2"})
        if len(requests) == 2:
            return httpx.Response(503)
        return httpx.Response(200, json={"bars": {"AAPL": raw_bar}})

    with AlpacaClient(
        settings, transport=httpx.MockTransport(handler), sleep=waits.append
    ) as client:
        assert client.latest(["AAPL"])[0].timeframe == "1Min"
    assert waits[0] == 2 and len(requests) == 3

    def broken(request):
        raise httpx.ConnectError("test-secret", request=request)

    with AlpacaClient(
        settings, transport=httpx.MockTransport(broken), sleep=lambda _: None
    ) as client:
        with pytest.raises(MarketDataError, match="after retries") as error:
            client.latest(["AAPL"])
    assert error.value.__cause__ is None and "test-secret" not in str(error.value)


def test_rate_throttling(settings):
    waits = []
    with AlpacaClient(
        settings,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"bars": {}}),
        ),
        clock=lambda: 10,
        sleep=waits.append,
    ) as client:
        client.latest(["AAPL"])
        client.latest(["AAPL"])
    assert waits == [60 / settings.requests_per_minute]


@pytest.mark.parametrize("payload", [[], {}, {"bars": []}, {"bars": {"TSLA": []}}])
def test_bad_payload_fails(settings, payload):
    with AlpacaClient(
        settings,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=payload),
        ),
    ) as client:
        with pytest.raises(MarketDataError):
            client.latest(["AAPL"])


def test_invalid_range_fails_before_request(settings):
    with AlpacaClient(
        settings,
        transport=httpx.MockTransport(
            lambda _: pytest.fail("Must not send a request"),
        ),
    ) as client:
        with pytest.raises(ValueError):
            list(client.historical_pages(["AAPL"], "1Min", START, START))

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from trademind.market_data.alpaca import AlpacaClient
from trademind.market_data.config import Settings
from trademind.market_data.models import MarketDataError, symbols, timeframe

app = FastAPI(
    title="TradeMind Backend API",
    version="0.1.0",
)

# Allow Moshope's frontend to communicate with the backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "TradeMind Backend",
    }


@app.get("/api/v1/strategies")
def get_strategies():
    return {
        "strategies": [
            {
                "id": "moving_average_crossover",
                "name": "Moving Average Crossover",
                "parameters": {
                    "short_window": 20,
                    "long_window": 50,
                },
                "supported_modes": ["cpu"],
            }
        ]
    }


@app.get("/api/v1/market-data")
async def get_market_data(
    symbol: str = "AAPL",
    frame: str = Query(default="1Day", alias="timeframe"),
    limit: int = Query(default=200, ge=1, le=1000),
):
    try:
        ticker = symbols([symbol])[0]
        validated_frame = timeframe(frame)

        # Choose a historical range for the requested timeframe.
        now = datetime.now(UTC)
        lookback_days = {
            "1Day": limit * 3,
            "1Week": limit * 10,
            "1Month": limit * 40,
        }.get(validated_frame, 30)

        start = now - timedelta(days=lookback_days)

        settings = Settings.from_env()

        def fetch_candles():
            candles = []

            with AlpacaClient(settings) as client:
                for page in client.historical_pages(
                    tickers=[ticker],
                    frame=validated_frame,
                    start=start,
                    end=now,
                ):
                    candles.extend(page)

            return candles[-limit:]

        candles = await run_in_threadpool(fetch_candles)

        return {
            "symbol": ticker,
            "timeframe": validated_frame,
            "count": len(candles),
            "candles": [candle.to_json() for candle in candles],
        }

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except MarketDataError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc

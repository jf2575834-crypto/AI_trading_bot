"""Credentials come from environment variables and are excluded from repr."""

import math
import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    api_key: str = field(repr=False)
    secret_key: str = field(repr=False)
    database_url: str = field(default="", repr=False)
    feed: str = "iex"
    timeout: float = 15.0
    max_retries: int = 5
    requests_per_minute: int = 180

    def __post_init__(self) -> None:
        if not self.api_key.strip() or not self.secret_key.strip():
            raise ValueError("Set ALPACA_API_KEY and ALPACA_SECRET_KEY in the environment")
        if self.feed not in {"iex", "sip"}:
            raise ValueError("ALPACA_DATA_FEED must be iex or sip")
        if not math.isfinite(self.timeout) or self.timeout <= 0:
            raise ValueError("MARKET_DATA_TIMEOUT must be positive and finite")
        if not 0 <= self.max_retries <= 20 or not 1 <= self.requests_per_minute <= 10000:
            raise ValueError("Invalid retry count or request rate")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_key=os.getenv("ALPACA_API_KEY", ""),
            secret_key=os.getenv("ALPACA_SECRET_KEY", ""),
            database_url=os.getenv("DATABASE_URL", ""),
            feed=os.getenv("ALPACA_DATA_FEED", "iex"),
            timeout=float(os.getenv("MARKET_DATA_TIMEOUT", "15")),
            max_retries=int(os.getenv("MARKET_DATA_MAX_RETRIES", "5")),
            requests_per_minute=int(os.getenv("MARKET_DATA_REQUESTS_PER_MINUTE", "180")),
        )

    @property
    def headers(self) -> dict[str, str]:
        return {"APCA-API-KEY-ID": self.api_key, "APCA-API-SECRET-KEY": self.secret_key}

    @property
    def stream_url(self) -> str:
        return f"wss://stream.data.alpaca.markets/v2/{self.feed}"

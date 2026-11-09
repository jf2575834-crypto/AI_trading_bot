"""! @brief Define the UTC/Decimal candle contract shared by history and live feeds."""

import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


class MarketDataError(RuntimeError):
    """! @brief A provider request, protocol, or market-data payload could not be processed."""


def symbols(values: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    """! @brief Normalize and validate an explicit list of stock symbols.
    @param values Tickers supplied by a caller or provider response.
    @return Unique uppercase tickers in their original order.
    @exception ValueError If the list is empty or any symbol is malformed.
    """
    result = tuple(dict.fromkeys(value.strip().upper() for value in values))
    if not result or any(not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-/]{0,31}", s) for s in result):
        raise ValueError("Supply explicit ticker symbols, such as AAPL or BRK.B")
    return result


def timeframe(value: str) -> str:
    """! @brief Validate an Alpaca minute, hour, day, week, or month interval.
    @param value Provider interval such as 1Min or 1Day.
    @return The unchanged interval value.
    @exception ValueError If the interval is unsupported or outside provider limits.
    """
    if value in {"1Day", "1Week", "1Month", "2Month", "3Month", "4Month", "6Month", "12Month"}:
        return value
    match = re.fullmatch(r"([1-9][0-9]?)(Min|Hour)", value)
    if match and int(match[1]) <= (59 if match[2] == "Min" else 23):
        return value
    raise ValueError("Use an Alpaca timeframe, such as 1Min, 5Min, 1Hour, or 1Day")


def utc_datetime(value: str | datetime) -> datetime:
    """! @brief Parse an explicit-zone timestamp and normalize it to UTC.
    @param value ISO-8601 string or timezone-aware datetime.
    @return Timezone-aware datetime with UTC offset.
    @exception ValueError If input is malformed or lacks a timezone.
    """
    stamp = (
        datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    )
    if stamp.tzinfo is None or stamp.utcoffset() is None:
        raise ValueError("Timestamp must include a timezone, for example 2026-10-01T00:00:00Z")
    return stamp.astimezone(UTC)


def decimal_value(value: Any) -> Decimal:
    """! @brief Parse a finite nonnegative value within NUMERIC(28,10) precision.
    @param value Integer, Decimal, or decimal-like string; floats are converted via text.
    @return Exact Decimal with no rounding.
    @exception ValueError For booleans, negatives, nonfinite values, or excess precision.
    """
    if isinstance(value, bool):
        raise ValueError("Boolean is not a price or volume")
    try:
        result = Decimal(str(value))
    except (ValueError, InvalidOperation) as exc:
        raise ValueError("Invalid price or volume") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("Price and volume must be finite and nonnegative")
    # Storage uses NUMERIC(28, 10); reject values that would silently be rounded.
    if result >= Decimal("1e18") or result != result.quantize(Decimal("1e-10")):
        raise ValueError("Price or volume exceeds storage precision")
    return result


@dataclass(frozen=True)
class Candle:
    """! @brief One immutable raw USD OHLCV bar with explicit source and UTC time.
    Prices and volume use Decimal so JSON and database storage preserve precision.
    """

    symbol: str
    timestamp: datetime
    timeframe: str
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    provider: str = "alpaca"
    feed: str = "iex"
    adjustment: str = "raw"
    currency: str = "USD"

    def __post_init__(self) -> None:
        """! @brief Normalize and validate ticker, interval, timestamps, and OHLCV values.
        @exception ValueError For inconsistent prices, invalid intervals or unsupported provenance.
        """
        object.__setattr__(self, "symbol", symbols([self.symbol])[0])
        object.__setattr__(self, "timestamp", utc_datetime(self.timestamp))
        timeframe(self.timeframe)
        for field in ("open", "high", "low", "close", "volume"):
            object.__setattr__(self, field, decimal_value(getattr(self, field)))
        if self.low > min(self.open, self.close) or self.high < max(self.open, self.close):
            raise ValueError("OHLC values are inconsistent")
        if not self.provider or not self.feed or self.adjustment != "raw" or self.currency != "USD":
            raise ValueError(
                "This ingestion contract supports raw USD bars with explicit provenance"
            )

    @classmethod
    def from_alpaca(cls, symbol: str, payload: dict, frame: str, feed: str) -> "Candle":
        """! @brief Convert one Alpaca bar payload into the shared candle contract.
        @param symbol Requested ticker.
        @param payload Alpaca bar fields `t`, `o`, `h`, `l`, `c`, and `v`.
        @param frame Provider interval for the request.
        @param feed Feed used to retrieve this bar, IEX or SIP.
        @return Validated UTC-aware candle with Decimal OHLCV values.
        @exception MarketDataError If a required field or value is invalid.
        """
        try:
            return cls(
                symbol=symbol,
                timestamp=utc_datetime(payload["t"]),
                timeframe=frame,
                open=payload["o"],
                high=payload["h"],
                low=payload["l"],
                close=payload["c"],
                volume=payload["v"],
                feed=feed,
            )
        except (KeyError, ValueError, TypeError, AttributeError, InvalidOperation) as exc:
            raise MarketDataError("Invalid Alpaca OHLCV bar") from exc

    def to_json(self) -> dict:
        """! @brief Serialize a candle with UTC ISO time and decimal-string values.
        @return JSON-compatible fields preserving exact price and volume precision.
        """
        values = asdict(self)
        values["timestamp"] = self.timestamp.isoformat().replace("+00:00", "Z")
        for field in ("open", "high", "low", "close", "volume"):
            values[field] = str(values[field])
        return values

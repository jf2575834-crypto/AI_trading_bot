"""! @brief Freeze historical candles for repeatable offline strategy and FPGA inputs."""

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from .models import Candle, utc_datetime


def _digest(payload: dict) -> str:
    """! @brief Hash canonical UTF-8 JSON, independent of file indentation or key order.
    @param payload Version, requested range and decimal-string candles to fingerprint.
    @return SHA-256 hex digest for comparing dataset inputs, not authenticating their source.
    """
    data = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class HistoricalDataset:
    """! @brief One validated series with UTC range and a reproducible content identifier."""

    candles: tuple[Candle, ...]
    requested_start: datetime
    requested_end: datetime
    sha256: str

    @property
    def closes(self) -> tuple[Decimal, ...]:
        """! @brief Expose chronological USD closes without hardware-specific rounding.
        @return Decimal prices in the same order as candles; no missing bars are synthesized.
        """
        return tuple(candle.close for candle in self.candles)


def _validate(candles: tuple[Candle, ...], start: datetime, end: datetime, min_bars: int):
    """! @brief Reject empty, undersized, mixed, duplicate or unordered series.
    @param candles Normalized candles from a single symbol/feed/timeframe.
    @param start Inclusive UTC requested beginning.
    @param end Inclusive UTC requested end.
    @param min_bars Minimum usable sample count requested by the consumer.
    @exception ValueError If any series or range requirement fails.
    """
    if min_bars < 1 or end <= start:
        raise ValueError("Minimum bars must be positive and end must be after start")
    if len(candles) < min_bars:
        raise ValueError(f"Need at least {min_bars} candles; found {len(candles)}")
    first = candles[0]
    fields = ("symbol", "provider", "feed", "timeframe", "adjustment", "currency")
    identity = tuple(getattr(first, field) for field in fields)
    previous = None
    for candle in candles:
        if tuple(getattr(candle, field) for field in fields) != identity:
            raise ValueError("Dataset must contain one symbol, provider, feed and timeframe")
        if not start <= candle.timestamp <= end:
            raise ValueError("Candle falls outside the requested range")
        if previous is not None and candle.timestamp <= previous:
            raise ValueError("Candle timestamps must be unique and ascending")
        previous = candle.timestamp


def save_dataset(
    path: str | Path,
    candles: tuple[Candle, ...],
    start: datetime,
    end: datetime,
    *,
    min_bars: int = 1,
) -> HistoricalDataset:
    """! @brief Write a new versioned JSON snapshot with exact decimal-string prices.
    @param path New file location; parent directory must exist and files are never overwritten.
    @param candles Chronological candles of one series, with explicit feed provenance.
    @param start Inclusive timezone-aware requested beginning; saved as UTC.
    @param end Inclusive timezone-aware requested end; saved as UTC.
    @param min_bars Consumer's minimum sample count, including strategy warmup if needed.
    @return Snapshot with a SHA-256 identifier covering the range and all candle fields.
    @exception ValueError If the series is invalid or too short.
    @exception OSError If the destination exists or cannot be written.
    """
    candles = tuple(candles)
    start, end = utc_datetime(start), utc_datetime(end)
    _validate(candles, start, end, min_bars)
    payload = {
        "schema_version": 1,
        "requested_start": start.isoformat().replace("+00:00", "Z"),
        "requested_end": end.isoformat().replace("+00:00", "Z"),
        "candles": [candle.to_json() for candle in candles],
    }
    fingerprint = _digest(payload)
    document = {**payload, "sha256": fingerprint}
    with Path(path).open("x", encoding="utf-8", newline="\n") as target:
        target.write(json.dumps(document, indent=2, allow_nan=False) + "\n")
    return HistoricalDataset(candles, start, end, fingerprint)


def load_dataset(path: str | Path, *, min_bars: int = 1) -> HistoricalDataset:
    """! @brief Load and verify a saved dataset without an API key or database connection.
    @param path JSON snapshot previously produced by save_dataset.
    @param min_bars Required sample count; agree strategy warmup with the algorithm owner.
    @return Immutable chronological candles, Decimal closes, UTC range and SHA-256 identifier.
    @exception ValueError If JSON, checksum, candle fields or series constraints are invalid.
    @exception OSError If the input cannot be read.
    """
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Expected a dataset object")
        fingerprint = payload.pop("sha256")
        if payload["schema_version"] != 1 or fingerprint != _digest(payload):
            raise ValueError("Unsupported dataset version or checksum mismatch")
        start, end = (
            utc_datetime(payload["requested_start"]),
            utc_datetime(payload["requested_end"]),
        )
        candles = tuple(Candle(**row) for row in payload["candles"])
        _validate(candles, start, end, min_bars)
    except (KeyError, TypeError, AttributeError, ArithmeticError, ValueError) as exc:
        raise ValueError("Invalid dataset; check its format, checksum and candle series") from exc
    return HistoricalDataset(candles, start, end, fingerprint)

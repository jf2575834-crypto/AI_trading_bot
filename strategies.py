"""Technical trading strategies over OHLC candle data (no external deps)."""
from __future__ import annotations
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional, Sequence
import json


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class InsufficientDataError(ValueError):
    pass


class InvalidParameterError(ValueError):
    pass


@dataclass(frozen=True)
class Candle:
    open: float
    high: float
    low: float
    close: float
    timestamp: Optional[str] = None

    def __post_init__(self):
        vals = (self.open, self.high, self.low, self.close)
        if any(v is None or v != v for v in vals):  # None or NaN
            raise ValueError("Candle values must be numbers")
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ValueError("Inconsistent OHLC: high/low must bound open/close")

    @property
    def bullish(self) -> bool: return self.close > self.open
    @property
    def bearish(self) -> bool: return self.close < self.open
    @property
    def body_top(self) -> float: return max(self.open, self.close)
    @property
    def body_bottom(self) -> float: return min(self.open, self.close)


@dataclass(frozen=True)
class Result:
    signal: Signal
    reason: str
    detail: Optional[dict] = None


def sma(values: Sequence[float], period: int, end: Optional[int] = None) -> float:
    """Simple moving average of `period` values ending at index `end` (exclusive; default: last)."""
    end = len(values) if end is None else end
    if period <= 0 or end < period:
        raise InsufficientDataError(f"Need {period} values, have {end}")
    return sum(values[end - period:end]) / period


# ---------------------------------------------------------------- parameters
@dataclass(frozen=True)
class CrossoverParams:
    short_period: int = 20
    long_period: int = 50
    predict_horizon: int = 5       # candles ahead to project a cross
    predict_threshold: float = 0.0 # min gap-closing speed to call a prediction

    def __post_init__(self):
        for n in ("short_period", "long_period", "predict_horizon"):
            v = getattr(self, n)
            if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
                raise InvalidParameterError(f"{n} must be a positive integer")
        if self.short_period >= self.long_period:
            raise InvalidParameterError("short_period must be less than long_period")

    @classmethod
    def from_dict(cls, d: dict) -> "CrossoverParams":
        allowed = set(cls.__dataclass_fields__)
        unknown = set(d) - allowed
        if unknown:
            raise InvalidParameterError(f"Unknown parameters: {sorted(unknown)}")
        return cls(**d)


@dataclass(frozen=True)
class ReversalParams:
    trend_lookback: int = 3        # candles that must show the prior trend
    min_trend_move: float = 0.0    # min fractional move over the lookback (0.02 = 2%)

    def __post_init__(self):
        if not isinstance(self.trend_lookback, int) or isinstance(self.trend_lookback, bool) or self.trend_lookback < 1:
            raise InvalidParameterError("trend_lookback must be a positive integer")
        if self.min_trend_move < 0:
            raise InvalidParameterError("min_trend_move must be >= 0")

    @classmethod
    def from_dict(cls, d: dict) -> "ReversalParams":
        unknown = set(d) - set(cls.__dataclass_fields__)
        if unknown:
            raise InvalidParameterError(f"Unknown parameters: {sorted(unknown)}")
        return cls(**d)


# ---------------------------------------------------------------- strategies
class MovingAverageCrossover:
    """Golden cross -> BUY, death cross -> SELL, otherwise HOLD. Also projects upcoming crosses."""

    def __init__(self, params: CrossoverParams = CrossoverParams()):
        self.p = params

    def _series(self, candles: Sequence[Candle]):
        closes = [c.close for c in candles]
        # need previous AND current long SMA -> long_period + 1 candles
        if len(closes) < self.p.long_period + 1:
            raise InsufficientDataError(
                f"Need at least {self.p.long_period + 1} candles, have {len(closes)}")
        n = len(closes)
        s_prev, s_now = sma(closes, self.p.short_period, n - 1), sma(closes, self.p.short_period)
        l_prev, l_now = sma(closes, self.p.long_period, n - 1), sma(closes, self.p.long_period)
        return s_prev, s_now, l_prev, l_now

    def evaluate(self, candles: Sequence[Candle]) -> Result:
        s_prev, s_now, l_prev, l_now = self._series(candles)
        d = {"short_sma": s_now, "long_sma": l_now}
        if s_prev <= l_prev and s_now > l_now:
            return Result(Signal.BUY, "Golden Cross: short SMA crossed above long SMA", d)
        if s_prev >= l_prev and s_now < l_now:
            return Result(Signal.SELL, "Death Cross: short SMA crossed below long SMA", d)
        return Result(Signal.HOLD, "No crossover", d)

    def predict_cross(self, candles: Sequence[Candle]) -> Optional[dict]:
        """Linear projection of the gap (short - long). Returns the expected cross type and
        the estimated number of candles until it happens, or None if the gap isn't closing
        or the cross is beyond `predict_horizon`."""
        s_prev, s_now, l_prev, l_now = self._series(candles)
        gap_prev, gap_now = s_prev - l_prev, s_now - l_now
        speed = gap_now - gap_prev            # change in gap per candle
        if gap_now == 0 or speed == 0:
            return None
        closing = (gap_now > 0 and speed < 0) or (gap_now < 0 and speed > 0)
        if not closing or abs(speed) <= self.p.predict_threshold:
            return None
        eta = -gap_now / speed
        if eta > self.p.predict_horizon:
            return None
        return {"type": "GOLDEN_CROSS" if gap_now < 0 else "DEATH_CROSS",
                "estimated_candles": round(eta, 2)}


class CandlestickReversal:
    """Engulfing patterns confirmed by the preceding trend."""

    def __init__(self, params: ReversalParams = ReversalParams()):
        self.p = params

    def _trend(self, prior: Sequence[Candle]) -> int:
        """+1 uptrend, -1 downtrend, 0 none, using closes of the candles before the pattern."""
        closes = [c.close for c in prior[-self.p.trend_lookback:]]
        if len(closes) < self.p.trend_lookback:
            raise InsufficientDataError("Not enough candles to establish a trend")
        first, last = closes[0], closes[-1]
        if first == 0:
            return 0
        move = (last - first) / abs(first)
        rising = all(b >= a for a, b in zip(closes, closes[1:]))
        falling = all(b <= a for a, b in zip(closes, closes[1:]))
        if rising and move > self.p.min_trend_move: return 1
        if falling and -move > self.p.min_trend_move: return -1
        return 0

    @staticmethod
    def is_bullish_engulfing(prev: Candle, cur: Candle) -> bool:
        return (prev.bearish and cur.bullish
                and cur.open <= prev.close and cur.close >= prev.open)

    @staticmethod
    def is_bearish_engulfing(prev: Candle, cur: Candle) -> bool:
        return (prev.bullish and cur.bearish
                and cur.open >= prev.close and cur.close <= prev.open)

    def evaluate(self, candles: Sequence[Candle]) -> Result:
        need = self.p.trend_lookback + 2
        if len(candles) < need:
            raise InsufficientDataError(f"Need at least {need} candles, have {len(candles)}")
        prev, cur = candles[-2], candles[-1]
        trend = self._trend(candles[:-1])
        if self.is_bullish_engulfing(prev, cur) and trend == -1:
            return Result(Signal.BUY, "Bullish engulfing after downtrend")
        if self.is_bearish_engulfing(prev, cur) and trend == 1:
            return Result(Signal.SELL, "Bearish engulfing after uptrend")
        return Result(Signal.HOLD, "No qualifying pattern")


# ---------------------------------------------------------------- config storage
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS strategy_configs (
    name        TEXT PRIMARY KEY,
    strategy    TEXT NOT NULL,
    params      JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

STRATEGIES = {
    "ma_crossover": (MovingAverageCrossover, CrossoverParams),
    "candlestick_reversal": (CandlestickReversal, ReversalParams),
}


def build_strategy(kind: str, params: Optional[dict] = None):
    """Validate params and build a strategy; raises InvalidParameterError on bad input."""
    if kind not in STRATEGIES:
        raise InvalidParameterError(f"Unknown strategy '{kind}'")
    strat_cls, params_cls = STRATEGIES[kind]
    return strat_cls(params_cls.from_dict(params or {}))


class PostgresConfigStore:
    """Saves/loads validated strategy params. `conn` is any DB-API connection (e.g. psycopg.connect(...))."""

    def __init__(self, conn):
        self.conn = conn
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
        conn.commit()

    def save(self, name: str, kind: str, params: dict) -> None:
        build_strategy(kind, params)  # validate before persisting
        with self.conn.cursor() as cur:
            cur.execute(
                """INSERT INTO strategy_configs (name, strategy, params) VALUES (%s, %s, %s)
                   ON CONFLICT (name) DO UPDATE
                   SET strategy = EXCLUDED.strategy, params = EXCLUDED.params, updated_at = now()""",
                (name, kind, json.dumps(params)))
        self.conn.commit()

    def load(self, name: str):
        with self.conn.cursor() as cur:
            cur.execute("SELECT strategy, params FROM strategy_configs WHERE name = %s", (name,))
            row = cur.fetchone()
        if row is None:
            raise KeyError(name)
        kind, params = row
        return build_strategy(kind, params if isinstance(params, dict) else json.loads(params))

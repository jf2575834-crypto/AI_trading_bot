"""! @brief Verify locally downloaded demo snapshots without network or credentials.
Run from any directory using the repository's Python environment. Data files must
already exist under data/local; see docs/prototype-market-data.md.
"""

import argparse
import json
from pathlib import Path

from trademind.market_data.datasets import load_dataset


def main() -> int:
    """! @brief Verify minute or daily AAPL/MSFT snapshots selected on the command line.
    Daily inputs require at least 51 candles for consecutive 50-period windows.
    @return Zero after both snapshots pass validation, or one if unavailable or invalid.
    """
    parser = argparse.ArgumentParser(description="Verify offline TradeMind demo datasets")
    parser.add_argument("--timeframe", choices=("1Min", "1Day"), default="1Min")
    args = parser.parse_args()
    if args.timeframe == "1Day":
        suffix, minimum = "1day-2026-05-01-to-2026-11-06", 51
    else:
        suffix, minimum = "1min-2026-10-16", 100
    root = Path(__file__).resolve().parents[1]
    for symbol in ("aapl", "msft"):
        path = root / "data" / "local" / f"{symbol}-iex-{suffix}-v1.json"
        try:
            dataset = load_dataset(path, min_bars=minimum)
            if any(
                c.symbol != symbol.upper()
                or c.timeframe != args.timeframe
                or c.feed != "iex"
                or c.provider != "alpaca"
                for c in dataset.candles
            ):
                raise ValueError("Dataset does not match the selected symbol, interval or feed")
        except (OSError, ValueError):
            print(f"Cannot load {path.name}; see docs/prototype-market-data.md")
            return 1
        print(
            json.dumps(
                {
                    "symbol": dataset.candles[0].symbol,
                    "timeframe": args.timeframe,
                    "bars": len(dataset.candles),
                    "first_utc": dataset.candles[0].to_json()["timestamp"],
                    "last_utc": dataset.candles[-1].to_json()["timestamp"],
                    "sha256": dataset.sha256,
                }
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""! @brief Verify locally downloaded demo snapshots without network or credentials.
Run from any directory using the repository's Python environment. Data files must
already exist under data/local; see docs/prototype-market-data.md.
"""

import json
from pathlib import Path

from trademind.market_data.datasets import load_dataset


def main() -> int:
    """! @brief Load the AAPL/MSFT snapshots and print counts, UTC ranges and identifiers.
    @return Zero after both snapshots pass validation, or one if unavailable or invalid.
    """
    root = Path(__file__).resolve().parents[1]
    for symbol in ("aapl", "msft"):
        path = root / "data" / "local" / f"{symbol}-iex-1min-2026-10-16-v1.json"
        try:
            dataset = load_dataset(path, min_bars=100)
        except (OSError, ValueError):
            print(f"Cannot load {path.name}; see docs/prototype-market-data.md")
            return 1
        print(
            json.dumps(
                {
                    "symbol": dataset.candles[0].symbol,
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

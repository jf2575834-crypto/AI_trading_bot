# TradeMind market-data API reference

This reference is generated from the Doxygen docstrings in Joel's market-data
code from [PR #2](https://github.com/jf2575834-crypto/AI_trading_bot/pull/2),
[PR #5](https://github.com/jf2575834-crypto/AI_trading_bot/pull/5), and
[PR #11](https://github.com/jf2575834-crypto/AI_trading_bot/pull/11). PR #3 changed
the README only, so it has no source code to annotate.

It covers the `trademind.market_data` package and its offline dataset example,
including provider requests, streaming, candle validation, database storage,
historical snapshots, and command-line operation. The existing comments describe
the API contracts, units, timestamps, return values, errors, and storage side effects.

## Open the generated HTML

Each push or pull request builds the HTML reference as a GitHub Actions artifact.
Open the repository's **Actions** tab, select the **Build API reference** run for
the branch or pull request, and download **TradeMind-API-Reference**. Unzip it and
open `html/index.html` in a browser. GitHub keeps workflow artifacts for up to 90
days, subject to repository settings.

You can read this overview and the source comments in the repository any time.
To build the HTML locally, install Doxygen, run `doxygen Doxyfile` from the repository
root, and open `build/doxygen/html/index.html`.

# Team Project: TradeMind: AI-Enhanced Automated Trading System
Team Members:
Gabriel Chambers — gabriel.chambers@bulldogs.aamu.edu
Joel Friedman — joel.friedman@bulldogs.aamu.edu 
Xa-Quan Washington  — xaquan.washingto@bulldogs.aamu.edu 
Olayiwola Ajibode — olayiwola.ajibod@bulldogs.aamu.edu
Moshopefoluwa Omotoso — moshopefoluwa.om@bulldogs.aamu.edu 
Alejandro Rosa - alejandro.rose@bulldogs.aamu.edu
Team Project Title:
TradeMind: AI-Enhanced Automated Trading System
Type of Software
# Hardware + Software Hybrid Application
The system will combine a user-facing software application, automated trading engine, AI analysis, database, APIs, and FPGA hardware acceleration.
The trading system may be packaged as a stand-alone executable while also providing web-based access to selected features.
# Users
Retail traders who want to automate trading strategies instead of constantly monitoring the market.
New traders who want to test automated strategies through paper trading before risking real money.
Users who want more control over automated trading through configurable risk settings and optional trade approval.
Users interested in strategies based on both technical market indicators and publicly available financial disclosures.
# Database
PostgreSQL
Store user profiles and preferences.
Store trading strategies and settings.
Store trade history and bot decisions.
Store portfolio and performance information.
Store AI analysis results.
Store system and security logs.
# APIs
Broker/Trading API
Used for paper trading and automated order execution.
Webull or another compatible broker API will be evaluated based on availability.
Market Data API
Provides historical and current market data needed by the trading strategies, AI analysis, and backtesting system.
Financial Disclosure Data
Public congressional and institutional financial disclosure data will be collected for the disclosure-following strategy.
The team will evaluate available APIs or public data sources for retrieving this information.

# Market Data Module (KAN-6)
Historical/latest stock candles, live WebSocket ingestion, and PostgreSQL storage
are implemented in `src/trademind/market_data`.

See [setup, usage, provider evaluation, and database handoff](docs/market-data.md).
Requires Python 3.11+. Install with `python -m pip install -e '.[dev]'` and run
`trademind-data --help`. Run the tests with `python -m pytest -q`.

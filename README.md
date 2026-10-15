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

# Features 
User Account & Trading Preferences
Users can create an account and configure trading preferences, strategy settings, investment limits, risk settings, and automation preferences.
Market Data Processing
The system will collect and process historical and current market data for use by the trading engine.
Multi-Strategy Trading Engine
The system will support multiple approaches for generating trade signals.
Technical strategies will include trend-following methods such as moving-average crossovers and candlestick reversal patterns such as bullish engulfing.
The system will also analyze publicly available congressional and institutional financial disclosures to identify potential trading signals.
AI Trade Analysis
AI will analyze market information, historical performance, and previous bot trades.
The AI component will identify patterns and recommend potential improvements to trading strategies.
Recommended changes can be evaluated through backtesting before being incorporated into the trading strategy.
Risk Management
Users can establish controls such as maximum position sizes, stop-loss rules, investment limits, and exposure limits.
The trading engine will check these rules before executing a trade.
Optional Trade Approval & Override Mode
Users can turn the trade approval feature on or off.
When enabled, users receive a notification before a trade is executed and are given a countdown period to approve, reject, or override the trade.
When disabled, the system can automatically execute trades according to the user's predefined strategy and risk settings.
Automated Trade Execution
The trading engine will communicate with a broker API to submit trades based on generated signals and the user's selected automation settings.
The system will initially focus on simulated/paper trading for development and testing.
Paper Trading / Simulation Mode
Users can run the trading bot with simulated money while using real market data.
This allows users to evaluate the bot and its strategies without risking actual capital.
Paper trading can operate with either automatic execution or the optional trade approval feature.
Historical Backtesting
Users can test trading strategies against historical market data.
The system will report how strategies would have performed before they are tested through live paper trading.
Trading Dashboard & Performance Reports
Users can monitor bot activity, trade history, portfolio performance, strategy results, and AI analysis.
The dashboard will provide information explaining the system's trading activity and performance.
Trade Decision Logging
The system will record trade decisions, relevant inputs, signals, execution results, and performance.
Logs can be used for debugging, performance analysis, AI analysis, and auditing.
Cybersecurity & Data Protection
User authentication and authorization will protect accounts and system functionality.
Sensitive information such as API credentials will be securely stored.
Secure API communication, input validation, access controls, and logging will be incorporated into the system design.
Security will be considered throughout the software development lifecycle rather than added only after implementation.
FPGA Hardware Acceleration
FPGA hardware will be used if an appropriate board is provided by the university.
Selected trading or data-processing algorithms can be implemented on both the CPU and FPGA.
The team will compare CPU and FPGA execution times to determine whether hardware acceleration reduces processing and trade-signal latency.
The software will remain functional without FPGA hardware if the necessary board is unavailable.


# Market Data Module (KAN-6)
Historical/latest stock candles, live WebSocket ingestion, and PostgreSQL storage
are implemented in `src/trademind/market_data`.

See [setup, usage, provider evaluation, and database handoff](docs/market-data.md).
Requires Python 3.11+. Install with `python -m pip install -e '.[dev]'` and run
`trademind-data --help`. Run the tests with `python -m pytest -q`.

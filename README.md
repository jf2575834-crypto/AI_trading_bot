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

## Get real-time market data (Alpaca)

The current module streams **one-minute US stock candles** from Alpaca, stores them
in the database, and prints each persisted live event as a JSON line. These commands
retrieve data only; they do not place trades. Alpaca's MCP server is not required.

### 1. Get Alpaca API keys

Sign in to the [Alpaca dashboard](https://app.alpaca.markets/account/login), select
**Paper Trading**, and generate a Key ID and Secret Key in the **API Keys** panel.
Use your own keys and keep them out of Git, screenshots, and chat.

The free Basic stock feed is **IEX (Investors Exchange)**: real-time activity from
one exchange, rather than the entire US stock market. Basic allows up to 30 streamed
symbols. Consolidated real-time SIP data requires an appropriate subscription;
selecting `sip` alone does not grant access. See
[Alpaca's current plans](https://docs.alpaca.markets/us/docs/about-market-data-api).

### 2. Install from the repository folder

Open the repository in VS Code and choose **Terminal > New Terminal**. These commands
use Windows PowerShell and Python 3.11 or later. Skip environment creation if this
checkout already has a working `.venv`.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.[dev]'
```

### 3. Save and load your configuration

Open the local configuration file (Notepad can create it if it does not exist):

```powershell
notepad .env.alpaca
```

Enter the following, replace the two placeholders, and save. Use plain values without
quotes; keep any existing working keys. SQLite provides a local demonstration without
setting up a PostgreSQL server.

```dotenv
ALPACA_API_KEY=your_key_id
ALPACA_SECRET_KEY=your_secret_key
ALPACA_DATA_FEED=iex
DATABASE_URL=sqlite:///market_data.db
```

`.env.alpaca` is ignored by Git. `.env.example` is a shared template and must not
contain real credentials. **The CLI does not automatically read `.env` files.**
Load the saved values into this PowerShell session:

```powershell
Get-Content .env.alpaca | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)=(.*)$') {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim()
    }
}
```

Repeat that loading command after editing the file or opening a new terminal.
For the team's database, replace `DATABASE_URL` with your PostgreSQL connection
string; `init-db` creates the development table, not the PostgreSQL database itself.

### 4. Check access, then start streaming

```powershell
# One request for the latest available minute candle; no database required.
.\.venv\Scripts\trademind-data.exe latest --symbols AAPL MSFT

# Create the market_candles development table, then receive and store live candles.
.\.venv\Scripts\trademind-data.exe init-db
.\.venv\Scripts\trademind-data.exe stream --symbols AAPL MSFT
```

Leave the terminal open; press **Ctrl+C** to stop. The stream receives completed
minute candles and later corrections, rather than every trade or bid/ask update.
Candles arrive after their minute closes, and their UTC timestamps mark the beginning
of that minute. See [Alpaca's stream documentation](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data).

If no new eligible trading activity occurs, the stream may be quiet and `latest`
may return an older candle, especially outside market hours. An old bar alone does
not establish a feed delay. Missing-key errors mean the environment was not loaded;
authentication or subscription errors require checking the key pair and feed access.

On macOS/Linux, use `.venv/bin/python` and `.venv/bin/trademind-data`, and set the
same environment variables with your shell's `export` syntax. See the
[module guide](docs/market-data.md) for historical backfills, PostgreSQL, and recovery.

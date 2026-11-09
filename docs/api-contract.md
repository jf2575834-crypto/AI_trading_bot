# TradeMind API Contract (frontend ↔ backend)

This document lists the HTTP endpoints the web frontend needs, with request and
response shapes and the rules the server must enforce. It is derived from the
working UI in `frontend/`.

**Status today**

| Area | Status |
|---|---|
| `/auth/*` (sign up, log in, log out, current user) | Implemented in `src/trademind/api/app.py` |
| Everything else in this document | Not implemented. The UI runs on a demo simulation in `frontend/src/data/service.ts` |

The TypeScript types in `frontend/src/data/types.ts` are the source of truth for
the response shapes below. If an endpoint returns exactly those shapes, wiring it
into the UI is a one-line change in `service.ts` (see [Switching the frontend over](#switching-the-frontend-over)).

---

## Conventions

- **Base path.** New endpoints live under `/api` (for example `GET /api/portfolio`) so
  the Vite dev proxy needs one rule. `/auth/*` stays where it is.
- **Auth.** Every `/api` endpoint requires `Authorization: Bearer <token>` from
  `POST /auth/login`, and returns **only the signed-in user's data** (REQ-0201).
  Missing, invalid, or expired token → `401`. The UI treats any `401` as
  "session expired" and returns to the login screen.
- **JSON field names are camelCase** (`portfolioValue`, not `portfolio_value`).
  In FastAPI/Pydantic: `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)`
  and return with `response_model_by_alias=True` (the default).
- **Timestamps** are ISO 8601 UTC strings (`2026-11-08T20:06:36Z`). The UI converts
  to the user's timezone. **Market dates** (candles, backtest days) are `YYYY-MM-DD`.
- **Money and quantities** are JSON numbers. Store as `NUMERIC` in PostgreSQL and
  round money to 2 decimal places in responses. Quantities are whole shares.
- **Errors** use FastAPI's shape: `{"detail": "Human-readable message"}`. The UI
  shows `detail` to the user verbatim, so write it for a user and never include
  stack traces, SQL, or secrets (REQ-0801, REQ-0803).

| Status | Meaning in the UI |
|---|---|
| 400 | Request understood but not allowed (e.g. risk limit breached). `detail` is shown |
| 401 | Not signed in / session expired → back to login |
| 404 | Item not found |
| 409 | Conflict: stale version, already decided, duplicate. `detail` is shown |
| 422 | Validation error (FastAPI default). The first `msg` is shown |
| 5xx | "The server had a problem. Please try again shortly." |

- **Versioned resources** (strategies, risk settings) carry a `version` integer.
  Clients send the version they loaded; the server rejects a stale one with `409`
  and increments it on every successful save (REQ-0303).

---

## Portfolio and activity — Dashboard

### `GET /api/portfolio` → `PortfolioSummary`

```json
{
  "mode": "paper",
  "portfolioValue": 17807.80,
  "availableCash": 8230.17,
  "totalReturnPct": 7.9,
  "totalReturnAmount": 1301.43,
  "dayChange": 65.03,
  "activeStrategies": 2,
  "botStatus": "running",
  "asOf": "2026-11-08T20:07:07Z"
}
```

- `mode`: `"paper" | "live"`. Must be `"paper"` for the prototype (REQ-0401).
- `botStatus`: `"stopped" | "running" | "error"`.
- `asOf`: when the numbers were computed. The UI warns when data is over 2 minutes old (REQ-0202).
- The UI polls this every 30 s while the tab is visible.

### `GET /api/portfolio/performance?range=1W|1M|3M|1Y|ALL` → `{ series: Point[], benchmark: Point[] }`

`Point = { "t": "2026-11-06", "value": 17793.20 }`. Both arrays have the same
length and dates. `benchmark` is the S&P 500 (or SPY) scaled to the portfolio's
starting value for the range.

### `GET /api/positions` → `Position[]`

```json
[{ "symbol": "AAPL", "name": "Apple Inc.", "quantity": 10, "averageCost": 273.32, "currentPrice": 289.01 }]
```

Market value and unrealized P/L are derived by the UI.

### `GET /api/activity?limit=20` → `Activity[]` (newest first)

```json
[{ "id": "a_…", "time": "…Z", "kind": "execution", "side": "BUY", "title": "BUY · AAPL", "detail": "10 shares filled at $273.32" }]
```

- `kind`: `"order" | "execution" | "signal" | "system"`. `side` is optional.

### `GET /api/trades` → `ExecutedTrade[]` (newest first)

```json
[{ "id": "x_…", "time": "…Z", "symbol": "AAPL", "side": "BUY", "quantity": 10, "price": 273.32, "strategyName": "Moving Average Crossover", "source": "approved" }]
```

- `source`: `"manual" | "approved" | "automatic"`. `strategyName` is `null` for manual trades.

---

## Market data — Paper Trading

These can be served from the KAN-6 market data tables (`market_candles`).

### `GET /api/market/quotes` → `Quote[]` (the user's watchlist)
### `GET /api/market/quotes/{symbol}` → `Quote`

```json
{ "symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "price": 191.34, "changePct": 1.28, "asOf": "…Z" }
```

`asOf` is shown next to the estimated price on the order ticket (REQ-0402).
Unknown symbol → `404`.

### `GET /api/market/candles/{symbol}?range=1M|3M|6M|1Y` → `Candle[]` (oldest first, daily)

```json
[{ "t": "2026-11-06", "o": 190.10, "h": 192.40, "l": 189.70, "c": 191.34, "v": 38400000 }]
```

### `GET /api/assets` → `Asset[]`

`{ "symbol", "name", "exchange" }` for every tradable symbol. Used for symbol
dropdowns and ticker validation. (Currently a hard-coded list in `frontend/src/data/market.ts`;
`listAssets()` in `service.ts` is synchronous today and will need to become async.)

---

## Orders — Paper Trading

### `POST /api/orders` → `Order`

Headers: `Idempotency-Key: <uuid>` (required).

```json
{ "symbol": "AAPL", "side": "BUY", "quantity": 2, "orderType": "limit", "limitPrice": 285.00 }
```

Response:

```json
{ "id": "o_…", "symbol": "AAPL", "side": "BUY", "quantity": 2, "orderType": "limit", "limitPrice": 285.00, "price": 285.00, "status": "pending", "createdAt": "…Z" }
```

- `status`: `"pending" | "accepted" | "partially_filled" | "filled" | "rejected" | "cancelled"`.
- **Idempotency (REQ-0403).** The same `Idempotency-Key` from the same user must
  never create a second order, including when two requests arrive at the same
  time. Return the original order (or the original error) for a repeat. A unique
  index on `(user_id, idempotency_key)` handles the race.
- **Validation.** Unknown symbol → `404`. Quantity must be a positive whole
  number; `limitPrice` is required and > 0 for limit orders → `422`.
- **Risk checks are enforced here, not in the UI (REQ-0302).** Reject with `400`
  and a clear `detail` when:
  - order value > `maxPositionSize`;
  - a BUY would push invested value / portfolio value above `maxExposurePct`;
  - a BUY costs more than available cash;
  - a SELL exceeds the shares held.

  A rejected order is still recorded with `status: "rejected"` so it appears in order history.
- **Paper only (REQ-0401).** Orders go to the paper-trading simulator or Alpaca's
  paper endpoint, never a live broker, regardless of the user's settings.

### `GET /api/orders` → `Order[]` (newest first)

The UI shows `pending`/`accepted` as open orders and the rest as history.

### `POST /api/orders/{id}/cancel` → `Order`

Only `pending` or `accepted` orders can be cancelled; otherwise `409` with e.g.
`"This order is already filled and cannot be cancelled."`

---

## Strategies and risk settings

### `GET /api/strategies` → `Strategy[]`

```json
{
  "id": "ma-crossover",
  "name": "Moving Average Crossover",
  "kind": "technical",
  "description": "Generates buy or sell signals when the fast average crosses the slower trend average.",
  "tags": ["Trend following", "Medium frequency"],
  "enabled": true,
  "version": 3,
  "updatedAt": "…Z",
  "paramDefs": [
    { "key": "shortWindow", "label": "Fast period", "kind": "int", "min": 2, "max": 200, "hint": "Number of market periods" },
    { "key": "longWindow", "label": "Slow period", "kind": "int", "min": 3, "max": 400 },
    { "key": "symbols", "label": "Applicable symbols", "kind": "symbols" },
    { "key": "signalThreshold", "label": "Signal threshold (%)", "kind": "decimal", "min": 0, "max": 100 }
  ],
  "params": { "shortWindow": 20, "longWindow": 50, "symbols": ["AAPL", "MSFT"], "signalThreshold": 2.5 }
}
```

- `kind`: `"technical" | "disclosure"`.
- `paramDefs` drives the form: the UI renders and validates whatever parameters
  the server describes, so new strategies need no frontend change.
  `kind` is `"int" | "decimal" | "symbols"`; `symbols` values are string arrays.
- The four strategies the UI currently ships with (ids `ma-crossover`,
  `bullish-engulfing`, `rsi`, `disclosure`) and their parameters are defined in
  `STRATEGY_SEED` in `frontend/src/data/service.ts`.

### `PUT /api/strategies/{id}` → `Strategy`

Body: the full `Strategy` as loaded, with edited `enabled` and/or `params`, and
the `version` the client loaded.

- Stale `version` → `409`.
- Validate every param against its `paramDefs` (`422`), plus cross-field rules:
  `longWindow > shortWindow` for `ma-crossover`, `overbought > oversold` for `rsi` (REQ-0301).
- On success: increment `version`, set `updatedAt`, and record the change in an
  audit/history table (REQ-0303). Enabling or disabling writes an `Activity` entry.

### `GET /api/risk` → `RiskSettings`
### `PUT /api/risk` → `RiskSettings`

```json
{ "maxPositionSize": 2500, "maxExposurePct": 75, "stopLossPct": 5, "takeProfitPct": 12, "dailyLossLimit": 500, "approvalRequired": true, "version": 1, "updatedAt": "…Z" }
```

- Ranges: `maxPositionSize > 0`; `0 < maxExposurePct ≤ 100`; `0 < stopLossPct ≤ 50`;
  `0 < takeProfitPct ≤ 500`; `dailyLossLimit > 0`. Same versioning rules as strategies.
- **These limits must be enforced by the order and trading-engine code paths**
  (`POST /api/orders`, approval execution, automatic trading). The form is only
  a convenience (REQ-0302).
- `approvalRequired: true` means engine-generated trades become pending
  approvals instead of executing.

---

## Backtesting

### `POST /api/backtests` → `BacktestResult`

```json
{
  "strategyId": "ma-crossover",
  "symbol": "AAPL",
  "startDate": "2025-11-08",
  "endDate": "2026-11-08",
  "initialCapital": 10000,
  "feePct": 0.05,
  "slippagePct": 0.05,
  "paramOverrides": { "shortWindow": 15 }
}
```

- Validation (REQ-0501): all fields required; `endDate ≥ startDate`; no future
  dates; `initialCapital ≥ 100`; `0 ≤ feePct, slippagePct ≤ 5`. Ranges with fewer
  than 30 trading days → `400`. Strategies without historical data (e.g.
  disclosure) → `400` with an explanation.
- `paramOverrides` (optional) tests parameter changes without saving them. The
  UI uses it to backtest an AI recommendation before it is accepted.
- **No look-ahead (REQ-0502).** A signal on day *t* may use only data up to and
  including day *t*, and fills at day *t+1*'s open, adjusted for slippage, with
  the fee charged on every fill. `frontend/src/data/market.ts` (`runBacktest`)
  is a working reference implementation of these rules.

Response:

```json
{
  "request": { "...": "echo of the request" },
  "strategyName": "Moving Average Crossover",
  "completedAt": "…Z",
  "finalValue": 11850.00,
  "totalReturnPct": 18.5,
  "benchmarkReturnPct": 11.2,
  "winRate": 61.0,
  "wins": 14,
  "closedTrades": 23,
  "maxDrawdownPct": 8.2,
  "totalTrades": 47,
  "equity": [{ "t": "2025-11-10", "value": 10000 }],
  "benchmark": [{ "t": "2025-11-10", "value": 10000 }],
  "periods": [{ "label": "Q1 26", "strategy": 4.1, "benchmark": 2.3 }],
  "trades": [{ "id": "t0", "date": "2025-12-02", "side": "BUY", "quantity": 52, "price": 190.40, "fee": 4.95, "pnl": null }]
}
```

- `equity` and `benchmark` have one point per trading day, with the same dates.
- `periods`: quarterly returns (monthly if the range covers fewer than 2 quarters), at most the last 8.
- `trades[].pnl` is `null` for entries and the realized P/L for exits.
- If backtests become slow, return `202` with a job id and add `GET /api/backtests/{id}`;
  the UI already shows a running state.

### `GET /api/backtests/latest` → `BacktestResult | null`

Restores the last result when the page is reopened.

---

## AI analysis and recommendations

### `GET /api/analysis?strategyId=ma-crossover` → `AnalysisReport | null`
### `POST /api/analysis` → `AnalysisReport`

Request: `{ "strategyId": "ma-crossover", "start": "2026-05-12", "end": "2026-11-08" }`

```json
{
  "id": "ai_…",
  "strategyId": "ma-crossover",
  "strategyName": "Moving Average Crossover",
  "symbol": "AAPL",
  "model": "model name and version",
  "runAt": "…Z",
  "period": { "start": "2026-05-12", "end": "2026-11-08" },
  "headline": "Strategy lagged the benchmark over this period",
  "signalLabel": "Underperforming",
  "summary": "…",
  "confidence": null,
  "factors": [{ "label": "Win rate", "strength": "Weak" }],
  "metrics": { "totalReturnPct": -11.3, "winRate": 0, "profitFactor": 0, "riskScore": 32 },
  "equity": [], "benchmark": [],
  "recommendations": [
    { "id": "r_…", "title": "Review moving average parameters", "detail": "…", "status": "proposed", "suggestedParams": { "shortWindow": 15, "longWindow": 50 } }
  ],
  "transparency": { "supporting": ["…"], "limitations": ["…"], "uncertainty": ["…"] }
}
```

- `model`, `runAt` and `period` are required (REQ-0601).
- `metrics`, `equity` and `benchmark` must be **computed** from a backtest; the
  UI labels them "Computed". `headline`, `summary` and `factors` are
  **model-generated** and labelled as such (REQ-0602). Keep the two separate.
- `confidence` is `{ "value": 78, "validated": true, "note": "…" }` or `null`.
  Only return it once the measure is defined and validated; the UI hides it otherwise.
- `factors[].strength`: `"Strong" | "Moderate" | "Positive" | "Elevated" | "Weak"`.

### `PATCH /api/analysis/{strategyId}/recommendations/{id}` → `Recommendation`

Body: `{ "status": "testing" | "accepted" | "rejected" }`

- Lifecycle: `proposed → testing → accepted | rejected` (rejected is allowed from any open state).
- **`accepted` is only allowed from `testing`** → otherwise `409` (REQ-0603).
- Accepting a recommendation with `suggestedParams` applies them to the strategy
  as a new strategy version and records it in the audit history.

---

## Trade approvals and notifications

### `GET /api/approvals` → `PendingTrade[]`

Returns pending proposals plus recent decisions (the UI filters by 24 h / 7 days / all).

```json
{
  "id": "uuid",
  "action": "BUY",
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "quantity": 6,
  "estimatedPrice": 288.60,
  "strategyName": "Bullish Engulfing Pattern",
  "rationale": "AAPL printed a bullish engulfing candle after several down sessions…",
  "riskCheck": { "passed": true, "summary": "Proposal meets configured limits", "details": "Position $1732 of $2,500 limit · Exposure 63% of 75%" },
  "createdAt": "…Z",
  "expiresAt": "…Z",
  "status": "pending",
  "decidedAt": null
}
```

- Every REQ-0701 field is present: action, symbol, quantity, estimated price,
  strategy, rationale, risk-check result, and expiry.
- `status`: `"pending" | "approved" | "rejected" | "expired" | "failed"`.
- **Expiry is the server's job (REQ-0702).** `expiresAt` drives the countdown,
  but the server must mark proposals `expired` when the deadline passes (on read
  or with a scheduled job) and must never execute an expired proposal.
- The UI polls this every 5 s. Proposals are created by the trading engine when
  `approvalRequired` is on; there is no client endpoint to create them. (The
  demo's "Simulate strategy signal" button exists only in demo mode.)

### `POST /api/approvals/{id}/approve` → `PendingTrade`
### `POST /api/approvals/{id}/reject` → `PendingTrade`

- Not `pending` → `409` "This proposal is already approved." (REQ-0703).
  Concurrent double clicks must produce exactly one decision: use
  `UPDATE … SET status = … WHERE id = :id AND status = 'pending'` and check the row count.
- Past `expiresAt` → mark `expired`, return `409` "This proposal expired before your decision was received. Nothing was executed."
- Approve places the order through the same path as `POST /api/orders`,
  including risk checks. If the order is rejected, set the proposal to `failed`
  and create a notification with the reason.

### `GET /api/notifications` → `AppNotification[]` (newest first)

```json
{ "id": "n_…", "kind": "approved", "title": "AAPL paper trade approved", "body": "…", "time": "…Z", "read": false }
```

`kind`: `"approved" | "signal" | "risk" | "rejected" | "system"`. Only create
notification kinds the user has enabled in their settings.

### `POST /api/notifications/read`

Body: `{ "ids": ["n_1", "n_2"] }`, or `{}` to mark all as read. Returns `204`.

---

## User settings

### `GET /api/me/settings` → `UserSettings`
### `PUT /api/me/settings` → `UserSettings`

```json
{
  "displayName": "Alex Morgan",
  "timezone": "America/New_York",
  "defaultTradingMode": "paper",
  "notifications": { "tradeApprovals": true, "orderFills": true, "riskAlerts": true, "systemAlerts": false },
  "twoFactorEnabled": null,
  "sessionTimeoutMinutes": 60
}
```

- `displayName`: 1–60 characters. `timezone`: a valid IANA name.
- `defaultTradingMode: "live"` → `400` "Live trading is not available in this prototype."
  This preference must never bypass server safety controls.
- `sessionTimeoutMinutes`: 5–720.
- `twoFactorEnabled`: `null` until 2FA is implemented; the UI then shows it as unavailable.
- **Re-authentication (REQ-0802).** The UI asks for the password before changing
  `defaultTradingMode` or `sessionTimeoutMinutes`. Today it verifies the password
  by logging in and immediately revoking that throwaway session
  (`confirmPassword` in `frontend/src/api.ts`). A dedicated endpoint is cleaner:

### `POST /auth/verify-password` (proposed)

Body `{ "password": "…" }` with the current bearer token → `204` if correct,
`401` "That password is incorrect." if not. Rate-limit it.

---

## Not yet supported by the backend

The UI hides or disables these until the backend supports them:

| Feature | UI switch |
|---|---|
| Password reset | `AUTH_FEATURES.passwordRecovery` in `frontend/src/api.ts` |
| Google sign-in | `AUTH_FEATURES.googleSignIn` |
| Changing email | Email field is read-only in Settings |
| Two-factor authentication | `twoFactorEnabled: null` |
| Live trading | Option disabled in Settings |
| Streaming quotes | The UI polls quotes every 15 s; a WebSocket can replace this later |

---

## Switching the frontend over

1. Export `request` from `frontend/src/api.ts`. It already adds the bearer token,
   handles network errors, and turns `401` into "session expired".
2. Add the `/api` prefix to the proxy in `frontend/vite.config.ts`:
   `"/api": apiTarget`.
3. In `frontend/src/data/service.ts`, replace each function body with a call, e.g.

   ```ts
   export function getPortfolio() {
     return request<PortfolioSummary>("/api/portfolio");
   }
   ```

   Functions can be switched one at a time; the demo simulation keeps serving the rest.
4. When every function is switched, set `DEMO_MODE = false` (hides the
   "Simulate strategy signal" button) and delete the demo store and `market.ts`
   (keep `runBacktest` as a reference for the server).

// Data service for every page except auth.
//
// The backend currently only implements /auth/*. Until portfolio, order, strategy,
// backtest, analysis, and approval endpoints exist, this module serves a per-user
// demo simulation kept in localStorage. Each exported function is the seam for a
// future `request()` call to the API; pages never touch the demo store directly.
// Rules the backend must own (risk limits, idempotency, approval expiry) are
// enforced here rather than in the pages, mirroring where they will live.

import {
  ASSETS,
  BENCHMARK,
  BacktestError,
  assetFor,
  dailyCandles,
  quoteFor,
  round,
  runBacktest as simulate,
} from "./market";
import type {
  Activity,
  AnalysisReport,
  AppNotification,
  BacktestRequest,
  BacktestResult,
  Candle,
  ExecutedTrade,
  Order,
  OrderRequest,
  PendingTrade,
  Point,
  PortfolioSummary,
  Position,
  Quote,
  Recommendation,
  RecommendationStatus,
  RiskSettings,
  Side,
  Strategy,
  UserSettings,
} from "./types";

export const DEMO_MODE = true;

export class ServiceError extends Error {}

type Holding = { symbol: string; quantity: number; averageCost: number };

type Store = {
  seededAt: string;
  initialCapital: number;
  cash: number;
  holdings: Holding[];
  orders: Order[];
  orderKeys: Record<string, string>;
  activity: Activity[];
  trades: ExecutedTrade[];
  strategies: Strategy[];
  risk: RiskSettings;
  pending: PendingTrade[];
  notifications: AppNotification[];
  settings: UserSettings;
  analyses: Record<string, AnalysisReport>;
  lastBacktest: BacktestResult | null;
};

let userId = "anonymous";
let store: Store | null = null;

const STORE_VERSION = 1;

function storageKey() {
  return `trademind.demo.v${STORE_VERSION}.${userId}`;
}

export function setDemoAccount(id: string, email: string) {
  if (id !== userId) {
    userId = id;
    store = null;
  }
  defaultName = email.split("@")[0];
}

let defaultName = "Trader";

function load(): Store {
  if (store) return store;
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      store = JSON.parse(raw) as Store;
      return store;
    }
  } catch {
    // fall through to a fresh seed
  }
  store = seed();
  save();
  return store;
}

function save() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(store));
  } catch {
    // Storage full or blocked: the demo keeps working in memory.
  }
}

export function resetDemoData() {
  try {
    localStorage.removeItem(storageKey());
  } catch {
    // ignore
  }
  store = null;
}

function latency<T>(value: T, ms = 250 + Math.random() * 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60000).toISOString();
}

// ---------------- seed ----------------

const STRATEGY_SEED: Strategy[] = [
  {
    id: "ma-crossover",
    name: "Moving Average Crossover",
    kind: "technical",
    description: "Generates buy or sell signals when the fast average crosses the slower trend average.",
    tags: ["Trend following", "Medium frequency"],
    enabled: true,
    version: 1,
    updatedAt: "",
    paramDefs: [
      { key: "shortWindow", label: "Fast period", kind: "int", min: 2, max: 200, hint: "Number of market periods" },
      { key: "longWindow", label: "Slow period", kind: "int", min: 3, max: 400, hint: "Must be greater than the fast period" },
      { key: "symbols", label: "Applicable symbols", kind: "symbols", hint: "Separate symbols with commas" },
      { key: "signalThreshold", label: "Signal threshold (%)", kind: "decimal", min: 0, max: 100, hint: "Minimum confidence, percent" },
    ],
    params: { shortWindow: 20, longWindow: 50, symbols: ["AAPL", "MSFT", "NVDA"], signalThreshold: 2.5 },
  },
  {
    id: "bullish-engulfing",
    name: "Bullish Engulfing Pattern",
    kind: "technical",
    description: "Detects bullish two-candle reversal patterns after a sustained downward price move.",
    tags: ["Candlestick pattern", "Event driven"],
    enabled: true,
    version: 1,
    updatedAt: "",
    paramDefs: [
      { key: "exitWindow", label: "Exit average period", kind: "int", min: 2, max: 100, hint: "Exit when the close falls below this average" },
      { key: "symbols", label: "Applicable symbols", kind: "symbols", hint: "Separate symbols with commas" },
    ],
    params: { exitWindow: 10, symbols: ["AAPL", "TSLA"] },
  },
  {
    id: "rsi",
    name: "RSI Strategy",
    kind: "technical",
    description: "Uses relative strength to identify potentially overbought and oversold market conditions.",
    tags: ["Momentum oscillator", "High frequency"],
    enabled: false,
    version: 1,
    updatedAt: "",
    paramDefs: [
      { key: "period", label: "RSI period", kind: "int", min: 2, max: 100 },
      { key: "oversold", label: "Oversold level", kind: "decimal", min: 0, max: 100, hint: "Buy below this level" },
      { key: "overbought", label: "Overbought level", kind: "decimal", min: 0, max: 100, hint: "Sell above this level; must exceed oversold" },
      { key: "symbols", label: "Applicable symbols", kind: "symbols", hint: "Separate symbols with commas" },
    ],
    params: { period: 14, oversold: 30, overbought: 70, symbols: ["NVDA", "AMZN"] },
  },
  {
    id: "disclosure",
    name: "Insider Disclosure Strategy",
    kind: "disclosure",
    description: "Reacts to newly filed insider and congressional trading disclosures.",
    tags: ["Disclosure based", "Low frequency"],
    enabled: false,
    version: 1,
    updatedAt: "",
    paramDefs: [
      { key: "minTransactionValue", label: "Minimum disclosed value ($)", kind: "decimal", min: 0 },
      { key: "maxFilingAgeDays", label: "Maximum filing age (days)", kind: "int", min: 1, max: 90, hint: "Ignore disclosures older than this" },
      { key: "symbols", label: "Applicable symbols", kind: "symbols", hint: "Leave empty for all symbols" },
    ],
    params: { minTransactionValue: 50000, maxFilingAgeDays: 5, symbols: [] },
  },
];

export const DEFAULT_RISK: Omit<RiskSettings, "version" | "updatedAt"> = {
  maxPositionSize: 2500,
  maxExposurePct: 75,
  stopLossPct: 5,
  takeProfitPct: 12,
  dailyLossLimit: 500,
  approvalRequired: true,
};

function seed(): Store {
  const now = new Date().toISOString();
  const holdings: Holding[] = [
    { symbol: "AAPL", quantity: 10, averageCost: 0 },
    { symbol: "NVDA", quantity: 3, averageCost: 0 },
    { symbol: "MSFT", quantity: 6, averageCost: 0 },
    { symbol: "TSLA", quantity: 4, averageCost: 0 },
  ];
  // Cost basis: the close ~30 trading days ago.
  for (const h of holdings) {
    const candles = dailyCandles(h.symbol);
    h.averageCost = candles[Math.max(0, candles.length - 30)].c;
  }
  const cash = 8230.17;
  const invested = holdings.reduce((s, h) => s + h.quantity * h.averageCost, 0);

  const activity: Activity[] = [
    { id: id("a"), time: minutesAgo(12), kind: "system", title: "Risk check completed", detail: "Portfolio exposure within configured limits" },
    { id: id("a"), time: minutesAgo(26), kind: "signal", title: "Strategy signal", detail: "Moving Average Crossover flagged a NVDA crossover" },
    { id: id("a"), time: minutesAgo(54), kind: "order", side: "BUY", title: "BUY · NVDA limit placed", detail: "2 shares, waiting for the limit price" },
    { id: id("a"), time: minutesAgo(130), kind: "system", title: "Strategy started", detail: "Bullish Engulfing Pattern is now monitoring" },
  ];

  const trades: ExecutedTrade[] = holdings.map((h, i): ExecutedTrade => ({
    id: id("x"),
    time: minutesAgo(60 * 24 * (30 - i)),
    symbol: h.symbol,
    side: "BUY",
    quantity: h.quantity,
    price: h.averageCost,
    strategyName: i % 2 === 0 ? "Moving Average Crossover" : null,
    source: i % 2 === 0 ? "approved" : "manual",
  })).reverse();

  const strategies = STRATEGY_SEED.map((s) => ({ ...s, updatedAt: now }));

  const s: Store = {
    seededAt: now,
    initialCapital: round(cash + invested),
    cash,
    holdings,
    orders: [],
    orderKeys: {},
    activity,
    trades,
    strategies,
    risk: { ...DEFAULT_RISK, version: 1, updatedAt: now },
    pending: [],
    notifications: [
      { id: id("n"), kind: "approved", title: "MSFT paper order approved", body: "Your simulated order for 6 shares was approved and recorded.", time: minutesAgo(18), read: false },
      { id: id("n"), kind: "risk", title: "Portfolio exposure check", body: "Technology exposure is within the configured limit.", time: minutesAgo(42), read: false },
      { id: id("n"), kind: "rejected", title: "NVDA proposal rejected", body: "A simulated buy proposal was rejected during manual review.", time: minutesAgo(60 * 20), read: true },
    ],
    settings: {
      displayName: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      defaultTradingMode: "paper",
      notifications: { tradeApprovals: true, orderFills: true, riskAlerts: true, systemAlerts: false },
      twoFactorEnabled: null,
      sessionTimeoutMinutes: 60,
    },
    analyses: {},
    lastBacktest: null,
  };
  // Two pending limit orders so the order book is not empty.
  for (const [symbol, side, qty, offset] of [["NVDA", "BUY", 2, -0.02], ["TSLA", "SELL", 2, 0.03]] as const) {
    const q = quoteFor(symbol);
    s.orders.push({
      id: id("o"),
      symbol,
      side,
      quantity: qty,
      orderType: "limit",
      limitPrice: round(q.price * (1 + offset)),
      price: round(q.price * (1 + offset)),
      status: "pending",
      createdAt: minutesAgo(40 + qty * 9),
    });
  }
  s.pending.push(makeProposal(s, 150));
  const passed = { passed: true, summary: "Proposal met configured limits", details: "Checked at proposal time" };
  s.pending.push(
    { ...makeProposal(s, 0), riskCheck: passed, status: "approved", decidedAt: minutesAgo(18), symbol: "MSFT", name: "Microsoft", quantity: 6 },
    { ...makeProposal(s, 0), riskCheck: passed, status: "rejected", decidedAt: minutesAgo(60 * 20), symbol: "NVDA", name: "NVIDIA", quantity: 2 },
    { ...makeProposal(s, 0), riskCheck: passed, status: "expired", decidedAt: minutesAgo(60 * 23), symbol: "TSLA", name: "Tesla", quantity: 4, action: "SELL" },
  );
  return s;
}

// ---------------- portfolio ----------------

function positionsOf(s: Store): Position[] {
  return s.holdings
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      symbol: h.symbol,
      name: assetFor(h.symbol)?.name ?? h.symbol,
      quantity: h.quantity,
      averageCost: h.averageCost,
      currentPrice: quoteFor(h.symbol).price,
    }));
}

function portfolioValue(s: Store) {
  return s.cash + positionsOf(s).reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
}

export async function getPortfolio(): Promise<PortfolioSummary> {
  const s = load();
  const value = portfolioValue(s);
  const dayChange = s.holdings.reduce((sum, h) => {
    const c = dailyCandles(h.symbol);
    return sum + h.quantity * (quoteFor(h.symbol).price - c[c.length - 2].c);
  }, 0);
  const active = s.strategies.filter((x) => x.enabled).length;
  return latency({
    mode: s.settings.defaultTradingMode,
    portfolioValue: round(value),
    availableCash: round(s.cash),
    totalReturnAmount: round(value - s.initialCapital),
    totalReturnPct: round(((value - s.initialCapital) / s.initialCapital) * 100),
    dayChange: round(dayChange),
    activeStrategies: active,
    botStatus: active > 0 ? "running" : "stopped",
    asOf: new Date().toISOString(),
  });
}

export type PerfRange = "1W" | "1M" | "3M" | "1Y" | "ALL";
const RANGE_DAYS: Record<PerfRange, number> = { "1W": 5, "1M": 21, "3M": 63, "1Y": 252, ALL: 100000 };

export async function getPerformance(range: PerfRange): Promise<{ series: Point[]; benchmark: Point[] }> {
  const s = load();
  const days = RANGE_DAYS[range];
  const spy = dailyCandles(BENCHMARK.symbol);
  const n = Math.min(days + 1, spy.length);
  const tail = spy.slice(-n);
  // Simulated: current holdings valued at historical closes plus current cash.
  const closes = new Map(s.holdings.map((h) => [h.symbol, new Map(dailyCandles(h.symbol).map((c) => [c.t, c.c]))]));
  const series = tail.map((bar) => ({
    t: bar.t,
    value: round(s.cash + s.holdings.reduce((sum, h) => sum + h.quantity * (closes.get(h.symbol)?.get(bar.t) ?? 0), 0)),
  }));
  const base = series[0].value;
  const benchmark = tail.map((bar) => ({ t: bar.t, value: round(base * (bar.c / tail[0].c)) }));
  return latency({ series, benchmark });
}

export async function getPositions(): Promise<Position[]> {
  return latency(positionsOf(load()));
}

export async function getActivity(limit = 20): Promise<Activity[]> {
  return latency(load().activity.slice(0, limit));
}

// ---------------- market ----------------

export async function getWatchlist(): Promise<Quote[]> {
  return latency(ASSETS.map((a) => quoteFor(a.symbol)), 200);
}

export async function getQuote(symbol: string): Promise<Quote> {
  if (!assetFor(symbol)) {
    throw new ServiceError(`No market data for ${symbol}`);
  }
  return latency(quoteFor(symbol), 150);
}

export type CandleRange = "1M" | "3M" | "6M" | "1Y";
const CANDLE_DAYS: Record<CandleRange, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };

export async function getCandles(symbol: string, range: CandleRange): Promise<Candle[]> {
  return latency(dailyCandles(symbol).slice(-CANDLE_DAYS[range]), 200);
}

export function listAssets() {
  return ASSETS;
}

// ---------------- orders ----------------

function addActivity(s: Store, entry: Omit<Activity, "id" | "time">) {
  s.activity.unshift({ ...entry, id: id("a"), time: new Date().toISOString() });
  s.activity = s.activity.slice(0, 100);
}

function notify(s: Store, entry: Omit<AppNotification, "id" | "time" | "read">) {
  s.notifications.unshift({ ...entry, id: id("n"), time: new Date().toISOString(), read: false });
  s.notifications = s.notifications.slice(0, 50);
}

/** Server-side risk check. Returns a reason string when the order breaks a limit. */
function riskViolation(s: Store, symbol: string, side: Side, quantity: number, price: number): string | null {
  const notional = quantity * price;
  if (side === "BUY") {
    if (notional > s.risk.maxPositionSize) {
      return `Order value $${notional.toFixed(2)} exceeds the $${s.risk.maxPositionSize.toLocaleString()} maximum position size.`;
    }
    if (notional > s.cash) {
      return "Not enough simulated cash for this order.";
    }
    const invested = positionsOf(s).reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    const exposure = ((invested + notional) / portfolioValue(s)) * 100;
    if (exposure > s.risk.maxExposurePct) {
      return `Order would raise exposure to ${exposure.toFixed(1)}%, above the ${s.risk.maxExposurePct}% limit.`;
    }
  } else {
    const held = s.holdings.find((h) => h.symbol === symbol)?.quantity ?? 0;
    if (quantity > held) {
      return `You hold ${held} ${symbol}; you cannot sell ${quantity}.`;
    }
  }
  return null;
}

function fill(s: Store, order: Order, price: number) {
  const holding = s.holdings.find((h) => h.symbol === order.symbol);
  if (order.side === "BUY") {
    s.cash -= order.quantity * price;
    if (holding) {
      const total = holding.quantity + order.quantity;
      holding.averageCost = round((holding.averageCost * holding.quantity + price * order.quantity) / total);
      holding.quantity = total;
    } else {
      s.holdings.push({ symbol: order.symbol, quantity: order.quantity, averageCost: price });
    }
  } else if (holding) {
    s.cash += order.quantity * price;
    holding.quantity -= order.quantity;
    s.holdings = s.holdings.filter((h) => h.quantity > 0);
  }
  order.status = "filled";
  order.price = price;
}

function placeOrder(s: Store, req: Omit<OrderRequest, "idempotencyKey">, source: ExecutedTrade["source"], strategyName: string | null): Order {
  const symbol = req.symbol.trim().toUpperCase();
  if (!assetFor(symbol)) {
    throw new ServiceError(`${symbol} is not a supported symbol.`);
  }
  if (!(req.quantity > 0) || !Number.isInteger(req.quantity)) {
    throw new ServiceError("Quantity must be a whole number greater than 0.");
  }
  const quote = quoteFor(symbol);
  const checkPrice = req.orderType === "limit" && req.limitPrice ? req.limitPrice : quote.price;
  const violation = riskViolation(s, symbol, req.side, req.quantity, checkPrice);
  const order: Order = {
    id: id("o"),
    symbol,
    side: req.side,
    quantity: req.quantity,
    orderType: req.orderType,
    limitPrice: req.limitPrice,
    price: checkPrice,
    status: "accepted",
    createdAt: new Date().toISOString(),
  };
  if (violation) {
    order.status = "rejected";
    s.orders.unshift(order);
    addActivity(s, { kind: "order", side: req.side, title: `${req.side} · ${symbol} rejected`, detail: violation });
    throw new ServiceError(violation);
  }
  const marketable =
    req.orderType === "market" ||
    (req.side === "BUY" ? quote.price <= (req.limitPrice ?? 0) : quote.price >= (req.limitPrice ?? Infinity));
  if (marketable) {
    const price = req.orderType === "market" ? quote.price : Math.min(quote.price, req.limitPrice ?? quote.price);
    fill(s, order, req.side === "BUY" ? price : Math.max(price, quote.price));
    s.trades.unshift({ id: id("x"), time: order.createdAt, symbol, side: req.side, quantity: req.quantity, price: order.price, strategyName, source });
    addActivity(s, { kind: "execution", side: req.side, title: `${req.side} · ${symbol}`, detail: `${req.quantity} shares filled at $${order.price.toFixed(2)}` });
    if (s.settings.notifications.orderFills) {
      notify(s, { kind: "approved", title: `${symbol} paper order filled`, body: `${req.side} ${req.quantity} ${symbol} at $${order.price.toFixed(2)} (simulated).` });
    }
  } else {
    order.status = "pending";
    addActivity(s, { kind: "order", side: req.side, title: `${req.side} · ${symbol} limit placed`, detail: `${req.quantity} shares at $${req.limitPrice?.toFixed(2)}` });
  }
  s.orders.unshift(order);
  return order;
}

const inflightOrders = new Map<string, Promise<Order>>();

/** Idempotent: repeated or concurrent calls with the same key yield one order (REQ-0403). */
export function submitOrder(req: OrderRequest): Promise<Order> {
  const s = load();
  const existing = s.orderKeys[req.idempotencyKey];
  if (existing) {
    const order = s.orders.find((o) => o.id === existing);
    if (order) return latency(order);
  }
  const inflight = inflightOrders.get(req.idempotencyKey);
  if (inflight) return inflight;
  const p = (async () => {
    await latency(null, 600);
    try {
      const order = placeOrder(s, req, "manual", null);
      s.orderKeys[req.idempotencyKey] = order.id;
      return structuredClone(order);
    } catch (error) {
      // placeOrder records rejected orders first; map the key to it so retries don't resubmit.
      const rejected = s.orders[0];
      if (rejected?.status === "rejected") s.orderKeys[req.idempotencyKey] = rejected.id;
      throw error;
    } finally {
      save();
      inflightOrders.delete(req.idempotencyKey);
    }
  })();
  inflightOrders.set(req.idempotencyKey, p);
  return p;
}

export async function getOrders(): Promise<Order[]> {
  return latency(load().orders);
}

export async function cancelOrder(orderId: string): Promise<Order> {
  const s = load();
  const order = s.orders.find((o) => o.id === orderId);
  if (!order) throw new ServiceError("Order not found.");
  if (order.status !== "pending" && order.status !== "accepted") {
    throw new ServiceError(`This order is already ${order.status} and cannot be cancelled.`);
  }
  order.status = "cancelled";
  addActivity(s, { kind: "order", side: order.side, title: `${order.side} · ${order.symbol} cancelled`, detail: `${order.quantity} shares` });
  save();
  return latency(order);
}

export async function getTradeHistory(): Promise<ExecutedTrade[]> {
  return latency(load().trades);
}

// ---------------- strategies & risk ----------------

export async function getStrategies(): Promise<Strategy[]> {
  return latency(load().strategies);
}

export async function saveStrategy(next: Strategy): Promise<Strategy> {
  const s = load();
  const current = s.strategies.find((x) => x.id === next.id);
  if (!current) throw new ServiceError("Strategy not found.");
  if (current.version !== next.version) {
    throw new ServiceError("This strategy was changed elsewhere. Reload and try again.");
  }
  const p = next.params;
  if (next.id === "ma-crossover" && Number(p.longWindow) <= Number(p.shortWindow)) {
    throw new ServiceError("Slow period must be greater than the fast period.");
  }
  if (next.id === "rsi" && Number(p.overbought) <= Number(p.oversold)) {
    throw new ServiceError("Overbought level must be greater than the oversold level.");
  }
  const saved: Strategy = { ...next, version: current.version + 1, updatedAt: new Date().toISOString() };
  s.strategies = s.strategies.map((x) => (x.id === next.id ? saved : x));
  if (current.enabled !== saved.enabled) {
    addActivity(s, { kind: "system", title: saved.enabled ? "Strategy started" : "Strategy stopped", detail: `${saved.name} ${saved.enabled ? "is now monitoring" : "was disabled"}` });
  }
  save();
  return latency(saved, 400);
}

export async function getRisk(): Promise<RiskSettings> {
  return latency(load().risk);
}

export async function saveRisk(next: RiskSettings): Promise<RiskSettings> {
  const s = load();
  if (s.risk.version !== next.version) {
    throw new ServiceError("Risk settings were changed elsewhere. Reload and try again.");
  }
  if (next.maxPositionSize <= 0 || next.maxExposurePct <= 0 || next.maxExposurePct > 100) {
    throw new ServiceError("Risk limits are out of range.");
  }
  s.risk = { ...next, version: s.risk.version + 1, updatedAt: new Date().toISOString() };
  addActivity(s, { kind: "system", title: "Risk settings updated", detail: `Version ${s.risk.version}` });
  save();
  return latency(s.risk, 400);
}

// ---------------- backtesting ----------------

export async function runBacktest(req: BacktestRequest): Promise<BacktestResult> {
  const s = load();
  const strategy = s.strategies.find((x) => x.id === req.strategyId);
  if (!strategy) throw new ServiceError("Strategy not found.");
  await latency(null, 900);
  try {
    const tested = req.paramOverrides ? { ...strategy, params: { ...strategy.params, ...req.paramOverrides } } : strategy;
    const result = simulate(tested, req);
    s.lastBacktest = result;
    save();
    return structuredClone(result);
  } catch (error) {
    if (error instanceof BacktestError) throw new ServiceError(error.message);
    throw error;
  }
}

export async function getLastBacktest(): Promise<BacktestResult | null> {
  return latency(load().lastBacktest, 100);
}

// ---------------- AI analysis ----------------

export async function getAnalysis(strategyId: string): Promise<AnalysisReport | null> {
  return latency(load().analyses[strategyId] ?? null);
}

export async function runAnalysis(strategyId: string, start: string, end: string): Promise<AnalysisReport> {
  const s = load();
  const strategy = s.strategies.find((x) => x.id === strategyId);
  if (!strategy) throw new ServiceError("Strategy not found.");
  if (strategy.kind === "disclosure") {
    throw new ServiceError("Analysis needs backtest data, and disclosure history is not loaded yet.");
  }
  await latency(null, 1200);
  const symbols = (strategy.params.symbols as string[]).filter((x) => assetFor(x));
  const symbol = symbols[0] ?? "AAPL";
  let bt: BacktestResult;
  try {
    bt = simulate(strategy, { strategyId, symbol, startDate: start, endDate: end, initialCapital: 10000, feePct: 0.05, slippagePct: 0.05 });
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Analysis failed.");
  }
  const grossWin = bt.trades.filter((t) => (t.pnl ?? 0) > 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
  const grossLoss = -bt.trades.filter((t) => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
  const outperform = bt.totalReturnPct >= bt.benchmarkReturnPct;
  const prev = s.analyses[strategyId];
  const recs: Recommendation[] = buildRecommendations(strategy, bt).map((r) => {
    const old = prev?.recommendations.find((x) => x.title === r.title);
    return old ? { ...r, id: old.id, status: old.status } : r;
  });
  const report: AnalysisReport = {
    id: id("ai"),
    strategyId,
    strategyName: strategy.name,
    symbol,
    model: "trademind-demo-heuristics v0",
    runAt: new Date().toISOString(),
    period: { start, end },
    headline: outperform ? "Strategy outperformed the benchmark over this period" : "Strategy lagged the benchmark over this period",
    signalLabel: outperform ? "Outperforming" : "Underperforming",
    summary: `Over ${bt.equity.length} simulated trading days on ${symbol}, ${strategy.name} returned ${bt.totalReturnPct.toFixed(1)}% versus ${bt.benchmarkReturnPct.toFixed(1)}% for the simulated S&P 500 benchmark, with a maximum drawdown of ${bt.maxDrawdownPct.toFixed(1)}% across ${bt.totalTrades} trades. This is a pattern summary of past simulated data, not a prediction.`,
    confidence: null,
    factors: [
      { label: "Return vs. benchmark", strength: outperform ? "Strong" : "Weak" },
      { label: "Win rate", strength: bt.winRate >= 55 ? "Positive" : bt.winRate >= 45 ? "Moderate" : "Weak" },
      { label: "Drawdown", strength: bt.maxDrawdownPct > 20 ? "Elevated" : "Moderate" },
      { label: "Trade frequency", strength: bt.totalTrades > 40 ? "Elevated" : "Moderate" },
    ],
    metrics: {
      totalReturnPct: bt.totalReturnPct,
      winRate: bt.winRate,
      profitFactor: grossLoss === 0 ? round(grossWin > 0 ? 99 : 0) : round(grossWin / grossLoss),
      riskScore: Math.min(100, Math.round(bt.maxDrawdownPct * 2 + bt.totalTrades / 4)),
    },
    equity: bt.equity,
    benchmark: bt.benchmark,
    recommendations: recs,
    transparency: {
      supporting: [
        `${bt.totalTrades} simulated trades between ${start} and ${end}.`,
        `Win rate ${bt.winRate.toFixed(0)}% over ${bt.closedTrades} closed trades.`,
        `Compared against a simulated S&P 500 benchmark.`,
      ],
      limitations: [
        "Uses fictional, synthetic price data.",
        "Only the first applicable symbol is analysed.",
        "News and fundamental events are not represented.",
      ],
      uncertainty: [
        "No validated confidence measure exists yet, so none is shown.",
        "Past simulated results do not predict future performance.",
        "Human review and backtesting are required before adoption.",
      ],
    },
  };
  s.analyses[strategyId] = report;
  save();
  return structuredClone(report);
}

function buildRecommendations(strategy: Strategy, bt: BacktestResult): Recommendation[] {
  const recs: Recommendation[] = [];
  if (strategy.id === "ma-crossover") {
    const short = Number(strategy.params.shortWindow);
    const long = Number(strategy.params.longWindow);
    recs.push({
      id: id("r"),
      title: "Review moving average parameters",
      detail: bt.totalTrades > 30
        ? `With ${bt.totalTrades} trades, a slower fast period (${short + 5}/${long}) may reduce whipsaw trades and fees.`
        : `With only ${bt.totalTrades} trades, a faster fast period (${Math.max(2, short - 5)}/${long}) may react sooner to trends.`,
      status: "proposed",
      suggestedParams: { shortWindow: bt.totalTrades > 30 ? short + 5 : Math.max(2, short - 5), longWindow: long },
    });
  } else if (strategy.id === "rsi") {
    recs.push({
      id: id("r"),
      title: "Widen RSI thresholds",
      detail: "Moving thresholds to 25/75 may filter weaker signals; test before adopting.",
      status: "proposed",
      suggestedParams: { oversold: 25, overbought: 75 },
    });
  } else {
    recs.push({ id: id("r"), title: "Review exit rule", detail: "A longer exit average may let winning trades run further.", status: "proposed", suggestedParams: { exitWindow: Number(strategy.params.exitWindow) + 5 } });
  }
  recs.push({
    id: id("r"),
    title: "Compare strategy performance with the benchmark",
    detail: bt.totalReturnPct >= bt.benchmarkReturnPct
      ? `The strategy beat the benchmark by ${(bt.totalReturnPct - bt.benchmarkReturnPct).toFixed(1)} points but check whether the ${bt.maxDrawdownPct.toFixed(1)}% drawdown is acceptable.`
      : `The strategy trailed the benchmark by ${(bt.benchmarkReturnPct - bt.totalReturnPct).toFixed(1)} points; consider whether it adds value over holding the index.`,
    status: "proposed",
  });
  recs.push({
    id: id("r"),
    title: "Consider position concentration",
    detail: "Results come from a single symbol. Spreading signals across more symbols may reduce company-specific risk.",
    status: "proposed",
  });
  return recs;
}

export async function setRecommendationStatus(strategyId: string, recId: string, status: RecommendationStatus): Promise<Recommendation> {
  const s = load();
  const rec = s.analyses[strategyId]?.recommendations.find((r) => r.id === recId);
  if (!rec) throw new ServiceError("Recommendation not found.");
  if (status === "accepted" && rec.status !== "testing") {
    throw new ServiceError("A recommendation must be backtested and reviewed (status: testing) before it is accepted.");
  }
  rec.status = status;
  if (status === "accepted" && rec.suggestedParams) {
    s.strategies = s.strategies.map((x) =>
      x.id === strategyId
        ? { ...x, params: { ...x.params, ...rec.suggestedParams }, version: x.version + 1, updatedAt: new Date().toISOString() }
        : x,
    );
    addActivity(s, { kind: "system", title: "Recommendation adopted", detail: `${rec.title} applied as a new strategy version` });
  }
  save();
  return latency(rec, 300);
}

// ---------------- approvals & notifications ----------------

const RATIONALES = [
  (sym: string) => `${sym}'s 20-day moving average crossed above its 50-day average while volume stayed above its recent baseline. This is a simulated strategy signal, not a prediction or recommendation.`,
  (sym: string) => `${sym} printed a bullish engulfing candle after several down sessions. This is a simulated strategy signal, not a prediction or recommendation.`,
];

function makeProposal(s: Store, ttlSeconds: number): PendingTrade {
  const enabled = s.strategies.filter((x) => x.enabled && x.kind === "technical");
  const strategy = enabled[Math.floor(Math.random() * enabled.length)] ?? s.strategies[0];
  const symbols = (strategy.params.symbols as string[]).filter((x) => assetFor(x));
  const symbol = symbols[Math.floor(Math.random() * symbols.length)] ?? "AAPL";
  const q = quoteFor(symbol);
  const invested = positionsOf(s).reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
  const exposureRoom = (s.risk.maxExposurePct / 100) * portfolioValue(s) - invested;
  const budget = Math.min(s.risk.maxPositionSize, s.cash, exposureRoom * 0.5, 1800);
  const quantity = Math.max(1, Math.floor(budget / q.price));
  const violation = riskViolation(s, symbol, "BUY", quantity, q.price);
  const exposure = (((invested + quantity * q.price) / portfolioValue(s)) * 100).toFixed(0);
  return {
    id: crypto.randomUUID(),
    action: "BUY",
    symbol,
    name: q.name,
    quantity,
    estimatedPrice: q.price,
    strategyName: strategy.name,
    rationale: RATIONALES[strategy.id === "bullish-engulfing" ? 1 : 0](symbol),
    riskCheck: violation
      ? { passed: false, summary: "Proposal breaks a configured limit", details: violation }
      : { passed: true, summary: "Proposal meets configured limits", details: `Position $${(quantity * q.price).toFixed(0)} of $${s.risk.maxPositionSize.toLocaleString()} limit · Exposure ${exposure}% of ${s.risk.maxExposurePct}%` },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    status: "pending",
    decidedAt: null,
  };
}

function expireStale(s: Store) {
  let changed = false;
  for (const p of s.pending) {
    if (p.status === "pending" && new Date(p.expiresAt).getTime() <= Date.now()) {
      p.status = "expired";
      p.decidedAt = p.expiresAt;
      addActivity(s, { kind: "signal", side: p.action, title: `${p.action} · ${p.symbol} proposal expired`, detail: "No decision before the deadline; not executed" });
      changed = true;
    }
  }
  if (changed) save();
}

export async function getPendingTrades(): Promise<PendingTrade[]> {
  const s = load();
  expireStale(s);
  return latency(s.pending, 200);
}

const deciding = new Set<string>();

export async function decideTrade(tradeId: string, decision: "approve" | "reject"): Promise<PendingTrade> {
  const s = load();
  expireStale(s);
  const p = s.pending.find((x) => x.id === tradeId);
  if (!p) throw new ServiceError("Proposal not found.");
  if (p.status !== "pending") {
    throw new ServiceError(`This proposal is already ${p.status}.`);
  }
  if (deciding.has(p.id)) {
    throw new ServiceError("A decision for this proposal is already being processed.");
  }
  deciding.add(p.id);
  try {
    await latency(null, 500);
  } finally {
    deciding.delete(p.id);
  }
  if (new Date(p.expiresAt).getTime() <= Date.now()) {
    expireStale(s);
    throw new ServiceError("This proposal expired before your decision was received. Nothing was executed.");
  }
  p.decidedAt = new Date().toISOString();
  if (decision === "reject") {
    p.status = "rejected";
    notify(s, { kind: "rejected", title: `${p.symbol} proposal rejected`, body: `A simulated ${p.action.toLowerCase()} proposal was rejected during manual review.` });
  } else {
    try {
      placeOrder(s, { symbol: p.symbol, side: p.action, quantity: p.quantity, orderType: "market", limitPrice: null }, "approved", p.strategyName);
      p.status = "approved";
      notify(s, { kind: "approved", title: `${p.symbol} paper trade approved`, body: `Approved simulated ${p.action === "BUY" ? "purchase" : "sale"} of ${p.quantity} ${p.symbol} shares.` });
    } catch (error) {
      p.status = "failed";
      notify(s, { kind: "risk", title: `${p.symbol} approval failed`, body: error instanceof Error ? error.message : "Order could not be placed." });
    }
  }
  save();
  return structuredClone(p);
}

/** Demo-only: emulates the trading engine raising a new proposal. */
export async function simulateSignal(): Promise<PendingTrade> {
  const s = load();
  const proposal = makeProposal(s, 90);
  s.pending.unshift(proposal);
  if (s.settings.notifications.tradeApprovals) {
    notify(s, { kind: "signal", title: "New strategy signal requires approval", body: `${proposal.strategyName} proposed buying ${proposal.quantity} shares of ${proposal.symbol}.` });
  }
  addActivity(s, { kind: "signal", side: "BUY", title: "Strategy signal", detail: `${proposal.strategyName} proposed ${proposal.symbol}` });
  save();
  return latency(proposal, 300);
}

export async function getNotifications(): Promise<AppNotification[]> {
  return latency(load().notifications, 150);
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const s = load();
  for (const n of s.notifications) {
    if (!ids || ids.includes(n.id)) n.read = true;
  }
  save();
  return latency(undefined, 100);
}

// ---------------- settings ----------------

export async function getSettings(): Promise<UserSettings> {
  const s = load();
  return latency({ ...s.settings, displayName: s.settings.displayName || defaultName }, 150);
}

export async function saveSettings(next: UserSettings): Promise<UserSettings> {
  const s = load();
  if (next.defaultTradingMode === "live") {
    throw new ServiceError("Live trading is not available in this prototype.");
  }
  if (next.sessionTimeoutMinutes < 5 || next.sessionTimeoutMinutes > 720) {
    throw new ServiceError("Session timeout must be between 5 and 720 minutes.");
  }
  if (next.displayName.trim().length === 0 || next.displayName.length > 60) {
    throw new ServiceError("Display name must be 1 to 60 characters.");
  }
  s.settings = { ...next, displayName: next.displayName.trim(), twoFactorEnabled: null };
  save();
  return latency(s.settings, 350);
}

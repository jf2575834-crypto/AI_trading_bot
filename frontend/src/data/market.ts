// Deterministic synthetic market used by the demo service. All prices are fictional.
import type {
  Asset,
  BacktestRequest,
  BacktestResult,
  BacktestTrade,
  Candle,
  Point,
  Quote,
  Side,
  Strategy,
} from "./types";
import { isoDate } from "../lib/format";

export const ASSETS: Asset[] = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" },
  { symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ" },
  { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ" },
  { symbol: "TSLA", name: "Tesla", exchange: "NASDAQ" },
  { symbol: "AMZN", name: "Amazon", exchange: "NASDAQ" },
];

export const BENCHMARK = { symbol: "SPY", name: "S&P 500 (simulated)" };

const START_PRICE: Record<string, number> = {
  AAPL: 128,
  MSFT: 240,
  NVDA: 210,
  TSLA: 115,
  AMZN: 86,
  SPY: 384,
};
const VOL: Record<string, number> = { AAPL: 0.015, MSFT: 0.014, NVDA: 0.028, TSLA: 0.032, AMZN: 0.019, SPY: 0.009 };
const DRIFT: Record<string, number> = { AAPL: 0.0006, MSFT: 0.0007, NVDA: 0.0016, TSLA: 0.0005, AMZN: 0.0008, SPY: 0.0004 };

export const HISTORY_START = "2023-01-02";

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  }
  return h >>> 0;
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function businessDays(start: string, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = isoDate(end);
  while (isoDate(cursor) <= last) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      days.push(isoDate(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** One entry per symbol, replaced when the day changes. */
const cache = new Map<string, { day: string; candles: Candle[] }>();

/** Daily bars up to and including the most recent business day. */
export function dailyCandles(symbol: string): Candle[] {
  const day = isoDate(new Date());
  const hit = cache.get(symbol);
  if (hit?.day === day) {
    return hit.candles;
  }
  const rand = seededRandom(hash(symbol));
  const vol = VOL[symbol] ?? 0.02;
  const drift = DRIFT[symbol] ?? 0.0005;
  let close = START_PRICE[symbol] ?? 100;
  const candles = businessDays(HISTORY_START, new Date()).map((t) => {
    const open = close * (1 + gaussian(rand) * vol * 0.25);
    close = Math.max(1, open * (1 + drift + gaussian(rand) * vol));
    const high = Math.max(open, close) * (1 + rand() * vol * 0.6);
    const low = Math.min(open, close) * (1 - rand() * vol * 0.6);
    const v = Math.round((20 + rand() * 40) * 1_000_000 * (1 + Math.abs(close - open) / open / vol));
    return { t, o: round(open), h: round(high), l: round(low), c: round(close), v };
  });
  cache.set(symbol, { day, candles });
  return candles;
}

export function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function assetFor(symbol: string): Asset | undefined {
  return ASSETS.find((a) => a.symbol === symbol);
}

/** "Live" quote: the last close nudged by a small time-based drift so refreshes move. */
export function quoteFor(symbol: string, now = new Date()): Quote {
  const asset = assetFor(symbol) ?? { symbol, name: symbol, exchange: "" };
  const candles = dailyCandles(symbol);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  const minute = Math.floor(now.getTime() / 60000);
  const wiggle = Math.sin(minute / 7 + hash(symbol)) * (VOL[symbol] ?? 0.02) * 0.15;
  const price = round(last.c * (1 + wiggle));
  return { ...asset, price, changePct: round(((price - prev.c) / prev.c) * 100), asOf: now.toISOString() };
}

// ---------- indicators (each uses only data up to index i: no look-ahead) ----------

function sma(closes: number[], i: number, window: number): number | null {
  if (i + 1 < window) {
    return null;
  }
  let sum = 0;
  for (let k = i - window + 1; k <= i; k++) {
    sum += closes[k];
  }
  return sum / window;
}

function rsi(closes: number[], i: number, period: number): number | null {
  if (i < period) {
    return null;
  }
  let gains = 0;
  let losses = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const diff = closes[k] - closes[k - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

type Signal = Side | null;

function signalAt(strategy: Strategy, bars: Candle[], closes: number[], i: number): Signal {
  const p = strategy.params;
  if (strategy.id === "ma-crossover") {
    const short = Number(p.shortWindow);
    const long = Number(p.longWindow);
    const s0 = sma(closes, i - 1, short);
    const l0 = sma(closes, i - 1, long);
    const s1 = sma(closes, i, short);
    const l1 = sma(closes, i, long);
    if (s0 === null || l0 === null || s1 === null || l1 === null) return null;
    if (s0 <= l0 && s1 > l1) return "BUY";
    if (s0 >= l0 && s1 < l1) return "SELL";
    return null;
  }
  if (strategy.id === "rsi") {
    const value = rsi(closes, i, Number(p.period));
    if (value === null) return null;
    if (value < Number(p.oversold)) return "BUY";
    if (value > Number(p.overbought)) return "SELL";
    return null;
  }
  if (strategy.id === "bullish-engulfing") {
    if (i < 1) return null;
    const prev = bars[i - 1];
    const cur = bars[i];
    const engulfs = prev.c < prev.o && cur.c > cur.o && cur.o <= prev.c && cur.c >= prev.o;
    if (engulfs) return "BUY";
    const exitAvg = sma(closes, i, Number(p.exitWindow));
    return exitAvg !== null && cur.c < exitAvg ? "SELL" : null;
  }
  return null;
}

export class BacktestError extends Error {}

export function runBacktest(strategy: Strategy, request: BacktestRequest): BacktestResult {
  if (strategy.kind === "disclosure") {
    throw new BacktestError(
      "Historical disclosure data is not loaded yet, so this strategy cannot be backtested.",
    );
  }
  const all = dailyCandles(request.symbol);
  const bars = all.filter((b) => b.t >= request.startDate && b.t <= request.endDate);
  if (bars.length < 30) {
    throw new BacktestError("Choose a range with at least 30 trading days of data.");
  }
  // Allow indicators to warm up on bars before the start date (still past data, no look-ahead).
  const firstIndex = all.indexOf(bars[0]);
  const closes = all.map((b) => b.c);
  const fee = request.feePct / 100;
  const slip = request.slippagePct / 100;

  let cash = request.initialCapital;
  let shares = 0;
  let entryCost = 0;
  let pending: Signal = null;
  const trades: BacktestTrade[] = [];
  const equity: Point[] = [];
  let wins = 0;
  let closed = 0;

  for (let j = 0; j < bars.length; j++) {
    const i = firstIndex + j;
    const bar = all[i];
    // Execute yesterday's signal at today's open.
    if (pending === "BUY" && shares === 0) {
      const price = bar.o * (1 + slip);
      const qty = Math.floor(cash / (price * (1 + fee)));
      if (qty > 0) {
        const cost = qty * price;
        const f = cost * fee;
        cash -= cost + f;
        shares = qty;
        entryCost = cost + f;
        trades.push({ id: `t${trades.length}`, date: bar.t, side: "BUY", quantity: qty, price: round(price), fee: round(f), pnl: null });
      }
    } else if (pending === "SELL" && shares > 0) {
      const price = bar.o * (1 - slip);
      const proceeds = shares * price;
      const f = proceeds * fee;
      cash += proceeds - f;
      const pnl = proceeds - f - entryCost;
      closed += 1;
      if (pnl > 0) wins += 1;
      trades.push({ id: `t${trades.length}`, date: bar.t, side: "SELL", quantity: shares, price: round(price), fee: round(f), pnl: round(pnl) });
      shares = 0;
    }
    pending = signalAt(strategy, all, closes, i);
    equity.push({ t: bar.t, value: round(cash + shares * bar.c) });
  }

  const spy = dailyCandles(BENCHMARK.symbol);
  const spyByDate = new Map(spy.map((b) => [b.t, b.c]));
  const spyStart = spyByDate.get(bars[0].t) ?? spy[0].c;
  const benchmark = bars.map((b) => ({
    t: b.t,
    value: round(request.initialCapital * ((spyByDate.get(b.t) ?? spyStart) / spyStart)),
  }));

  let peak = -Infinity;
  let maxDd = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.value);
    maxDd = Math.max(maxDd, (peak - point.value) / peak);
  }

  const finalValue = equity[equity.length - 1].value;
  const bmFinal = benchmark[benchmark.length - 1].value;

  return {
    request,
    strategyName: strategy.name,
    completedAt: new Date().toISOString(),
    finalValue,
    totalReturnPct: round(((finalValue - request.initialCapital) / request.initialCapital) * 100),
    benchmarkReturnPct: round(((bmFinal - request.initialCapital) / request.initialCapital) * 100),
    winRate: closed === 0 ? 0 : round((wins / closed) * 100, 1),
    wins,
    closedTrades: closed,
    maxDrawdownPct: round(maxDd * 100),
    totalTrades: trades.length,
    equity,
    benchmark,
    periods: periodReturns(equity, benchmark),
    trades,
  };
}

function periodReturns(equity: Point[], benchmark: Point[]) {
  const quarterly = new Set(equity.map((p) => quarterKey(p.t))).size >= 2;
  const keyOf = quarterly ? quarterKey : (t: string) => t.slice(0, 7);
  const groups = new Map<string, { s: [number, number]; b: [number, number] }>();
  equity.forEach((p, idx) => {
    const key = keyOf(p.t);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { s: [p.value, p.value], b: [benchmark[idx].value, benchmark[idx].value] });
    } else {
      g.s[1] = p.value;
      g.b[1] = benchmark[idx].value;
    }
  });
  // Use the previous period's close as the base so periods chain.
  let prevS: number | null = null;
  let prevB: number | null = null;
  const out: { label: string; strategy: number; benchmark: number }[] = [];
  for (const [label, g] of groups) {
    const baseS = prevS ?? g.s[0];
    const baseB = prevB ?? g.b[0];
    out.push({
      label,
      strategy: round(((g.s[1] - baseS) / baseS) * 100),
      benchmark: round(((g.b[1] - baseB) / baseB) * 100),
    });
    prevS = g.s[1];
    prevB = g.b[1];
  }
  return out.slice(-8);
}

function quarterKey(t: string): string {
  const month = Number(t.slice(5, 7));
  return `Q${Math.ceil(month / 3)} ${t.slice(2, 4)}`;
}

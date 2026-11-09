import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { GroupedBars, LineChart, SERIES } from "../components/charts";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Badge, Card, ErrorState, IconTile, Notice, SideBadge, Skeleton, Stat } from "../components/ui";
import { getLastBacktest, getStrategies, listAssets, runBacktest } from "../data/service";
import type { BacktestResult } from "../data/types";
import { dateTime, longDate, money, pct, signedMoney, signedPct, tone } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";

type Form = {
  strategyId: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: string;
  feePct: string;
  slippagePct: string;
};

export type BacktestNavState = { strategyId: string; overrides: Record<string, number>; note: string };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function validate(f: Form) {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.strategyId) e.strategyId = "Choose a strategy";
  if (!f.symbol) e.symbol = "Choose an asset";
  if (!f.startDate) e.startDate = "Choose a start date";
  if (!f.endDate) e.endDate = "Choose an end date";
  else if (f.startDate && f.endDate < f.startDate) e.endDate = "End date cannot be before the start date";
  else if (f.endDate > today()) e.endDate = "End date cannot be in the future";
  if (f.startDate && f.startDate < "2023-01-02") e.startDate = "Data starts on Jan 2, 2023";
  if (!(Number(f.initialCapital) >= 100)) e.initialCapital = "Enter at least $100";
  if (!(Number(f.feePct) >= 0 && Number(f.feePct) <= 5) || f.feePct.trim() === "") e.feePct = "Enter 0 to 5";
  if (!(Number(f.slippagePct) >= 0 && Number(f.slippagePct) <= 5) || f.slippagePct.trim() === "") e.slippagePct = "Enter 0 to 5";
  return e;
}

export function Backtesting() {
  const { settings } = useSession();
  const location = useLocation();
  const nav = (location.state as BacktestNavState | null) ?? null;
  const strategies = useAsync(getStrategies, []);
  const last = useAsync(getLastBacktest, []);
  const [overrides, setOverrides] = useState<BacktestNavState | null>(nav);
  const [form, setForm] = useState<Form>({
    strategyId: nav?.strategyId ?? "ma-crossover",
    symbol: "AAPL",
    startDate: yearAgo(),
    endDate: today(),
    initialCapital: "10000",
    feePct: "0.05",
    slippagePct: "0.05",
  });
  const [touched, setTouched] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => {
    if (!result && last.data) setResult(last.data);
  }, [last.data, result]);

  const errors = validate(form);
  const valid = Object.keys(errors).length === 0;
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function run(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || running) return;
    setRunning(true);
    setRunError(null);
    try {
      setResult(
        await runBacktest({
          strategyId: form.strategyId,
          symbol: form.symbol,
          startDate: form.startDate,
          endDate: form.endDate,
          initialCapital: Number(form.initialCapital),
          feePct: Number(form.feePct),
          slippagePct: Number(form.slippagePct),
          paramOverrides: overrides && overrides.strategyId === form.strategyId ? overrides.overrides : undefined,
        }),
      );
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setRunning(false);
    }
  }

  function exportCsv() {
    if (!result) return;
    const rows = [
      ["date", "side", "quantity", "price", "fee", "pnl"],
      ...result.trades.map((t) => [t.date, t.side, t.quantity, t.price, t.fee, t.pnl ?? ""]),
      [],
      ["date", "strategy_equity", "benchmark_equity"],
      ...result.equity.map((p, i) => [p.t, p.value, result.benchmark[i].value]),
    ];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${result.request.symbol}-${result.request.startDate}-${result.request.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const err = (k: keyof Form) => (touched ? errors[k] : undefined);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Historical Backtesting</h2>
          <p className="muted">Test a strategy against historical data before using it in paper trading.</p>
        </div>
        <button type="button" className="btn btn-secondary" disabled={!result} onClick={exportCsv}>
          <Icon name="download" size={16} /> Export results
        </button>
      </div>

      <Card title="Backtest configuration" subtitle="Choose a strategy, security, historical period, and cost assumptions." icon="history" actions={<Badge tone="info">Historical data</Badge>}>
        {overrides && (
          <Notice tone="warning" title="Testing a recommendation">
            {overrides.note} Parameters:{" "}
            {Object.entries(overrides.overrides).map(([k, v]) => `${k} = ${v}`).join(", ")}. Saved strategy settings are not changed.{" "}
            <button type="button" className="link-btn" onClick={() => setOverrides(null)}>
              Use saved parameters instead
            </button>
          </Notice>
        )}
        <form className="bt-form" onSubmit={run} noValidate>
          <Field label="Strategy" error={err("strategyId")}>
            <select value={form.strategyId} onChange={(e) => set("strategyId", e.target.value)}>
              {(strategies.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stock symbol" error={err("symbol")}>
            <select value={form.symbol} onChange={(e) => set("symbol", e.target.value)}>
              {listAssets().map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.symbol} — {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date" error={err("startDate")}>
            <input type="date" min="2023-01-02" max={today()} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field label="End date" error={err("endDate")}>
            <input type="date" min="2023-01-02" max={today()} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
          <Field label="Initial capital ($)" error={err("initialCapital")}>
            <input inputMode="decimal" value={form.initialCapital} onChange={(e) => set("initialCapital", e.target.value)} />
          </Field>
          <Field label="Fee per trade (%)" error={err("feePct")}>
            <input inputMode="decimal" value={form.feePct} onChange={(e) => set("feePct", e.target.value)} />
          </Field>
          <Field label="Slippage (%)" error={err("slippagePct")}>
            <input inputMode="decimal" value={form.slippagePct} onChange={(e) => set("slippagePct", e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary bt-run" disabled={running}>
            <Icon name="play" size={14} /> {running ? "Running…" : "Run backtest"}
          </button>
        </form>
        <div className="bt-foot">
          <span className="muted small with-icon">
            <Icon name="info" size={14} /> Signals use only data available at each simulated day and fill at the next day's open. Fees and slippage
            are applied to every fill.
          </span>
          <Badge tone={valid ? "success" : "neutral"}>{valid ? "Ready to run" : "Check inputs"}</Badge>
        </div>
      </Card>

      <Notice tone="warning" title="Historical results do not guarantee future performance">
        Backtests use fictional, synthetic price data and simplified execution. Real markets include gaps, partial fills, and costs not modelled here.
      </Notice>

      {runError && <ErrorState message={runError} />}
      {running ? (
        <Card>
          <Skeleton rows={8} />
        </Card>
      ) : result ? (
        <Results result={result} timeZone={settings.timezone} />
      ) : last.loading ? (
        <Card>
          <Skeleton rows={4} />
        </Card>
      ) : (
        <div className="empty card">No backtest has been run yet. Configure one above.</div>
      )}
    </div>
  );
}

function Results({ result, timeZone }: { result: BacktestResult; timeZone: string }) {
  const [showAll, setShowAll] = useState(false);
  const r = result;
  const req = r.request;
  const gain = r.finalValue - req.initialCapital;
  const alpha = r.totalReturnPct - r.benchmarkReturnPct;
  const trades = showAll ? r.trades : r.trades.slice(-10).reverse();
  const months = Math.max(1, r.equity.length / 21);

  return (
    <>
      <div className="section-head">
        <div>
          <h3>Completed backtest result</h3>
          <p className="muted small">
            {r.strategyName} · {req.symbol} · {longDate(req.startDate)} – {longDate(req.endDate)} · fee {pct(req.feePct, 2)}, slippage {pct(req.slippagePct, 2)}
            {req.paramOverrides && " · with recommended parameters"}
          </p>
        </div>
        <Badge tone="success">
          <Icon name="check" size={12} /> Completed {dateTime(r.completedAt, timeZone)}
        </Badge>
      </div>

      <div className="stat-grid">
        <Stat label="Total return" value={signedPct(r.totalReturnPct)} foot={`${signedMoney(gain)} simulated`} footTone={tone(gain)} aside={<IconTile name="trendUp" tone={gain >= 0 ? "success" : "danger"} />} />
        <Stat label="Win rate" value={pct(r.winRate, 0)} foot={`${r.wins} of ${r.closedTrades} closed trades`} footTone="info" aside={<IconTile name="check" />} />
        <Stat label="Maximum drawdown" value={pct(r.maxDrawdownPct)} foot="Largest peak-to-trough decline" footTone="down" aside={<IconTile name="trendDown" tone="danger" />} />
        <Stat label="Total trades" value={r.totalTrades} foot={`${(r.totalTrades / months).toFixed(1)} trades per month`} footTone="info" aside={<IconTile name="history" />} />
      </div>

      <div className="grid-main">
        <Card
          title="Equity curve"
          subtitle="Simulated portfolio value over the selected period"
          actions={
            <div className="hero-number right">
              <strong>{money(r.finalValue)}</strong>
              <span className={tone(gain)}>{signedMoney(gain)}</span>
            </div>
          }
        >
          <LineChart
            label="Strategy equity versus benchmark"
            series={[
              { name: "Strategy", points: r.equity, color: SERIES.primary },
              { name: "S&P 500 (simulated)", points: r.benchmark, color: SERIES.benchmark, dashed: true },
            ]}
          />
        </Card>
        <Card title="Strategy vs. benchmark" subtitle="Return per period">
          <div className="compare">
            <div>
              <span className="muted small">Strategy</span>
              <strong className={tone(r.totalReturnPct)}>{signedPct(r.totalReturnPct)}</strong>
            </div>
            <div>
              <span className="muted small">Benchmark</span>
              <strong>{signedPct(r.benchmarkReturnPct)}</strong>
            </div>
            <Badge tone={alpha >= 0 ? "success" : "danger"}>{signedPct(alpha)} vs. benchmark</Badge>
          </div>
          <GroupedBars label="Period returns, strategy versus benchmark" names={["Strategy", "Benchmark"]} data={r.periods.map((p) => ({ label: p.label, a: p.strategy, b: p.benchmark }))} />
        </Card>
      </div>

      <Card
        title="Trade history"
        subtitle={`${showAll ? "All" : "Latest"} simulated trades from this backtest · ${r.totalTrades} total`}
        actions={
          r.trades.length > 10 && (
            <button type="button" className="link-btn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show latest 10" : "View all trades"} <Icon name="chevronRight" size={14} />
            </button>
          )
        }
        flush
      >
        {r.trades.length === 0 ? (
          <p className="empty">The strategy produced no trades in this period.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Side</th><th className="num">Quantity</th><th className="num">Fill price</th><th className="num">Fee</th><th className="num">Realized P/L</th></tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td>{longDate(t.date)}</td>
                    <td><SideBadge side={t.side} /></td>
                    <td className="num">{t.quantity}</td>
                    <td className="num">{money(t.price)}</td>
                    <td className="num">{money(t.fee)}</td>
                    <td className={`num ${t.pnl === null ? "" : tone(t.pnl)}`}>{t.pnl === null ? "—" : signedMoney(t.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

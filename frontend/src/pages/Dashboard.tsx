import { useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, SERIES, Sparkline } from "../components/charts";
import { Icon, type IconName } from "../components/Icon";
import { Badge, Card, DataState, IconTile, Notice, Segmented, Stat, SymbolMark } from "../components/ui";
import { type PerfRange, getActivity, getAnalysis, getPerformance, getPortfolio, getPositions } from "../data/service";
import type { Activity } from "../data/types";
import { money, pct, relativeTime, signedMoney, signedPct, timeOnly, tone } from "../lib/format";
import { useAsync, useNow, useVisibleInterval } from "../lib/hooks";
import { useSession } from "../lib/session";

const RANGES: PerfRange[] = ["1W", "1M", "3M", "1Y", "ALL"];
const REFRESH_MS = 30_000;
const STALE_MS = 2 * 60_000;

function greeting(timeZone: string) {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  } catch {
    // keep local hour
  }
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  const { settings } = useSession();
  const [range, setRange] = useState<PerfRange>("1M");
  const portfolio = useAsync(getPortfolio, []);
  const positions = useAsync(getPositions, []);
  const activity = useAsync(() => getActivity(6), []);
  const perf = useAsync(() => getPerformance(range), [range]);
  const now = useNow(5000);

  // Safe refresh: skipped while the tab is hidden; useAsync collapses overlapping reloads.
  useVisibleInterval(() => {
    void portfolio.reload();
    void positions.reload();
    void activity.reload();
  }, REFRESH_MS);

  const stale = portfolio.loadedAt !== null && now - portfolio.loadedAt > STALE_MS;
  const p = portfolio.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">
            {greeting(settings.timezone)}, {settings.displayName}
          </h2>
          <p className="muted">Here's your portfolio overview and latest trading activity.</p>
        </div>
        <div className="page-head-aside">
          {p?.mode === "paper" && (
            <Badge tone="success" dot>
              Paper trading account (simulated)
            </Badge>
          )}
          <span className="muted small" aria-live="polite">
            {portfolio.loading ? "Refreshing…" : portfolio.loadedAt ? `Updated ${relativeTime(new Date(portfolio.loadedAt).toISOString(), now)}` : ""}
          </span>
          <button type="button" className="icon-btn" aria-label="Refresh dashboard" onClick={() => {
            void portfolio.reload();
            void positions.reload();
            void activity.reload();
            void perf.reload();
          }}>
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      {stale && (
        <Notice tone="warning" title="Data may be out of date">
          The last successful update was {relativeTime(new Date(portfolio.loadedAt!).toISOString(), now)}.
        </Notice>
      )}

      <div className="stat-grid">
        <DataState state={portfolio} rows={2}>
          {(d) => (
            <>
              <Stat
                label="Portfolio value"
                value={money(d.portfolioValue)}
                foot={`${signedMoney(d.dayChange)} today`}
                footTone={tone(d.dayChange)}
                aside={perf.data && <Sparkline values={perf.data.series.map((x) => x.value)} tone={tone(d.dayChange)} />}
              />
              <Stat
                label="Available cash"
                value={money(d.availableCash)}
                foot={`${pct((d.availableCash / d.portfolioValue) * 100)} of portfolio`}
                footTone="info"
                aside={<IconTile name="shield" />}
              />
              <Stat
                label="Total return"
                value={signedPct(d.totalReturnPct)}
                foot={`${signedMoney(d.totalReturnAmount)} all time`}
                footTone={tone(d.totalReturnAmount)}
                aside={<IconTile name={d.totalReturnPct >= 0 ? "trendUp" : "trendDown"} tone={d.totalReturnPct >= 0 ? "success" : "danger"} />}
              />
              <Stat
                label="Active strategies"
                value={d.activeStrategies}
                foot={<BotStatus status={d.botStatus} />}
                footTone="info"
                aside={<IconTile name="sliders" />}
              />
            </>
          )}
        </DataState>
      </div>

      <div className="grid-main">
        <Card
          title="Portfolio performance"
          subtitle="Simulated value of current holdings over time"
          actions={<Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />}
        >
          <DataState state={perf} rows={6} isEmpty={(d) => d.series.length < 2} empty="Not enough history yet.">
            {(d) => {
              const last = d.series[d.series.length - 1].value;
              const first = d.series[0].value;
              return (
                <>
                  <div className="hero-number">
                    <strong>{money(last)}</strong>
                    <span className={tone(last - first)}>
                      {signedMoney(last - first)} ({signedPct(((last - first) / first) * 100, 2)})
                    </span>
                  </div>
                  <LineChart
                    label={`Portfolio value over ${range}`}
                    series={[
                      { name: "Portfolio", points: d.series, color: SERIES.primary },
                      { name: "S&P 500 (simulated)", points: d.benchmark, color: SERIES.benchmark, dashed: true },
                    ]}
                  />
                </>
              );
            }}
          </DataState>
        </Card>

        <Card title="Recent activity" subtitle="Decisions, orders, and executions" actions={<Link to="/trade-history" className="link-btn">All activity</Link>}>
          <DataState state={activity} rows={5} isEmpty={(d) => d.length === 0} empty="No activity yet.">
            {(items) => (
              <ul className="activity">
                {items.map((a) => (
                  <ActivityRow key={a.id} item={a} timeZone={settings.timezone} />
                ))}
              </ul>
            )}
          </DataState>
        </Card>
      </div>

      <div className="grid-main">
        <Card
          title="Open positions"
          subtitle={positions.data ? `${positions.data.length} active positions · prices are simulated` : undefined}
          actions={<Link to="/paper-trading" className="link-btn">Manage positions <Icon name="chevronRight" size={14} /></Link>}
          flush
        >
          <DataState state={positions} rows={4} isEmpty={(d) => d.length === 0} empty="No open positions. Place a paper order to get started.">
            {(rows) => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="num">Quantity</th>
                      <th className="num">Average cost</th>
                      <th className="num">Current price</th>
                      <th className="num">Market value</th>
                      <th className="num">Unrealized P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const pl = (r.currentPrice - r.averageCost) * r.quantity;
                      return (
                        <tr key={r.symbol}>
                          <td>
                            <div className="sym-cell">
                              <SymbolMark symbol={r.symbol} />
                              <div>
                                <strong>{r.symbol}</strong>
                                <span className="muted small">{r.name}</span>
                              </div>
                            </div>
                          </td>
                          <td className="num">{r.quantity}</td>
                          <td className="num">{money(r.averageCost)}</td>
                          <td className="num">{money(r.currentPrice)}</td>
                          <td className="num">{money(r.currentPrice * r.quantity)}</td>
                          <td className={`num ${tone(pl)}`}>{signedMoney(pl)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DataState>
        </Card>

        <div className="stack">
          <AiInsightCard />
          <Card title="Quick actions">
            <div className="quick-actions">
              <QuickAction to="/strategies" icon="sliders" label="View strategies" />
              <QuickAction to="/backtesting" icon="history" label="Start backtest" />
              <QuickAction to="/paper-trading" icon="trendUp" label="Open paper trading" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BotStatus({ status }: { status: "running" | "stopped" | "error" }) {
  const copy = { running: "Trading engine running", stopped: "Trading engine stopped", error: "Trading engine error" }[status];
  return (
    <span className={`bot-status ${status}`}>
      <span className="live-dot" aria-hidden />
      {copy}
    </span>
  );
}

const ACTIVITY_ICON: Record<Activity["kind"], IconName> = {
  order: "clock",
  execution: "trendUp",
  signal: "sparkles",
  system: "sliders",
};

function ActivityRow({ item, timeZone }: { item: Activity; timeZone: string }) {
  const icon = item.kind === "execution" && item.side === "SELL" ? "trendDown" : ACTIVITY_ICON[item.kind];
  const t = item.kind === "execution" ? (item.side === "SELL" ? "danger" : "success") : "info";
  return (
    <li>
      <IconTile name={icon} tone={t} />
      <div>
        <strong>{item.title}</strong>
        <span className="muted small">{item.detail}</span>
      </div>
      <time className="muted small" dateTime={item.time}>
        {timeOnly(item.time, timeZone)}
      </time>
    </li>
  );
}

function AiInsightCard() {
  const report = useAsync(() => getAnalysis("ma-crossover"), []);
  return (
    <Card title="AI insight" icon="sparkles" actions={<Badge tone="info">Model generated</Badge>}>
      <DataState state={report} rows={2}>
        {(r) =>
          r ? (
            <div className="insight">
              <strong>{r.headline}</strong>
              <p className="muted small">{r.summary.split(". ")[0]}.</p>
              <Link to="/ai-analysis" className="link-btn">
                View analysis <Icon name="chevronRight" size={14} />
              </Link>
            </div>
          ) : (
            <div className="insight">
              <p className="muted small">No analysis has been run yet.</p>
              <Link to="/ai-analysis" className="link-btn">
                Run an analysis <Icon name="chevronRight" size={14} />
              </Link>
            </div>
          )
        }
      </DataState>
    </Card>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <Link to={to} className="quick-action">
      <Icon name={icon} size={16} />
      <span>{label}</span>
      <Icon name="chevronRight" size={14} />
    </Link>
  );
}

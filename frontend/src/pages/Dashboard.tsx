import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, SERIES, Sparkline } from "../components/charts";
import { Icon, type IconName } from "../components/Icon";
import { PositionsTable } from "../components/PositionsTable";
import { Badge, Card, DataState, IconTile, Notice, Segmented, Stat } from "../components/ui";
import { type PerfRange, getActivity, getAnalysis, getPerformance, getPortfolio, getPositions } from "../data/service";
import type { Activity, BotStatus as BotStatusValue, Point } from "../data/types";
import { hourIn, money, pct, relativeTime, signedMoney, signedPct, timeOnly, tone } from "../lib/format";
import { useAsync, useNow, useVisibleInterval } from "../lib/hooks";
import { useSession } from "../lib/session";

const RANGES: PerfRange[] = ["1W", "1M", "3M", "1Y", "ALL"];
const REFRESH_MS = 30_000;
const STALE_MS = 2 * 60_000;

function greeting(timeZone: string) {
  const hour = hourIn(timeZone);
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  const { settings } = useSession();
  const [range, setRange] = useState<PerfRange>("1M");
  const portfolio = useAsync(getPortfolio, []);
  const positions = useAsync(getPositions, []);
  const activity = useAsync(() => getActivity(6), []);
  const perf = useAsync(() => getPerformance(range), [range]);

  function refresh() {
    void portfolio.reload();
    void positions.reload();
    void activity.reload();
  }
  // Safe refresh: skipped while the tab is hidden; useAsync collapses overlapping reloads.
  useVisibleInterval(refresh, REFRESH_MS);

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
            {portfolio.loading ? "Refreshing…" : portfolio.loadedAt && <UpdatedAgo at={portfolio.loadedAt} />}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Refresh dashboard"
            onClick={() => {
              refresh();
              void perf.reload();
            }}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      {portfolio.loadedAt && <StaleNotice loadedAt={portfolio.loadedAt} />}

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
              <Stat label="Active strategies" value={d.activeStrategies} foot={<BotStatus status={d.botStatus} />} footTone="info" aside={<IconTile name="sliders" />} />
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
            {(d) => <PerformanceChart series={d.series} benchmark={d.benchmark} range={range} />}
          </DataState>
        </Card>

        <Card
          title="Recent activity"
          subtitle="Decisions, orders, and executions"
          actions={
            <Link to="/trade-history" className="link-btn">
              All activity
            </Link>
          }
        >
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
          actions={
            <Link to="/paper-trading" className="link-btn">
              Manage positions <Icon name="chevronRight" size={14} />
            </Link>
          }
          flush
        >
          <DataState state={positions} rows={4} isEmpty={(d) => d.length === 0} empty="No open positions. Place a paper order to get started.">
            {(rows) => <PositionsTable rows={rows} detailed />}
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

/** Own timer so only this label re-renders, not the whole dashboard. */
function UpdatedAgo({ at }: { at: number }) {
  const now = useNow(15_000);
  return <>Updated {relativeTime(at, now)}</>;
}

function StaleNotice({ loadedAt }: { loadedAt: number }) {
  const now = useNow(15_000);
  if (now - loadedAt <= STALE_MS) return null;
  return (
    <Notice tone="warning" title="Data may be out of date">
      The last successful update was {relativeTime(loadedAt, now)}.
    </Notice>
  );
}

function PerformanceChart({ series, benchmark, range }: { series: Point[]; benchmark: Point[]; range: PerfRange }) {
  const lines = useMemo(
    () => [
      { name: "Portfolio", points: series, color: SERIES.primary },
      { name: "S&P 500 (simulated)", points: benchmark, color: SERIES.benchmark, dashed: true },
    ],
    [series, benchmark],
  );
  const last = series[series.length - 1].value;
  const first = series[0].value;
  return (
    <>
      <div className="hero-number">
        <strong>{money(last)}</strong>
        <span className={tone(last - first)}>
          {signedMoney(last - first)} ({signedPct(((last - first) / first) * 100, 2)})
        </span>
      </div>
      <LineChart label={`Portfolio value over ${range}`} series={lines} />
    </>
  );
}

const BOT_COPY: Record<BotStatusValue, string> = {
  running: "Trading engine running",
  stopped: "Trading engine stopped",
  error: "Trading engine error",
};

function BotStatus({ status }: { status: BotStatusValue }) {
  return (
    <span className={`bot-status ${status}`}>
      <span className="live-dot" aria-hidden />
      {BOT_COPY[status]}
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
  const sell = item.kind === "execution" && item.side === "SELL";
  return (
    <li>
      <IconTile name={sell ? "trendDown" : ACTIVITY_ICON[item.kind]} tone={item.kind === "execution" ? (sell ? "danger" : "success") : "info"} />
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
        {(r) => (
          <div className="insight">
            {r ? (
              <>
                <strong>{r.headline}</strong>
                <p className="muted small">{r.summary.split(". ")[0]}.</p>
              </>
            ) : (
              <p className="muted small">No analysis has been run yet.</p>
            )}
            <Link to="/ai-analysis" className="link-btn">
              {r ? "View analysis" : "Run an analysis"} <Icon name="chevronRight" size={14} />
            </Link>
          </div>
        )}
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

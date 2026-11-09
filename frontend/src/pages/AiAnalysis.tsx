import { type FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LineChart, Ring, SERIES } from "../components/charts";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { RECOMMENDATION_TONES } from "../components/tones";
import { Badge, Card, DataState, ErrorState, IconTile, Notice, Skeleton, StatusBadge, type Tone } from "../components/ui";
import { getAnalysis, getStrategies, runAnalysis, setRecommendationStatus } from "../data/service";
import type { AnalysisFactor, AnalysisReport, Recommendation, RecommendationStatus } from "../data/types";
import { daysAgo, dateTime, errorMessage, longDate, money, pct, signedPct, tone } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";
import type { BacktestNavState } from "./Backtesting";

const FACTOR_TONES: Record<AnalysisFactor["strength"], Tone> = {
  Strong: "success",
  Positive: "success",
  Moderate: "info",
  Elevated: "warning",
  Weak: "warning",
};

export function AiAnalysis() {
  const { settings } = useSession();
  const strategies = useAsync(getStrategies, []);
  const [strategyId, setStrategyId] = useState("ma-crossover");
  const [start, setStart] = useState(daysAgo(180));
  const [end, setEnd] = useState(daysAgo(0));
  const report = useAsync(() => getAnalysis(strategyId), [strategyId]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const periodError = !start || !end ? "Choose both dates" : end < start ? "End date cannot be before the start date" : undefined;

  async function run(e: FormEvent) {
    e.preventDefault();
    if (periodError || running) return;
    setRunning(true);
    setRunError(null);
    try {
      report.setData(await runAnalysis(strategyId, start, end));
    } catch (err) {
      setRunError(errorMessage(err, "Analysis failed"));
    } finally {
      setRunning(false);
    }
  }

  const r = report.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">AI Analysis & Recommendations</h2>
          <p className="muted">
            {r
              ? `Last run ${dateTime(r.runAt, settings.timezone)} · data period ${longDate(r.period.start)} – ${longDate(r.period.end)} · model ${r.model}`
              : "Analyse a strategy's historical results and get suggestions to review."}
          </p>
        </div>
      </div>

      <form className="card ai-controls" onSubmit={run} noValidate>
        <Field label="Strategy">
          <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
            {(strategies.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Analysis start" error={periodError && !start ? periodError : undefined}>
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Analysis end" error={periodError && start ? periodError : undefined}>
          <input type="date" value={end} max={daysAgo(0)} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={running || Boolean(periodError)}>
          <Icon name="sparkles" size={16} /> {running ? "Analysing…" : r ? "Refresh analysis" : "Run analysis"}
        </button>
      </form>

      <Notice tone="info" title="Simulated AI insights — for educational use">
        Text marked <em>model generated</em> is an interpretation, not a verified fact. Figures marked <em>computed</em> come from a simulated backtest. Nothing here is
        financial advice or an executed trade.
      </Notice>

      {runError && <ErrorState message={runError} />}

      {running ? (
        <Card>
          <Skeleton rows={8} />
        </Card>
      ) : (
        <DataState state={report} rows={8} isEmpty={(x) => x === null} empty="No analysis yet for this strategy. Choose a period and run one.">
          {(x) => x && <Report report={x} onChange={report.setData} />}
        </DataState>
      )}
    </div>
  );
}

function Report({ report: r, onChange }: { report: AnalysisReport; onChange: (r: AnalysisReport) => void }) {
  const [openDetails, setOpenDetails] = useState(true);
  const last = r.equity[r.equity.length - 1]?.value ?? 0;
  const first = r.equity[0]?.value ?? 0;
  const lines = useMemo(
    () => [
      { name: "Strategy", points: r.equity, color: SERIES.primary },
      { name: "Benchmark", points: r.benchmark, color: SERIES.benchmark, dashed: true },
    ],
    [r.equity, r.benchmark],
  );

  return (
    <>
      <div className="grid-main even">
        <Card title="Strategy performance" subtitle={`${r.strategyName} · ${r.symbol} · ${r.equity.length} simulated days`} icon="trendUp" actions={<Badge tone="neutral">Computed</Badge>}>
          <div className="hero-number">
            <span className="muted small">Simulated portfolio value</span>
            <strong>{money(last)}</strong>
            <span className={tone(last - first)}>{signedPct(((last - first) / first) * 100)} over the period</span>
          </div>
          <LineChart label="Strategy versus benchmark during the analysis period" height={220} series={lines} />
          <dl className="metric-row">
            <div>
              <dt>Total return</dt>
              <dd className={tone(r.metrics.totalReturnPct)}>{signedPct(r.metrics.totalReturnPct)}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{pct(r.metrics.winRate, 0)}</dd>
            </div>
            <div>
              <dt>Profit factor</dt>
              <dd>{r.metrics.profitFactor.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Risk score</dt>
              <dd>{r.metrics.riskScore} / 100</dd>
            </div>
          </dl>
        </Card>

        <Card title="AI insights" subtitle="Model interpretation of the results" icon="sparkles" actions={<Badge tone="info">Model generated</Badge>}>
          <div className="insight-head">
            <Badge tone={r.signalLabel === "Outperforming" ? "success" : "warning"}>{r.signalLabel}</Badge>
            <strong>{r.headline}</strong>
          </div>
          <p className="muted">{r.summary}</p>
          {r.confidence?.validated ? (
            <div className="confidence">
              <Ring value={r.confidence.value}>{r.confidence.value}%</Ring>
              <div>
                <strong>Model confidence: {r.confidence.value}%</strong>
                <span className="muted small">{r.confidence.note}</span>
              </div>
            </div>
          ) : (
            <div className="confidence muted small">
              <Icon name="info" size={16} /> No validated confidence measure is available for this model, so none is shown.
            </div>
          )}
          <span className="eyebrow">Factors influencing this analysis</span>
          <ul className="factor-list">
            {r.factors.map((f) => (
              <li key={f.label}>
                <Icon name="check" size={14} />
                <span>{f.label}</span>
                <Badge tone={FACTOR_TONES[f.strength]}>{f.strength}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="section-head">
        <div>
          <h3>Recommended actions</h3>
          <p className="muted small">Ideas to review, not automated trading instructions. Each must be backtested before it can be accepted.</p>
        </div>
        <Badge tone="neutral">{r.recommendations.length} items</Badge>
      </div>
      <div className="rec-grid">
        {r.recommendations.map((rec) => (
          <RecommendationCard
            key={rec.id}
            report={r}
            rec={rec}
            onUpdated={(updated) => onChange({ ...r, recommendations: r.recommendations.map((x) => (x.id === updated.id ? updated : x)) })}
          />
        ))}
      </div>

      <section className="card">
        <button type="button" className="card-head collapse-head" aria-expanded={openDetails} onClick={() => setOpenDetails((v) => !v)}>
          <IconTile name="info" />
          <div className="card-titles">
            <h2 className="card-title">Explanation & model transparency</h2>
            <p className="card-sub">Supporting signals, known limitations, and uncertainty</p>
          </div>
          <Icon name="chevronDown" className={openDetails ? "rot" : ""} />
        </button>
        {openDetails && (
          <div className="transparency">
            <TransparencyCol icon="trendUp" tone="success" title="Supporting signals" items={r.transparency.supporting} />
            <TransparencyCol icon="shield" tone="warning" title="Limitations" items={r.transparency.limitations} />
            <TransparencyCol icon="info" tone="info" title="Uncertainty" items={r.transparency.uncertainty} />
          </div>
        )}
      </section>
    </>
  );
}

function TransparencyCol({ icon, tone: t, title, items }: { icon: "trendUp" | "shield" | "info"; tone: Tone; title: string; items: string[] }) {
  return (
    <div>
      <IconTile name={icon} tone={t} />
      <strong>{title}</strong>
      <ul>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function RecommendationCard({ report, rec, onUpdated }: { report: AnalysisReport; rec: Recommendation; onUpdated: (r: Recommendation) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: RecommendationStatus) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await setRecommendationStatus(report.strategyId, rec.id, status));
    } catch (err) {
      setError(errorMessage(err, "Update failed"));
    } finally {
      setBusy(false);
    }
  }

  async function backtest() {
    await setStatus("testing");
    const state: BacktestNavState = {
      strategyId: report.strategyId,
      overrides: rec.suggestedParams ?? {},
      note: `“${rec.title}” for ${report.strategyName}.`,
    };
    navigate("/backtesting", { state });
  }

  const closed = rec.status === "accepted" || rec.status === "rejected";

  return (
    <article className="card rec">
      <div className="rec-head">
        <IconTile name="sparkles" />
        <StatusBadge status={rec.status} tones={RECOMMENDATION_TONES} />
      </div>
      <strong>{rec.title}</strong>
      <p className="muted small">{rec.detail}</p>
      {rec.suggestedParams && (
        <p className="small">
          Suggested:{" "}
          {Object.entries(rec.suggestedParams)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}
        </p>
      )}
      {error && <span className="field-error">{error}</span>}
      {!closed && (
        <div className="button-row">
          {rec.suggestedParams && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={backtest}>
              <Icon name="history" size={14} /> Backtest
            </button>
          )}
          <button
            type="button"
            className="btn btn-success btn-sm"
            disabled={busy || rec.status !== "testing"}
            title={rec.status !== "testing" ? "Backtest and review this recommendation first" : undefined}
            onClick={() => setStatus("accepted")}
          >
            Accept
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus("rejected")}>
            Reject
          </button>
        </div>
      )}
      {!closed && rec.status !== "testing" && !rec.suggestedParams && (
        <button type="button" className="link-btn small" disabled={busy} onClick={() => setStatus("testing")}>
          Mark as under review
        </button>
      )}
    </article>
  );
}

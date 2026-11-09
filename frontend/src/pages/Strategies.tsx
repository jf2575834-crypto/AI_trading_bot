import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Ring } from "../components/charts";
import { Field } from "../components/Field";
import { Icon, type IconName } from "../components/Icon";
import { Badge, Card, DataState, ErrorState, Notice, Skeleton, Tabs, Toggle } from "../components/ui";
import { DEFAULT_RISK, getAnalysis, getRisk, getStrategies, saveRisk, saveStrategy } from "../data/service";
import type { ParamDef, RiskSettings, Strategy, StrategyKind } from "../data/types";
import { dateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";

type Tab = StrategyKind | "ai";

const STRATEGY_ICON: Record<string, IconName> = {
  "ma-crossover": "trendUp",
  "bullish-engulfing": "trendUp",
  rsi: "history",
  disclosure: "shield",
};

export function Strategies() {
  const [tab, setTab] = useState<Tab>("technical");
  const strategies = useAsync(getStrategies, []);
  const active = strategies.data?.filter((s) => s.enabled).length ?? 0;

  function replace(updated: Strategy) {
    strategies.setData((strategies.data ?? []).map((s) => (s.id === updated.id ? updated : s)));
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Strategy Configuration</h2>
          <p className="muted">Customize trading logic and define portfolio-level protection.</p>
        </div>
        {strategies.data && (
          <Badge tone="success" dot>
            {active} {active === 1 ? "strategy" : "strategies"} active
          </Badge>
        )}
      </div>

      <Tabs
        label="Strategy type"
        value={tab}
        onChange={setTab}
        items={[
          { value: "technical", label: "Technical Strategies", icon: "sliders" },
          { value: "disclosure", label: "Disclosure Strategy", icon: "shield" },
          { value: "ai", label: "AI Recommendations", icon: "sparkles" },
        ]}
      />

      <div className="grid-side">
        <div className="stack">
          {tab === "ai" ? (
            <AiRecommendations strategies={strategies.data ?? []} />
          ) : (
            <DataState state={strategies} rows={6}>
              {(list) => {
                const items = list.filter((s) => s.kind === tab);
                return (
                  <>
                    <div className="section-head">
                      <div>
                        <h3>{tab === "technical" ? "Technical strategies" : "Disclosure strategy"}</h3>
                        <p className="muted small">Activate a strategy and configure how its signals are generated.</p>
                      </div>
                      <span className="muted small">
                        {items.filter((s) => s.enabled).length} of {items.length} active
                      </span>
                    </div>
                    {items.map((s) => (
                      <StrategyCard key={s.id} strategy={s} onSaved={replace} />
                    ))}
                  </>
                );
              }}
            </DataState>
          )}
        </div>
        <RiskPanel />
      </div>
    </div>
  );
}

function StrategyCard({ strategy, onSaved }: { strategy: Strategy; onSaved: (s: Strategy) => void }) {
  const { settings } = useSession();
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggle(enabled: boolean) {
    setToggling(true);
    setToggleError(null);
    try {
      onSaved(await saveStrategy({ ...strategy, enabled }));
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Couldn't update strategy");
    } finally {
      setToggling(false);
    }
  }

  return (
    <article className={`card strategy ${open ? "open" : ""}`}>
      <header className="strategy-head">
        <span className={`icon-tile tone-${strategy.enabled ? "success" : "neutral"}`}>
          <Icon name={STRATEGY_ICON[strategy.id] ?? "sliders"} />
        </span>
        <div className="strategy-text">
          <h4>{strategy.name}</h4>
          <p className="muted small">{strategy.description}</p>
          <span className="eyebrow">{strategy.tags.join(" · ")}</span>
        </div>
        <div className="strategy-controls">
          <span className={`small ${strategy.enabled ? "up" : "muted"}`}>{strategy.enabled ? "Active" : "Inactive"}</span>
          <Toggle label={`Enable ${strategy.name}`} checked={strategy.enabled} disabled={toggling} onChange={toggle} />
          <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Configure"}
          </button>
        </div>
      </header>
      {toggleError && <ErrorState message={toggleError} compact />}
      {open && (
        <ParamForm
          strategy={strategy}
          onSaved={(s) => {
            onSaved(s);
          }}
        />
      )}
      <footer className="strategy-foot muted small">
        Version {strategy.version} · last saved {dateTime(strategy.updatedAt, settings.timezone)}
      </footer>
    </article>
  );
}

type Draft = Record<string, string>;

function toDraft(s: Strategy): Draft {
  return Object.fromEntries(
    s.paramDefs.map((d) => [d.key, Array.isArray(s.params[d.key]) ? (s.params[d.key] as string[]).join(", ") : String(s.params[d.key] ?? "")]),
  );
}

function validateParam(def: ParamDef, raw: string): string | undefined {
  if (def.kind === "symbols") {
    const list = raw.split(",").map((x) => x.trim()).filter(Boolean);
    const bad = list.find((x) => !/^[A-Za-z]{1,5}$/.test(x));
    return bad ? `"${bad}" is not a valid ticker` : undefined;
  }
  if (raw.trim() === "") return "Required";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a number";
  if (def.kind === "int" && !Number.isInteger(n)) return "Enter a whole number";
  if (def.min !== undefined && n < def.min) return `Must be at least ${def.min}`;
  if (def.max !== undefined && n > def.max) return `Must be at most ${def.max}`;
  return undefined;
}

function ParamForm({ strategy, onSaved }: { strategy: Strategy; onSaved: (s: Strategy) => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(strategy));
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(toDraft(strategy)), [strategy]);

  const errors: Record<string, string | undefined> = {};
  for (const def of strategy.paramDefs) errors[def.key] = validateParam(def, draft[def.key] ?? "");
  if (strategy.id === "ma-crossover" && !errors.longWindow && !errors.shortWindow && Number(draft.longWindow) <= Number(draft.shortWindow)) {
    errors.longWindow = "Must be greater than the fast period";
  }
  if (strategy.id === "rsi" && !errors.overbought && !errors.oversold && Number(draft.overbought) <= Number(draft.oversold)) {
    errors.overbought = "Must be greater than the oversold level";
  }
  const hasErrors = Object.values(errors).some(Boolean);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(strategy));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setStatus(null);
    if (hasErrors) return;
    setSaving(true);
    const params: Strategy["params"] = {};
    for (const def of strategy.paramDefs) {
      params[def.key] =
        def.kind === "symbols"
          ? draft[def.key].split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
          : Number(draft[def.key]);
    }
    try {
      const saved = await saveStrategy({ ...strategy, params });
      onSaved(saved);
      setStatus({ tone: "success", text: `Saved as version ${saved.version}.` });
      setTouched(false);
    } catch (err) {
      setStatus({ tone: "danger", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="param-form" onSubmit={submit} noValidate>
      <div className="section-head">
        <span className="eyebrow-strong">
          <Icon name="settings" size={14} /> Strategy parameters
        </span>
        <span className="muted small">Changes apply after saving</span>
      </div>
      <div className="form-grid two">
        {strategy.paramDefs.map((def) => (
          <Field key={def.key} label={def.label} hint={def.hint} error={touched || draft[def.key] !== toDraft(strategy)[def.key] ? errors[def.key] : undefined}>
            <input
              inputMode={def.kind === "int" ? "numeric" : def.kind === "decimal" ? "decimal" : "text"}
              value={draft[def.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [def.key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <div className="form-actions">
        {status && (
          <span className={`save-status ${status.tone}`} role="status">
            <Icon name={status.tone === "success" ? "check" : "alert"} size={14} /> {status.text}
          </span>
        )}
        <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={() => setDraft(toDraft(strategy))}>
          Discard
        </button>
        <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save parameters"}
        </button>
      </div>
    </form>
  );
}

type RiskDraft = Record<"maxPositionSize" | "maxExposurePct" | "stopLossPct" | "takeProfitPct" | "dailyLossLimit", string> & {
  approvalRequired: boolean;
};

function riskDraft(r: Omit<RiskSettings, "version" | "updatedAt">): RiskDraft {
  return {
    maxPositionSize: String(r.maxPositionSize),
    maxExposurePct: String(r.maxExposurePct),
    stopLossPct: String(r.stopLossPct),
    takeProfitPct: String(r.takeProfitPct),
    dailyLossLimit: String(r.dailyLossLimit),
    approvalRequired: r.approvalRequired,
  };
}

function validateRisk(d: RiskDraft) {
  const n = (k: keyof RiskDraft) => Number(d[k]);
  const e: Partial<Record<keyof RiskDraft, string>> = {};
  if (!(n("maxPositionSize") > 0)) e.maxPositionSize = "Enter an amount greater than 0";
  if (!(n("maxExposurePct") > 0 && n("maxExposurePct") <= 100)) e.maxExposurePct = "Enter 1 to 100";
  if (!(n("stopLossPct") > 0 && n("stopLossPct") <= 50)) e.stopLossPct = "Enter above 0, up to 50";
  if (!(n("takeProfitPct") > 0 && n("takeProfitPct") <= 500)) e.takeProfitPct = "Enter above 0, up to 500";
  else if (!e.stopLossPct && n("takeProfitPct") <= n("stopLossPct")) e.takeProfitPct = "Usually larger than the stop loss";
  if (!(n("dailyLossLimit") > 0)) e.dailyLossLimit = "Enter an amount greater than 0";
  return e;
}

function riskProfile(d: RiskDraft): { label: string; level: number; color: string; text: string } {
  const score = Number(d.maxExposurePct) / 100 * 0.6 + Math.min(Number(d.stopLossPct), 20) / 20 * 0.4;
  if (score < 0.45) return { label: "Low", level: score * 100, color: "#22c55e", text: "Current settings prioritize capital protection." };
  if (score < 0.7) return { label: "Medium", level: score * 100, color: "#eab308", text: "Balanced between growth and protection." };
  return { label: "High", level: Math.min(100, score * 100), color: "#ef4444", text: "Settings allow large exposure and wide stops." };
}

function RiskPanel() {
  const { settings } = useSession();
  const risk = useAsync(getRisk, []);
  const [draft, setDraft] = useState<RiskDraft | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    if (risk.data) setDraft(riskDraft(risk.data));
  }, [risk.data]);

  if (!risk.data || !draft) {
    return (
      <Card title="Risk Settings" icon="shield">
        {risk.error ? <ErrorState message={risk.error} onRetry={risk.reload} /> : <Skeleton rows={6} />}
      </Card>
    );
  }

  const errors = validateRisk(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const profile = riskProfile(draft);
  const set = (k: keyof RiskDraft, v: string | boolean) => {
    setDraft({ ...draft, [k]: v });
    setStatus(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (hasErrors || !risk.data || !draft) return;
    setSaving(true);
    try {
      const saved = await saveRisk({
        ...risk.data,
        maxPositionSize: Number(draft.maxPositionSize),
        maxExposurePct: Number(draft.maxExposurePct),
        stopLossPct: Number(draft.stopLossPct),
        takeProfitPct: Number(draft.takeProfitPct),
        dailyLossLimit: Number(draft.dailyLossLimit),
        approvalRequired: draft.approvalRequired,
      });
      risk.setData(saved);
      setStatus({ tone: "success", text: `Saved as version ${saved.version}.` });
      setTouched(false);
    } catch (err) {
      setStatus({ tone: "danger", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  const err = (k: keyof RiskDraft) => (touched ? errors[k] : undefined);

  return (
    <Card title="Risk Settings" subtitle="Global limits for every active strategy" icon="shield" className="risk-panel">
      <form onSubmit={submit} noValidate className="stack-sm">
        <div className="risk-profile">
          <Ring value={profile.level} color={profile.color} size={58}>
            <span className="ring-short">{profile.label === "Medium" ? "MED" : profile.label.toUpperCase()}</span>
          </Ring>
          <div>
            <strong>{profile.label === "Low" ? "Conservative" : profile.label === "Medium" ? "Moderate" : "Aggressive"} risk profile</strong>
            <span className="muted small">{profile.text}</span>
          </div>
        </div>

        <Field label="Max position size ($)" error={err("maxPositionSize")} hint="Maximum value of a single position">
          <input inputMode="decimal" value={draft.maxPositionSize} onChange={(e) => set("maxPositionSize", e.target.value)} />
        </Field>
        <div className="form-grid two">
          <Field label="Portfolio exposure limit (%)" error={err("maxExposurePct")}>
            <input inputMode="decimal" value={draft.maxExposurePct} onChange={(e) => set("maxExposurePct", e.target.value)} />
          </Field>
          <Field label="Stop loss (%)" error={err("stopLossPct")}>
            <input inputMode="decimal" value={draft.stopLossPct} onChange={(e) => set("stopLossPct", e.target.value)} />
          </Field>
          <Field label="Take profit (%)" error={err("takeProfitPct")}>
            <input inputMode="decimal" value={draft.takeProfitPct} onChange={(e) => set("takeProfitPct", e.target.value)} />
          </Field>
          <Field label="Daily loss limit ($)" error={err("dailyLossLimit")}>
            <input inputMode="decimal" value={draft.dailyLossLimit} onChange={(e) => set("dailyLossLimit", e.target.value)} />
          </Field>
        </div>

        <div className="toggle-row">
          <div>
            <strong>Trade approval required</strong>
            <span className="muted small">Manually approve each strategy-generated trade before execution.</span>
          </div>
          <Toggle label="Trade approval required" checked={draft.approvalRequired} onChange={(v) => set("approvalRequired", v)} />
        </div>

        <Notice tone="info">
          Limits are enforced by the trading engine on every order, not only by this form. These settings apply to paper trading only.
        </Notice>

        {status && (
          <span className={`save-status ${status.tone}`} role="status">
            <Icon name={status.tone === "success" ? "check" : "alert"} size={14} /> {status.text}
          </span>
        )}
        <div className="button-row">
          <button type="button" className="btn btn-secondary" onClick={() => setDraft(riskDraft(DEFAULT_RISK))}>
            Reset to defaults
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Icon name="check" size={16} /> {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
        <p className="muted small">
          Version {risk.data.version} · last saved {dateTime(risk.data.updatedAt, settings.timezone)}
        </p>
      </form>
    </Card>
  );
}

function AiRecommendations({ strategies }: { strategies: Strategy[] }) {
  const reports = useAsync(
    () => Promise.all(strategies.map((s) => getAnalysis(s.id))).then((r) => r.filter((x) => x !== null)),
    [strategies.length],
  );
  return (
    <>
      <Notice tone="info" title="Model-generated suggestions">
        Recommendations are not applied automatically. Each must be backtested and reviewed before it is accepted into a strategy.
      </Notice>
      <DataState
        state={reports}
        rows={4}
        isEmpty={(r) => r.length === 0}
        empty={
          <>
            No analyses yet. <Link to="/ai-analysis" className="link-btn">Run an AI analysis</Link>
          </>
        }
      >
        {(list) =>
          list.map((r) => (
            <Card key={r!.id} title={r!.strategyName} subtitle={`${r!.recommendations.length} recommendations`} actions={<Link className="link-btn" to="/ai-analysis">Open analysis</Link>}>
              <ul className="rec-list">
                {r!.recommendations.map((rec) => (
                  <li key={rec.id}>
                    <span>{rec.title}</span>
                    <RecStatus status={rec.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ))
        }
      </DataState>
    </>
  );
}

export function RecStatus({ status }: { status: string }) {
  const tone = status === "accepted" ? "success" : status === "rejected" ? "danger" : status === "testing" ? "warning" : "info";
  return <Badge tone={tone}>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}

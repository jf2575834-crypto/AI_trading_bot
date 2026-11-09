import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ring } from "../components/charts";
import { Field } from "../components/Field";
import { Icon, type IconName } from "../components/Icon";
import { RECOMMENDATION_TONES } from "../components/tones";
import { Badge, Card, DataState, ErrorState, IconTile, Notice, SaveStatus, StatusBadge, Tabs, Toggle } from "../components/ui";
import { DEFAULT_RISK, getAnalysis, getRisk, getStrategies, saveRisk, saveStrategy } from "../data/service";
import { hasErrors, parseNumber, parseSymbols, validateParams, validateRisk } from "../data/rules";
import type { RiskSettings, Strategy, StrategyKind } from "../data/types";
import { dateTime, errorMessage } from "../lib/format";
import { useAsync, useSave } from "../lib/hooks";
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
      setToggleError(errorMessage(err, "Couldn't update strategy"));
    } finally {
      setToggling(false);
    }
  }

  return (
    <article className={`card strategy ${open ? "open" : ""}`}>
      <header className="strategy-head">
        <IconTile name={STRATEGY_ICON[strategy.id] ?? "sliders"} tone={strategy.enabled ? "success" : "neutral"} />
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
      {open && <ParamForm strategy={strategy} onSaved={onSaved} />}
      <footer className="strategy-foot muted small">
        Version {strategy.version} · last saved {dateTime(strategy.updatedAt, settings.timezone)}
      </footer>
    </article>
  );
}

type Draft = Record<string, string>;

function toDraft(s: Strategy): Draft {
  return Object.fromEntries(s.paramDefs.map((d) => {
    const v = s.params[d.key];
    return [d.key, Array.isArray(v) ? v.join(", ") : String(v ?? "")];
  }));
}

function ParamForm({ strategy, onSaved }: { strategy: Strategy; onSaved: (s: Strategy) => void }) {
  const initial = useMemo(() => toDraft(strategy), [strategy]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [touched, setTouched] = useState(false);
  const { saving, status, run } = useSave();

  useEffect(() => setDraft(initial), [initial]);

  const errors = validateParams(strategy.paramDefs, draft);
  const dirty = strategy.paramDefs.some((d) => draft[d.key] !== initial[d.key]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (hasErrors(errors)) return;
    const params: Strategy["params"] = Object.fromEntries(
      strategy.paramDefs.map((d) => [d.key, d.kind === "symbols" ? parseSymbols(draft[d.key]) : parseNumber(draft[d.key])]),
    );
    const saved = await run(() => saveStrategy({ ...strategy, params }), (s) => `Saved as version ${s.version}.`);
    if (saved) {
      onSaved(saved);
      setTouched(false);
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
          <Field key={def.key} label={def.label} hint={def.hint} error={touched || draft[def.key] !== initial[def.key] ? errors[def.key] : undefined}>
            <input
              inputMode={def.kind === "int" ? "numeric" : def.kind === "decimal" ? "decimal" : "text"}
              value={draft[def.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [def.key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <div className="form-actions">
        <SaveStatus status={status} />
        <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={() => setDraft(initial)}>
          Discard
        </button>
        <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save parameters"}
        </button>
      </div>
    </form>
  );
}

const RISK_FIELDS = ["maxPositionSize", "maxExposurePct", "stopLossPct", "takeProfitPct", "dailyLossLimit"] as const;
type RiskField = (typeof RISK_FIELDS)[number];
type RiskDraft = Record<RiskField, string> & { approvalRequired: boolean };

function riskDraft(r: Omit<RiskSettings, "version" | "updatedAt">): RiskDraft {
  const fields = Object.fromEntries(RISK_FIELDS.map((k) => [k, String(r[k])])) as Record<RiskField, string>;
  return { ...fields, approvalRequired: r.approvalRequired };
}

function riskValues(d: RiskDraft): Record<RiskField, number> {
  return Object.fromEntries(RISK_FIELDS.map((k) => [k, parseNumber(d[k])])) as Record<RiskField, number>;
}

const PROFILES = [
  { upTo: 0.45, short: "LOW", name: "Conservative", color: "#22c55e", text: "Current settings prioritize capital protection." },
  { upTo: 0.7, short: "MED", name: "Moderate", color: "#eab308", text: "Balanced between growth and protection." },
  { upTo: Infinity, short: "HIGH", name: "Aggressive", color: "#ef4444", text: "Settings allow large exposure and wide stops." },
];

function riskProfile(v: Record<RiskField, number>) {
  const score = (v.maxExposurePct / 100) * 0.6 + (Math.min(v.stopLossPct, 20) / 20) * 0.4;
  const profile = PROFILES.find((p) => score < p.upTo) ?? PROFILES[PROFILES.length - 1];
  return { ...profile, level: Math.min(100, score * 100) };
}

function RiskPanel() {
  const risk = useAsync(getRisk, []);
  return (
    <Card title="Risk Settings" subtitle="Global limits for every active strategy" icon="shield" className="risk-panel">
      <DataState state={risk} rows={6}>
        {(r) => <RiskForm risk={r} onSaved={risk.setData} />}
      </DataState>
    </Card>
  );
}

function RiskForm({ risk, onSaved }: { risk: RiskSettings; onSaved: (r: RiskSettings) => void }) {
  const { settings } = useSession();
  const [draft, setDraft] = useState(() => riskDraft(risk));
  const [touched, setTouched] = useState(false);
  const { saving, status, setStatus, run } = useSave();

  const values = riskValues(draft);
  const errors = validateRisk(values);
  const profile = riskProfile(values);
  const set = (k: keyof RiskDraft, v: string | boolean) => {
    setDraft({ ...draft, [k]: v });
    setStatus(null);
  };
  const err = (k: RiskField) => (touched ? errors[k] : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (hasErrors(errors)) return;
    const saved = await run(() => saveRisk({ ...risk, ...values, approvalRequired: draft.approvalRequired }), (r) => `Saved as version ${r.version}.`);
    if (saved) {
      onSaved(saved);
      setTouched(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack-sm">
      <div className="risk-profile">
        <Ring value={profile.level} color={profile.color} size={58}>
          <span className="ring-short">{profile.short}</span>
        </Ring>
        <div>
          <strong>{profile.name} risk profile</strong>
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

      <Notice tone="info">Limits are enforced by the trading engine on every order, not only by this form. These settings apply to paper trading only.</Notice>

      <SaveStatus status={status} />
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={() => setDraft(riskDraft(DEFAULT_RISK))}>
          Reset to defaults
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Icon name="check" size={16} /> {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
      <p className="muted small">
        Version {risk.version} · last saved {dateTime(risk.updatedAt, settings.timezone)}
      </p>
    </form>
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
            No analyses yet.{" "}
            <Link to="/ai-analysis" className="link-btn">
              Run an AI analysis
            </Link>
          </>
        }
      >
        {(list) =>
          list.map((r) => (
            <Card
              key={r.id}
              title={r.strategyName}
              subtitle={`${r.recommendations.length} recommendations`}
              actions={
                <Link className="link-btn" to="/ai-analysis">
                  Open analysis
                </Link>
              }
            >
              <ul className="rec-list">
                {r.recommendations.map((rec) => (
                  <li key={rec.id}>
                    <span>{rec.title}</span>
                    <StatusBadge status={rec.status} tones={RECOMMENDATION_TONES} />
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

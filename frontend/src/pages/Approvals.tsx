import { useMemo, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { DECISION_TONES } from "../components/tones";
import { Card, IconTile, RiskCheckBadge, Segmented, StatusBadge, SymbolMark, type Tone } from "../components/ui";
import { DEMO_MODE, markNotificationsRead, simulateSignal } from "../data/service";
import type { NotificationKind, PendingTrade } from "../data/types";
import { countdown, dateTime, money, relativeTime, secondsLeft } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useSession } from "../lib/session";

type Window = "24h" | "7d" | "all";
const DAY_MS = 86_400_000;
const WINDOW_MS: Record<Window, number> = { "24h": DAY_MS, "7d": 7 * DAY_MS, all: Infinity };

const NOTIF_ICON: Record<NotificationKind, { icon: IconName; tone: Tone }> = {
  approved: { icon: "check", tone: "success" },
  signal: { icon: "sparkles", tone: "info" },
  risk: { icon: "shield", tone: "warning" },
  rejected: { icon: "x", tone: "danger" },
  system: { icon: "info", tone: "info" },
};

const ageMs = (iso: string | null, now: number) => (iso ? now - new Date(iso).getTime() : Infinity);

export function Approvals() {
  const { pendingTrades, notifications, openApproval, settings } = useSession();
  const [windowSel, setWindowSel] = useState<Window>("24h");
  const [simulating, setSimulating] = useState(false);
  // Minute resolution is enough for the time-window filters; countdowns tick in their own rows.
  const now = useNow(60_000);

  const { pending, decided, approvedToday, riskPassRate } = useMemo(() => {
    const live = pendingTrades.filter((p) => p.status === "pending");
    const done = pendingTrades
      .filter((p) => p.status !== "pending" && ageMs(p.decidedAt, now) <= WINDOW_MS[windowSel])
      .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
    const passed = pendingTrades.filter((p) => p.riskCheck.passed).length;
    return {
      pending: live,
      decided: done,
      approvedToday: pendingTrades.filter((p) => p.status === "approved" && ageMs(p.decidedAt, now) < DAY_MS).length,
      riskPassRate: pendingTrades.length ? `${Math.round((passed / pendingTrades.length) * 100)}%` : "—",
    };
  }, [pendingTrades, windowSel, now]);
  const unread = notifications.filter((n) => !n.read).length;

  async function simulate() {
    setSimulating(true);
    try {
      // The session refreshes on the service's change event; the modal opens once the proposal arrives.
      openApproval((await simulateSignal()).id);
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Trade Approval & Notifications</h2>
          <p className="muted">Review simulated strategy proposals and monitor decision activity.</p>
        </div>
        <div className="page-head-aside">
          {DEMO_MODE && (
            <button type="button" className="btn btn-secondary" disabled={simulating} onClick={simulate} title="Demo only: emulate the trading engine raising a proposal">
              <Icon name="sparkles" size={16} /> {simulating ? "Generating…" : "Simulate strategy signal"}
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={pending.length === 0} onClick={() => openApproval()}>
            <Icon name="eye" size={16} /> Review pending trade
          </button>
        </div>
      </div>

      <div className="stat-grid three">
        <SummaryTile icon="clock" tone="warning" label="Awaiting decision" sub="Manual approval required" value={pending.length} />
        <SummaryTile icon="check" tone="success" label="Approved today" sub="Simulated orders recorded" value={approvedToday} />
        <SummaryTile icon="shield" tone="info" label="Risk checks passed" sub="Proposals within configured limits" value={riskPassRate} />
      </div>

      {pending.length > 0 && (
        <Card title="Pending proposals" subtitle="Decide before the deadline or they expire without executing" flush>
          <ul className="pending-list">
            {pending.map((p) => (
              <PendingRow key={p.id} trade={p} onReview={() => openApproval(p.id)} />
            ))}
          </ul>
        </Card>
      )}

      <div className="grid-main even">
        <Card
          title="Recent order decisions"
          subtitle="All activity shown is simulated"
          actions={
            <Segmented
              label="Time window"
              value={windowSel}
              onChange={setWindowSel}
              options={[
                { value: "24h", label: "24 hours" },
                { value: "7d", label: "7 days" },
                { value: "all", label: "All" },
              ]}
            />
          }
          flush
        >
          {decided.length === 0 ? (
            <p className="empty">No decisions in this period.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol / side</th>
                    <th className="num">Quantity</th>
                    <th>Decision</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="sym-cell">
                          <SymbolMark symbol={d.symbol} />
                          <div>
                            <strong>{d.symbol}</strong>
                            <span className="muted small">
                              {d.action} · {d.strategyName}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="num">{d.quantity} shares</td>
                      <td>
                        <StatusBadge status={d.status} tones={DECISION_TONES} />
                      </td>
                      <td>{d.decidedAt && dateTime(d.decidedAt, settings.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Notifications"
          subtitle={`${unread} unread`}
          actions={
            <button type="button" className="link-btn" disabled={unread === 0} onClick={() => void markNotificationsRead()}>
              Mark all as read
            </button>
          }
          flush
        >
          {notifications.length === 0 ? (
            <p className="empty">You're all caught up.</p>
          ) : (
            <ul className="notif-list">
              {notifications.map((n) => (
                <li key={n.id} className={n.read ? "" : "unread"}>
                  <IconTile name={NOTIF_ICON[n.kind].icon} tone={NOTIF_ICON[n.kind].tone} />
                  <div>
                    <strong>{n.title}</strong>
                    <span className="muted small">{n.body}</span>
                    <span className="muted small">{relativeTime(n.time, now)}</span>
                  </div>
                  {!n.read && <button type="button" className="unread-dot" aria-label="Mark as read" onClick={() => void markNotificationsRead([n.id])} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function SummaryTile({ icon, tone, label, sub, value }: { icon: IconName; tone: Tone; label: string; sub: string; value: number | string }) {
  return (
    <div className="card summary-tile">
      <IconTile name={icon} tone={tone} />
      <div>
        <span className="eyebrow">{label}</span>
        <span className="muted small">{sub}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

/** Ticks every second on its own, so the page around it doesn't re-render. */
function PendingRow({ trade, onReview }: { trade: PendingTrade; onReview: () => void }) {
  const secs = secondsLeft(trade.expiresAt, useNow(1000));
  return (
    <li>
      <SymbolMark symbol={trade.symbol} />
      <div>
        <strong>
          {trade.action} {trade.quantity} {trade.symbol}
        </strong>
        <span className="muted small">
          {trade.strategyName} · est. {money(trade.estimatedPrice)}
        </span>
      </div>
      <RiskCheckBadge passed={trade.riskCheck.passed} />
      <span className={`countdown-inline ${secs <= 15 ? "urgent" : ""}`}>
        <Icon name="clock" size={14} /> {countdown(secs)}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={onReview}>
        Review
      </button>
    </li>
  );
}

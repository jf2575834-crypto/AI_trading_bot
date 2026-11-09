import { useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Badge, Card, IconTile, Segmented, SymbolMark, type Tone } from "../components/ui";
import { DEMO_MODE, markNotificationsRead, simulateSignal } from "../data/service";
import type { NotificationKind, PendingTrade, PendingTradeStatus } from "../data/types";
import { dateTime, money, relativeTime } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useSession } from "../lib/session";

type Window = "24h" | "7d" | "all";
const WINDOW_MS: Record<Window, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, all: Infinity };

const DECISION_TONE: Record<PendingTradeStatus, Tone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  expired: "neutral",
  failed: "danger",
};

const NOTIF_ICON: Record<NotificationKind, { icon: IconName; tone: Tone }> = {
  approved: { icon: "check", tone: "success" },
  signal: { icon: "sparkles", tone: "info" },
  risk: { icon: "shield", tone: "warning" },
  rejected: { icon: "x", tone: "danger" },
  system: { icon: "info", tone: "info" },
};

export function Approvals() {
  const { pendingTrades, notifications, refreshAlerts, openApproval, settings } = useSession();
  const [windowSel, setWindowSel] = useState<Window>("24h");
  const [simulating, setSimulating] = useState(false);
  const now = useNow(1000);

  const pending = pendingTrades.filter((p) => p.status === "pending" && new Date(p.expiresAt).getTime() > now);
  const decided = pendingTrades
    .filter((p) => p.status !== "pending" && p.decidedAt && now - new Date(p.decidedAt).getTime() <= WINDOW_MS[windowSel])
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  const approvedToday = pendingTrades.filter((p) => p.status === "approved" && p.decidedAt && now - new Date(p.decidedAt).getTime() < 86_400_000).length;
  const checked = pendingTrades.length;
  const passed = pendingTrades.filter((p) => p.riskCheck.passed).length;
  const unread = notifications.filter((n) => !n.read).length;

  async function simulate() {
    setSimulating(true);
    try {
      const p = await simulateSignal();
      refreshAlerts();
      setTimeout(() => openApproval(p.id), 250);
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
        <SummaryTile icon="shield" tone="info" label="Risk checks passed" sub="Proposals within configured limits" value={checked ? `${Math.round((passed / checked) * 100)}%` : "—"} />
      </div>

      {pending.length > 0 && (
        <Card title="Pending proposals" subtitle="Decide before the deadline or they expire without executing" flush>
          <ul className="pending-list">
            {pending.map((p) => (
              <PendingRow key={p.id} trade={p} now={now} onReview={() => openApproval(p.id)} />
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
                  <tr><th>Symbol / side</th><th className="num">Quantity</th><th>Decision</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {decided.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="sym-cell">
                          <SymbolMark symbol={d.symbol} />
                          <div>
                            <strong>{d.symbol}</strong>
                            <span className="muted small">{d.action} · {d.strategyName}</span>
                          </div>
                        </div>
                      </td>
                      <td className="num">{d.quantity} shares</td>
                      <td><Badge tone={DECISION_TONE[d.status]}>{d.status[0].toUpperCase() + d.status.slice(1)}</Badge></td>
                      <td>{dateTime(d.decidedAt!, settings.timezone)}</td>
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
            <button type="button" className="link-btn" disabled={unread === 0} onClick={() => markNotificationsRead().then(refreshAlerts)}>
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
                  {!n.read && (
                    <button type="button" className="unread-dot" aria-label="Mark as read" onClick={() => markNotificationsRead([n.id]).then(refreshAlerts)} />
                  )}
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

function PendingRow({ trade, now, onReview }: { trade: PendingTrade; now: number; onReview: () => void }) {
  const secs = Math.max(0, Math.ceil((new Date(trade.expiresAt).getTime() - now) / 1000));
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
      <Badge tone={trade.riskCheck.passed ? "success" : "danger"}>{trade.riskCheck.passed ? "Risk check passed" : "Risk check failed"}</Badge>
      <span className={`countdown-inline ${secs <= 15 ? "urgent" : ""}`}>
        <Icon name="clock" size={14} /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={onReview}>
        Review
      </button>
    </li>
  );
}

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { decideTrade } from "../data/service";
import type { PendingTrade } from "../data/types";
import { money } from "../lib/format";
import { useNow } from "../lib/hooks";
import { Icon } from "./Icon";
import { Badge, Modal, Notice, SideBadge, SymbolMark } from "./ui";

type Props = {
  trade: PendingTrade | null;
  onClose: () => void;
  onDecided: () => void;
};

export function ApprovalModal({ trade, onClose, onDecided }: Props) {
  return (
    <Modal open={trade !== null} onClose={onClose} labelledBy="approval-title" width={680}>
      {trade && <ApprovalContent key={trade.id} trade={trade} onClose={onClose} onDecided={onDecided} />}
    </Modal>
  );
}

const STATUS_COPY = {
  approved: { tone: "success", text: "Approved. The order was recorded in the paper trading simulation." },
  rejected: { tone: "neutral", text: "Rejected. Nothing was executed." },
  expired: { tone: "warning", text: "Expired. The deadline passed and nothing was executed." },
  failed: { tone: "danger", text: "Approval failed. The order could not be placed; see notifications for the reason." },
} as const;

function ApprovalContent({ trade, onClose, onDecided }: { trade: PendingTrade; onClose: () => void; onDecided: () => void }) {
  const now = useNow(250);
  const navigate = useNavigate();
  const [current, setCurrent] = useState(trade);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Countdown is driven by the server deadline; the server rejects late decisions regardless.
  const msLeft = new Date(current.expiresAt).getTime() - now;
  const expiredLocally = current.status === "pending" && msLeft <= 0;
  const status = expiredLocally ? "expired" : current.status;
  const decided = status !== "pending";
  const secs = Math.max(0, Math.ceil(msLeft / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  const deciding = useRef(false);

  async function decide(decision: "approve" | "reject") {
    if (deciding.current || decided) return;
    deciding.current = true;
    setBusy(decision);
    setError(null);
    try {
      setCurrent(await decideTrade(current.id, decision));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      deciding.current = false;
      setBusy(null);
      onDecided();
    }
  }

  function editAsOrder() {
    const params = new URLSearchParams({ symbol: current.symbol, side: current.action, qty: String(current.quantity) });
    onClose();
    navigate(`/paper-trading?${params}`);
  }

  return (
    <div className="approval">
      <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close">
        <Icon name="x" />
      </button>
      <Badge tone="warning" dot>
        Paper trade
      </Badge>
      <h2 id="approval-title" className="modal-title">
        Trade Approval Required
      </h2>
      <p className="muted">Review this simulated strategy proposal before it expires.</p>

      {decided ? (
        <Notice tone={STATUS_COPY[status].tone} title={status[0].toUpperCase() + status.slice(1)}>
          {STATUS_COPY[status].text}
        </Notice>
      ) : (
        <div className={`countdown ${secs <= 15 ? "urgent" : ""}`} aria-live="polite">
          <Icon name="clock" size={22} />
          <div>
            <span className="eyebrow">Decision countdown</span>
            <strong className="countdown-time" aria-label={`${secs} seconds left`}>
              {mm}:{ss}
            </strong>
          </div>
          <div className="countdown-default">
            <span className="muted small">Default outcome</span>
            <strong>Expire without executing</strong>
          </div>
        </div>
      )}

      <div className="proposal">
        <div className="proposal-head">
          <SymbolMark symbol={current.symbol} size={36} />
          <SideBadge side={current.action} />
          <div>
            <strong className="proposal-symbol">{current.symbol}</strong>
            <span className="muted small">{current.name} · Simulated market order</span>
          </div>
        </div>
        <dl className="kv-grid">
          <div><dt>Quantity</dt><dd>{current.quantity} shares</dd></div>
          <div><dt>Estimated price</dt><dd>{money(current.estimatedPrice)}</dd></div>
          <div><dt>Estimated total</dt><dd>{money(current.estimatedPrice * current.quantity)}</dd></div>
          <div><dt>Strategy</dt><dd>{current.strategyName}</dd></div>
        </dl>
      </div>

      <div className="rationale">
        <span className="rationale-head">
          <Icon name="sparkles" size={16} /> Why this signal was generated
        </span>
        <p>{current.rationale}</p>
      </div>

      <div className={`risk-result ${current.riskCheck.passed ? "pass" : "fail"}`}>
        <Icon name={current.riskCheck.passed ? "shieldCheck" : "alert"} size={22} />
        <div>
          <Badge tone={current.riskCheck.passed ? "success" : "danger"}>
            {current.riskCheck.passed ? "Risk check passed" : "Risk check failed"}
          </Badge>
          <strong>{current.riskCheck.summary}</strong>
          <span className="muted small">{current.riskCheck.details}</span>
        </div>
      </div>

      <Notice tone="info">No real trade will be placed. Approval records this order in the paper trading simulation only.</Notice>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="approval-actions">
        {decided ? (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-danger-soft" disabled={busy !== null} onClick={() => decide("reject")}>
              <Icon name="x" size={16} /> {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={editAsOrder}>
              <Icon name="settings" size={16} /> Edit as manual order
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={busy !== null || !current.riskCheck.passed}
              title={current.riskCheck.passed ? undefined : "Blocked by risk check"}
              onClick={() => decide("approve")}
            >
              <Icon name="check" size={16} /> {busy === "approve" ? "Approving…" : "Approve"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

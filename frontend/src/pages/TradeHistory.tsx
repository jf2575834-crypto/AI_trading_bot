import { useState } from "react";
import { Field } from "../components/Field";
import { Badge, Card, DataState, SideBadge, SymbolMark } from "../components/ui";
import { getActivity, getTradeHistory } from "../data/service";
import type { ExecutedTrade } from "../data/types";
import { dateTime, humanize, money } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";

const SOURCE_LABEL: Record<ExecutedTrade["source"], string> = {
  manual: "Manual",
  approved: "Approved proposal",
  automatic: "Automatic",
};

export function TradeHistory() {
  const { settings, assets } = useSession();
  const trades = useAsync(getTradeHistory, []);
  const activity = useAsync(() => getActivity(50), []);
  const [symbol, setSymbol] = useState("all");
  const [side, setSide] = useState("all");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Trade History</h2>
          <p className="muted">Executed paper trades and a log of engine activity. All records are simulated.</p>
        </div>
      </div>

      <Card
        title="Executed trades"
        flush
        actions={
          <div className="filters">
            <Field label="Symbol">
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="all">All symbols</option>
                {assets.map((a) => (
                  <option key={a.symbol} value={a.symbol}>
                    {a.symbol}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Side">
              <select value={side} onChange={(e) => setSide(e.target.value)}>
                <option value="all">Buy and sell</option>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </select>
            </Field>
          </div>
        }
      >
        <DataState state={trades} rows={6}>
          {(all) => {
            const rows = all.filter((t) => (symbol === "all" || t.symbol === symbol) && (side === "all" || t.side === side));
            return rows.length === 0 ? (
              <p className="empty">No trades match these filters.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Time</th><th>Symbol</th><th>Side</th><th className="num">Quantity</th><th className="num">Price</th><th className="num">Value</th><th>Source</th><th>Strategy</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id}>
                        <td>{dateTime(t.time, settings.timezone)}</td>
                        <td><div className="sym-cell"><SymbolMark symbol={t.symbol} /><strong>{t.symbol}</strong></div></td>
                        <td><SideBadge side={t.side} /></td>
                        <td className="num">{t.quantity}</td>
                        <td className="num">{money(t.price)}</td>
                        <td className="num">{money(t.price * t.quantity)}</td>
                        <td><Badge tone={t.source === "manual" ? "neutral" : "info"}>{SOURCE_LABEL[t.source]}</Badge></td>
                        <td>{t.strategyName ?? <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </DataState>
      </Card>

      <Card title="Activity log" subtitle="Decisions, orders, executions, and system events" flush>
        <DataState state={activity} rows={6} isEmpty={(a) => a.length === 0} empty="No activity yet.">
          {(items) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Time</th><th>Type</th><th>Event</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td>{dateTime(a.time, settings.timezone)}</td>
                      <td><Badge tone="neutral">{humanize(a.kind)}</Badge></td>
                      <td><strong>{a.title}</strong></td>
                      <td className="muted">{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
      </Card>
    </div>
  );
}

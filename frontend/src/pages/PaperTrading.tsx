import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CandleChart } from "../components/charts";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Badge, Card, DataState, ErrorState, Notice, Segmented, SideBadge, SymbolMark, Tabs } from "../components/ui";
import {
  type CandleRange,
  cancelOrder,
  getCandles,
  getOrders,
  getPortfolio,
  getPositions,
  getQuote,
  getWatchlist,
  listAssets,
  submitOrder,
} from "../data/service";
import type { Order, OrderStatus, OrderType, Quote, Side } from "../data/types";
import { compact, dateTime, money, signedMoney, signedPct, timeOnly, tone } from "../lib/format";
import { type AsyncState, useAsync, useVisibleInterval } from "../lib/hooks";
import { useSession } from "../lib/session";

const RANGES: CandleRange[] = ["1M", "3M", "6M", "1Y"];

export function PaperTrading() {
  const [params] = useSearchParams();
  const initialSymbol = (params.get("symbol") ?? "AAPL").toUpperCase();
  const [selected, setSelected] = useState(initialSymbol);
  const [range, setRange] = useState<CandleRange>("1M");
  const watchlist = useAsync(getWatchlist, []);
  const candles = useAsync(() => getCandles(selected, range), [selected, range]);
  const orders = useAsync(getOrders, []);
  useVisibleInterval(() => void watchlist.reload(), 15000);

  const quote = watchlist.data?.find((q) => q.symbol === selected);

  return (
    <div className="page">
      <Notice tone="success" title="Simulation mode — no real money">
        Quotes, balances, and executions are fictional. No brokerage is connected.
      </Notice>

      <div className="trade-grid">
        <Watchlist
          state={watchlist}
          selected={selected}
          onSelect={(s) => setSelected(s)}
        />

        <Card className="chart-card">
          <div className="quote-head">
            <SymbolMark symbol={selected} size={36} />
            <div>
              <strong className="quote-symbol">{selected}</strong>
              <span className="muted small">
                {quote ? `${quote.name} · ${quote.exchange}` : ""}
              </span>
            </div>
            <div className="quote-price">
              {quote && (
                <>
                  <strong>{money(quote.price)}</strong>
                  <span className={tone(quote.changePct)}>{signedPct(quote.changePct, 2)} today</span>
                </>
              )}
            </div>
          </div>
          <div className="chart-toolbar">
            <Segmented label="Chart range" value={range} onChange={setRange} options={RANGES} />
          </div>
          <DataState state={candles} rows={8}>
            {(c) => (
              <>
                <CandleChart candles={c} label={`${selected} daily candles, ${range}`} />
                <dl className="ohlc">
                  <div><dt>Last close</dt><dd>{money(c[c.length - 1].c)}</dd></div>
                  <div><dt>{range} high</dt><dd>{money(Math.max(...c.map((x) => x.h)))}</dd></div>
                  <div><dt>{range} low</dt><dd>{money(Math.min(...c.map((x) => x.l)))}</dd></div>
                  <div><dt>Last volume</dt><dd>{compact(c[c.length - 1].v)}</dd></div>
                </dl>
              </>
            )}
          </DataState>
        </Card>

        <OrderTicket
          key={initialSymbol + (params.get("qty") ?? "")}
          symbol={selected}
          onSymbol={(s) => setSelected(s)}
          initialSide={(params.get("side") as Side) ?? "BUY"}
          initialQty={params.get("qty") ?? ""}
          onSubmitted={() => void orders.reload()}
        />
      </div>

      <OrdersPanel state={orders} />
    </div>
  );
}

function Watchlist({
  state,
  selected,
  onSelect,
}: {
  state: AsyncState<Quote[]>;
  selected: string;
  onSelect: (s: string) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <Card title="Watchlist" subtitle={state.data ? `${state.data.length} tracked symbols` : undefined} actions={<Badge tone="success" dot>Demo feed</Badge>}>
      <label className="search">
        <Icon name="search" size={16} />
        <input placeholder="Search symbol" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search watchlist" />
      </label>
      <DataState state={state} rows={5}>
        {(quotes) => {
          const shown = quotes.filter((q) => `${q.symbol} ${q.name}`.toLowerCase().includes(query.toLowerCase()));
          return shown.length === 0 ? (
            <p className="empty">No symbols match “{query}”.</p>
          ) : (
            <ul className="watchlist">
              {shown.map((q) => (
                <li key={q.symbol}>
                  <button type="button" className={q.symbol === selected ? "active" : ""} aria-pressed={q.symbol === selected} onClick={() => onSelect(q.symbol)}>
                    <SymbolMark symbol={q.symbol} />
                    <span className="wl-name">
                      <strong>{q.symbol}</strong>
                      <span className="muted small">{q.name}</span>
                    </span>
                    <span className="wl-price">
                      <strong>{money(q.price)}</strong>
                      <span className={`small ${tone(q.changePct)}`}>{signedPct(q.changePct, 2)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          );
        }}
      </DataState>
      <p className="muted small with-icon">
        <Icon name="clock" size={14} /> Simulated quotes refresh every 15 seconds
      </p>
    </Card>
  );
}

type TicketState = "editing" | "review" | "submitting" | "done";

function OrderTicket({
  symbol,
  onSymbol,
  initialSide,
  initialQty,
  onSubmitted,
}: {
  symbol: string;
  onSymbol: (s: string) => void;
  initialSide: Side;
  initialQty: string;
  onSubmitted: () => void;
}) {
  const { settings } = useSession();
  const [side, setSide] = useState<Side>(initialSide === "SELL" ? "SELL" : "BUY");
  const [symbolText, setSymbolText] = useState(symbol);
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [qty, setQty] = useState(initialQty);
  const [limit, setLimit] = useState("");
  const [touched, setTouched] = useState(false);
  const [stage, setStage] = useState<TicketState>("editing");
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<Order | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => setSymbolText(symbol), [symbol]);

  const sym = symbolText.trim().toUpperCase();
  const known = listAssets().some((a) => a.symbol === sym);
  const quote = useAsync(() => (known ? getQuote(sym) : Promise.resolve(null)), [sym, known]);
  const cash = useAsync(() => getPortfolio().then((p) => p.availableCash), [result?.id]);
  const held = useAsync(() => getPositions().then((ps) => ps.find((p) => p.symbol === sym)?.quantity ?? 0), [sym, result?.id]);

  const price = orderType === "limit" && Number(limit) > 0 ? Number(limit) : quote.data?.price ?? 0;
  const estCost = price * Number(qty || 0);

  const errors = useMemo(() => {
    const e: { symbol?: string; qty?: string; limit?: string } = {};
    if (!/^[A-Z]{1,5}$/.test(sym)) e.symbol = "Enter a ticker of 1 to 5 letters";
    else if (!known) e.symbol = `${sym} is not available in the demo market`;
    const q = Number(qty);
    if (!(q > 0) || !Number.isInteger(q)) e.qty = "Enter a whole number greater than 0";
    else if (side === "SELL" && held.data !== undefined && q > held.data) e.qty = `You hold ${held.data} ${sym}`;
    if (orderType === "limit" && !(Number(limit) > 0)) e.limit = "Enter a limit price greater than 0";
    return e;
  }, [sym, known, qty, side, held.data, orderType, limit]);
  const valid = Object.keys(errors).length === 0;

  function edit() {
    setStage("editing");
    setResult(null);
    setSubmitError(null);
  }

  function review(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    if (known) onSymbol(sym);
    setKey(crypto.randomUUID());
    setStage("review");
  }

  async function submit() {
    // A ref, not state: clicks that land before React re-renders must still be blocked.
    if (stage !== "review" || submitting.current) return;
    submitting.current = true;
    setStage("submitting");
    setSubmitError(null);
    try {
      const order = await submitOrder({
        symbol: sym,
        side,
        quantity: Number(qty),
        orderType,
        limitPrice: orderType === "limit" ? Number(limit) : null,
        idempotencyKey,
      });
      setResult(order);
      setStage("done");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Order failed");
      setStage("done");
    } finally {
      submitting.current = false;
      onSubmitted();
    }
  }

  const locked = stage !== "editing";

  return (
    <Card title="Order ticket" subtitle="Paper execution only" actions={<Icon name="lock" />} className="ticket">
      <form onSubmit={review} noValidate className="stack-sm">
        <Segmented
          label="Order side"
          className={`side-switch ${side.toLowerCase()}`}
          value={side}
          onChange={(v) => !locked && setSide(v)}
          options={[
            { value: "BUY", label: "Buy" },
            { value: "SELL", label: "Sell" },
          ]}
        />
        <Field label="Symbol" error={touched ? errors.symbol : undefined}>
          <input value={symbolText} disabled={locked} onChange={(e) => setSymbolText(e.target.value.toUpperCase())} list="symbols" autoComplete="off" />
        </Field>
        <datalist id="symbols">
          {listAssets().map((a) => (
            <option key={a.symbol} value={a.symbol}>
              {a.name}
            </option>
          ))}
        </datalist>
        <Field label="Order type">
          <select value={orderType} disabled={locked} onChange={(e) => setOrderType(e.target.value as OrderType)}>
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </Field>
        <Field label="Quantity (shares)" error={touched ? errors.qty : undefined} hint={side === "SELL" && held.data !== undefined ? `You hold ${held.data}` : undefined}>
          <input inputMode="numeric" value={qty} disabled={locked} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {orderType === "limit" && (
          <Field label="Limit price ($)" error={touched ? errors.limit : undefined}>
            <input inputMode="decimal" value={limit} disabled={locked} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        )}

        <dl className="ticket-summary">
          <div>
            <dt>Estimated price</dt>
            <dd>
              {quote.data ? money(quote.data.price) : "—"}
              {quote.data && <span className="muted small"> as of {timeOnly(quote.data.asOf, settings.timezone)}</span>}
            </dd>
          </div>
          <div>
            <dt>Estimated {side === "BUY" ? "cost" : "proceeds"}</dt>
            <dd>{estCost > 0 ? money(estCost) : "—"}</dd>
          </div>
          <div>
            <dt>Available simulated cash</dt>
            <dd>{cash.data !== undefined ? money(cash.data) : "—"}</dd>
          </div>
        </dl>

        {stage === "editing" && (
          <button type="submit" className="btn btn-primary btn-lg">
            Review order
          </button>
        )}

        {(stage === "review" || stage === "submitting") && (
          <div className="review-box" aria-live="polite">
            <span className="eyebrow">Confirm order</span>
            <p>
              <SideBadge side={side} /> <strong>{qty} {sym}</strong> · {orderType === "market" ? "Market" : `Limit ${money(Number(limit))}`} · est.{" "}
              {money(estCost)}
            </p>
            <span className="muted small">Order status: not submitted</span>
            <Notice tone="warning">This action is simulated and will never be sent to a brokerage. Risk limits are checked on submission.</Notice>
            <div className="button-row">
              <button type="button" className="btn btn-secondary" disabled={stage === "submitting"} onClick={edit}>
                Edit
              </button>
              <button type="button" className="btn btn-primary" disabled={stage === "submitting"} onClick={submit}>
                {stage === "submitting" ? "Submitting…" : "Submit paper order"}
              </button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="review-box" aria-live="polite">
            {result ? (
              <>
                <span className="eyebrow">Order status</span>
                <p>
                  <OrderStatusBadge status={result.status} /> {result.side} {result.quantity} {result.symbol}
                  {result.status === "filled" && ` at ${money(result.price)}`}
                </p>
              </>
            ) : (
              <ErrorState message={submitError ?? "Order failed"} />
            )}
            <button type="button" className="btn btn-secondary" onClick={edit}>
              New order
            </button>
          </div>
        )}
      </form>
    </Card>
  );
}

const STATUS_TONE: Record<OrderStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  pending: "warning",
  accepted: "info",
  partially_filled: "info",
  filled: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const label = status.replace("_", " ");
  return <Badge tone={STATUS_TONE[status]}>{label[0].toUpperCase() + label.slice(1)}</Badge>;
}

type OrdersTab = "open" | "history" | "positions";

function OrdersPanel({ state }: { state: AsyncState<Order[]> }) {
  const { settings } = useSession();
  const [tab, setTab] = useState<OrdersTab>("open");
  const positions = useAsync(getPositions, [state.data?.length]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = state.data?.filter((o) => o.status === "pending" || o.status === "accepted") ?? [];
  const history = state.data?.filter((o) => !open.includes(o)) ?? [];

  async function cancel(id: string) {
    setCancelling(id);
    setError(null);
    try {
      await cancelOrder(id);
      await state.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <Card flush>
      <Tabs
        label="Orders"
        value={tab}
        onChange={setTab}
        items={[
          { value: "open", label: "Open orders", count: open.length },
          { value: "history", label: "Order history", count: history.length },
          { value: "positions", label: "Positions", count: positions.data?.length },
        ]}
      />
      {error && <ErrorState message={error} compact />}
      {tab === "positions" ? (
        <DataState state={positions} isEmpty={(p) => p.length === 0} empty="No open positions.">
          {(rows) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Symbol</th><th className="num">Quantity</th><th className="num">Average cost</th><th className="num">Market value</th><th className="num">P/L</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pl = (r.currentPrice - r.averageCost) * r.quantity;
                    return (
                      <tr key={r.symbol}>
                        <td><div className="sym-cell"><SymbolMark symbol={r.symbol} /><strong>{r.symbol}</strong></div></td>
                        <td className="num">{r.quantity}</td>
                        <td className="num">{money(r.averageCost)}</td>
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
      ) : (
        <DataState state={state} isEmpty={() => (tab === "open" ? open : history).length === 0} empty={tab === "open" ? "No open orders." : "No past orders yet."}>
          {() => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Symbol</th><th>Side</th><th className="num">Quantity</th><th>Type</th><th className="num">Price</th><th>Status</th><th>Time</th>{tab === "open" && <th><span className="sr-only">Actions</span></th>}</tr>
                </thead>
                <tbody>
                  {(tab === "open" ? open : history).map((o) => (
                    <tr key={o.id}>
                      <td><div className="sym-cell"><SymbolMark symbol={o.symbol} /><strong>{o.symbol}</strong></div></td>
                      <td><SideBadge side={o.side} /></td>
                      <td className="num">{o.quantity}</td>
                      <td>{o.orderType === "market" ? "Market" : "Limit"}</td>
                      <td className="num">{money(o.price)}</td>
                      <td><OrderStatusBadge status={o.status} /></td>
                      <td>{dateTime(o.createdAt, settings.timezone)}</td>
                      {tab === "open" && (
                        <td className="num">
                          <button type="button" className="btn btn-ghost btn-sm" disabled={cancelling === o.id} onClick={() => cancel(o.id)}>
                            {cancelling === o.id ? "Cancelling…" : "Cancel"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
      )}
    </Card>
  );
}

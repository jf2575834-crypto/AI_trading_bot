import type { Position } from "../data/types";
import { money, signedMoney, tone } from "../lib/format";
import { SymbolMark } from "./ui";

export function unrealizedPnl(p: Position): number {
  return (p.currentPrice - p.averageCost) * p.quantity;
}

/** Open positions; `detailed` adds the company name and current price columns. */
export function PositionsTable({ rows, detailed = false }: { rows: Position[]; detailed?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="num">Quantity</th>
            <th className="num">Average cost</th>
            {detailed && <th className="num">Current price</th>}
            <th className="num">Market value</th>
            <th className="num">Unrealized P/L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pl = unrealizedPnl(r);
            return (
              <tr key={r.symbol}>
                <td>
                  <div className="sym-cell">
                    <SymbolMark symbol={r.symbol} />
                    {detailed ? (
                      <div>
                        <strong>{r.symbol}</strong>
                        <span className="muted small">{r.name}</span>
                      </div>
                    ) : (
                      <strong>{r.symbol}</strong>
                    )}
                  </div>
                </td>
                <td className="num">{r.quantity}</td>
                <td className="num">{money(r.averageCost)}</td>
                {detailed && <td className="num">{money(r.currentPrice)}</td>}
                <td className="num">{money(r.currentPrice * r.quantity)}</td>
                <td className={`num ${tone(pl)}`}>{signedMoney(pl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

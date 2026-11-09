import { type ReactNode, useId, useState } from "react";
import type { Candle, Point } from "../data/types";
import { compact, money, shortDate } from "../lib/format";
import { useWidth } from "../lib/hooks";

// Series colors validated for the dark surface (dataviz validate_palette: all checks pass).
export const SERIES = { primary: "#3b8ff0", benchmark: "#c4823a" };
const UP = "#22c55e";
const DOWN = "#ef4444";

type Series = { name: string; points: Point[]; color: string; dashed?: boolean; area?: boolean };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((s) => (
        <span key={s.name} className="legend-item">
          <svg width="18" height="8" aria-hidden>
            <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinecap="round" />
          </svg>
          {s.name}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), width - 180);
  return (
    <div className="chart-tip" style={{ left: x > width - 200 ? x - 192 : left, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

type LineChartProps = {
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  label: string;
};

export function LineChart({ series, height = 260, format = (v) => money(v, true), label }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();
  const n = series[0]?.points.length ?? 0;
  const pad = { l: 60, r: 12, t: 12, b: 26 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const margin = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1;
  const ticks = niceTicks(lo - margin, hi + margin);
  const yMin = Math.min(lo - margin, ticks[0]);
  const yMax = Math.max(hi + margin, ticks[ticks.length - 1]);
  const x = (i: number) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.t + h - ((v - yMin) / (yMax - yMin)) * h;
  // Roughly one date label per 80px so labels never collide on narrow screens.
  const labelCount = Math.max(2, Math.min(6, n, Math.floor(w / 80)));
  const xLabels = n > 1 ? Array.from({ length: labelCount }, (_, k) => Math.round((k / (labelCount - 1)) * (n - 1))) : [0];

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  }

  return (
    <figure className="chart" aria-label={label}>
      {series.length > 1 && <Legend items={series} />}
      <div ref={ref} className="chart-area" style={{ height }}>
        {width > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label={label}>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={series[0].color} stopOpacity="0.28" />
                <stop offset="1" stopColor={series[0].color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">
                  {format(t)}
                </text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="axis">
                {shortDate(series[0].points[i].t)}
              </text>
            ))}
            {series.map((s, si) => {
              const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
              return (
                <g key={s.name}>
                  {si === 0 && (s.area ?? true) && (
                    <path d={`${d}L${x(n - 1)},${pad.t + h}L${x(0)},${pad.t + h}Z`} fill={`url(#${gradientId})`} />
                  )}
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} className="crosshair" />
                {series.map((s) => (
                  <circle key={s.name} cx={x(hover)} cy={y(s.points[hover].value)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
            <rect
              x={pad.l}
              y={pad.t}
              width={w}
              height={h}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tooltip x={x(hover)} y={y(series[0].points[hover].value)} width={width}>
            <div className="tip-title">{shortDate(series[0].points[hover].t)}</div>
            {series.map((s) => (
              <div key={s.name} className="tip-row">
                <span className="swatch" style={{ background: s.color }} />
                <span>{s.name}</span>
                <strong>{format(s.points[hover].value)}</strong>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </figure>
  );
}

export function Sparkline({ values, tone }: { values: number[]; tone: "up" | "down" | "flat" }) {
  if (values.length < 2) return null;
  const w = 72;
  const h = 26;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`);
  const color = tone === "down" ? DOWN : tone === "up" ? UP : SERIES.primary;
  return (
    <svg width={w} height={h} aria-hidden className="sparkline">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function CandleChart({ candles, height = 320, label }: { candles: Candle[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = candles.length;
  const pad = { l: 8, r: 56, t: 10, b: 24 };
  const volH = 50;
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b - volH - 8;
  const lo = Math.min(...candles.map((c) => c.l));
  const hi = Math.max(...candles.map((c) => c.h));
  const ticks = niceTicks(lo, hi, 6);
  const maxV = Math.max(...candles.map((c) => c.v));
  const slot = n ? w / n : 0;
  const body = Math.max(1, Math.min(10, slot * 0.6));
  const x = (i: number) => pad.l + slot * (i + 0.5);
  const y = (v: number) => pad.t + h - ((v - lo) / (hi - lo || 1)) * h;
  const volTop = pad.t + h + 8;
  const hc = hover !== null ? candles[hover] : null;

  return (
    <figure className="chart" aria-label={label}>
      <div ref={ref} className="chart-area" style={{ height }}>
        {width > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label={label}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l + w + 8} y={y(t) + 4} className="axis">
                  {t.toFixed(0)}
                </text>
              </g>
            ))}
            {candles.map((c, i) => {
              const up = c.c >= c.o;
              const color = up ? UP : DOWN;
              const top = y(Math.max(c.o, c.c));
              const bh = Math.max(1, Math.abs(y(c.o) - y(c.c)));
              const vh = (c.v / maxV) * volH;
              return (
                <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.55}>
                  <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
                  <rect
                    x={x(i) - body / 2}
                    y={top}
                    width={body}
                    height={bh}
                    rx={1}
                    fill={up ? "var(--surface)" : color}
                    stroke={color}
                    strokeWidth={1.2}
                  />
                  <rect x={x(i) - body / 2} y={volTop + volH - vh} width={body} height={vh} fill={color} opacity={0.35} />
                </g>
              );
            })}
            {[0, Math.floor(n / 2), n - 1].map((i) => (
              <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="axis">
                {shortDate(candles[i].t)}
              </text>
            ))}
            <rect
              x={pad.l}
              y={pad.t}
              width={w}
              height={height - pad.t - pad.b}
              fill="transparent"
              onPointerMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                setHover(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - box.left) / box.width) * n))));
              }}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}
        {hc && hover !== null && (
          <Tooltip x={x(hover)} y={y(hc.h)} width={width}>
            <div className="tip-title">{shortDate(hc.t)}</div>
            <div className="tip-grid">
              <span>Open</span><strong>{money(hc.o)}</strong>
              <span>High</span><strong>{money(hc.h)}</strong>
              <span>Low</span><strong>{money(hc.l)}</strong>
              <span>Close</span><strong>{money(hc.c)}</strong>
              <span>Volume</span><strong>{compact(hc.v)}</strong>
            </div>
          </Tooltip>
        )}
      </div>
      <p className="chart-note">Hollow candles closed up, filled candles closed down.</p>
    </figure>
  );
}

type BarGroup = { label: string; a: number; b: number };

/** Grouped bars around a zero baseline (values may be negative). */
export function GroupedBars({
  data,
  names,
  height = 240,
  format = (v: number) => `${v.toFixed(1)}%`,
  label,
}: {
  data: BarGroup[];
  names: [string, string];
  height?: number;
  format?: (v: number) => string;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; k: "a" | "b" } | null>(null);
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const vals = data.flatMap((d) => [d.a, d.b, 0]);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 4);
  const lo = Math.min(ticks[0], ...vals);
  const hi = Math.max(ticks[ticks.length - 1], ...vals);
  const y = (v: number) => pad.t + h - ((v - lo) / (hi - lo || 1)) * h;
  const group = data.length ? w / data.length : 0;
  const bw = Math.min(22, (group - 14) / 2 - 1);

  // Bar with a rounded data-end and a square end on the baseline.
  function bar(x0: number, v: number) {
    const y0 = y(0);
    const y1 = y(v);
    const r = Math.min(4, Math.abs(y1 - y0), bw / 2);
    if (Math.abs(y1 - y0) < 0.5) return `M${x0},${y0}h${bw}`;
    if (v >= 0) {
      return `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 + r}V${y0}Z`;
    }
    return `M${x0},${y0}V${y1 - r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 - r}V${y0}Z`;
  }

  const colors = { a: SERIES.primary, b: SERIES.benchmark };
  const hd = hover ? data[hover.i] : null;

  return (
    <figure className="chart" aria-label={label}>
      <Legend items={[{ name: names[0], color: colors.a }, { name: names[1], color: colors.b }]} />
      <div ref={ref} className="chart-area" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={label}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} className={t === 0 ? "baseline" : "grid"} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
                  {format(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const gx = pad.l + group * i + group / 2;
              return (
                <g key={d.label}>
                  {(["a", "b"] as const).map((k, j) => {
                    const x0 = gx - bw - 1 + j * (bw + 2);
                    const active = !hover || (hover.i === i && hover.k === k);
                    return (
                      <g key={k}>
                        <path d={bar(x0, d[k])} fill={colors[k]} opacity={active ? 1 : 0.45} />
                        <rect
                          x={x0 - 2}
                          y={pad.t}
                          width={bw + 4}
                          height={h}
                          fill="transparent"
                          onPointerEnter={() => setHover({ i, k })}
                          onPointerLeave={() => setHover(null)}
                        />
                      </g>
                    );
                  })}
                  <text x={gx} y={height - 6} textAnchor="middle" className="axis">
                    {d.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hd && hover && (
          <Tooltip x={pad.l + group * hover.i + group / 2} y={y(Math.max(hd[hover.k], 0))} width={width}>
            <div className="tip-title">{hd.label}</div>
            <div className="tip-row">
              <span className="swatch" style={{ background: colors[hover.k] }} />
              <span>{hover.k === "a" ? names[0] : names[1]}</span>
              <strong>{format(hd[hover.k])}</strong>
            </div>
          </Tooltip>
        )}
      </div>
    </figure>
  );
}

/** Circular progress ring for a single 0–100 value. */
export function Ring({ value, size = 64, color = SERIES.primary, children }: { value: number; size?: number; color?: string; children?: ReactNode }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={`${(Math.max(0, Math.min(100, value)) / 100) * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label">{children}</span>
    </span>
  );
}

import { type ReactNode, useEffect, useRef } from "react";
import { Icon, type IconName } from "./Icon";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function Badge({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="dot" aria-hidden />}
      {children}
    </span>
  );
}

type CardProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
  flush?: boolean;
};

export function Card({ title, subtitle, icon, actions, className = "", children, flush }: CardProps) {
  return (
    <section className={`card ${flush ? "card-flush" : ""} ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {icon && (
            <span className="icon-tile">
              <Icon name={icon} />
            </span>
          )}
          <div className="card-titles">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type StatProps = {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  footTone?: "up" | "down" | "flat" | "info";
  aside?: ReactNode;
};

export function Stat({ label, value, foot, footTone = "flat", aside }: StatProps) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {aside}
      </div>
      <div className="stat-value">{value}</div>
      {foot && <div className={`stat-foot ${footTone}`}>{foot}</div>}
    </div>
  );
}

export function IconTile({ name, tone = "info" }: { name: IconName; tone?: Tone }) {
  return (
    <span className={`icon-tile tone-${tone}`}>
      <Icon name={name} />
    </span>
  );
}

type ToggleProps = {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  showLabel?: boolean;
  disabled?: boolean;
};

export function Toggle({ checked, onChange, label, showLabel, disabled }: ToggleProps) {
  return (
    <label className={`toggle ${disabled ? "disabled" : ""}`}>
      {showLabel && <span className="toggle-text">{label}</span>}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={showLabel ? undefined : label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

type TabsProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string; icon?: IconName; count?: number }[];
  label: string;
};

export function Tabs<T extends string>({ value, onChange, items, label }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.icon && <Icon name={item.icon} size={16} />}
          {item.label}
          {item.count !== undefined && <span className="tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

type SegmentedProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly T[] | { value: T; label: string }[];
  label: string;
  className?: string;
};

export function Segmented<T extends string>({ value, onChange, options, label, className = "" }: SegmentedProps<T>) {
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label}>
      {items.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SYMBOL_COLORS: Record<string, string> = {
  AAPL: "#e8edf3",
  MSFT: "#2f7ff0",
  NVDA: "#7a4fe0",
  TSLA: "#e5533d",
  AMZN: "#3654a8",
};

export function SymbolMark({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const bg = SYMBOL_COLORS[symbol] ?? "#33415c";
  const light = bg === "#e8edf3";
  return (
    <span
      className="symbol-mark"
      style={{ width: size, height: size, background: bg, color: light ? "#0b1220" : "#fff" }}
      aria-hidden
    >
      {symbol[0]}
    </span>
  );
}

export function SideBadge({ side }: { side: "BUY" | "SELL" }) {
  return <Badge tone={side === "BUY" ? "success" : "danger"}>{side}</Badge>;
}

/** Loading, error, and empty handling in one place (REQ-0202). */
export function DataState<T>({
  state,
  empty,
  isEmpty,
  rows = 3,
  children,
}: {
  state: { data: T | undefined; error: string | null; loading: boolean; reload: () => void };
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (state.data === undefined) {
    if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
    return <Skeleton rows={rows} />;
  }
  return (
    <>
      {state.error && <ErrorState message={`Couldn't refresh: ${state.error}`} onRetry={state.reload} compact />}
      {isEmpty?.(state.data) ? <div className="empty">{empty ?? "Nothing here yet."}</div> : children(state.data)}
    </>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry, compact }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={`error-state ${compact ? "compact" : ""}`} role="alert">
      <Icon name="alert" size={16} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  icon,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
}) {
  const fallback: IconName = tone === "warning" || tone === "danger" ? "alert" : tone === "success" ? "shieldCheck" : "info";
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={icon ?? fallback} size={18} />
      <div>
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div className="notice-body">{children}</div>}
      </div>
    </div>
  );
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
  width?: number;
};

export function Modal({ open, onClose, labelledBy, children, width = 640 }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ maxWidth: width }}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && <div className="modal-body">{children}</div>}
    </dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { getPortfolio, getRisk, markNotificationsRead } from "../data/service";
import { formatIn, initials, marketStatus, relativeTime } from "../lib/format";
import { useAsync, useNow, useVisibleInterval } from "../lib/hooks";
import { useSession } from "../lib/session";
import { NAV_ITEMS } from "../nav";
import { Icon } from "./Icon";
import { Badge } from "./ui";

export function Layout({ onLogout }: { onLogout: () => void }) {
  const { user, settings, pendingTrades } = useSession();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const page = NAV_ITEMS.find((n) => (n.path === "/" ? location.pathname === "/" : location.pathname.startsWith(n.path)));
  const pendingCount = pendingTrades.filter((p) => p.status === "pending").length;

  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <Brand />
        <div className="workspace">
          <span className="eyebrow">Workspace</span>
          <strong>Paper account</strong>
        </div>
        <nav aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/"}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.path === "/approvals" && pendingCount > 0 && (
                <span className="nav-count" aria-label={`${pendingCount} pending`}>
                  {pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <RiskMonitor />
        <div className="account">
          <span className="avatar sm">{initials(settings.displayName)}</span>
          <div className="account-text">
            <strong>{settings.displayName}</strong>
            <span>{user.email}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onLogout} title="Log out" aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />}

      <div className="main-col">
        <TopBar title={page?.title ?? "TradeMind"} onMenu={() => setNavOpen((v) => !v)} />
        {pendingCount > 0 && !location.pathname.startsWith("/approvals") && <PendingBanner count={pendingCount} />}
        <main id="main" className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Icon name="logo" size={22} />
      </span>
      <span>
        Trade<span className="brand-accent">Mind</span>
      </span>
    </div>
  );
}

function PendingBanner({ count }: { count: number }) {
  const { openApproval } = useSession();
  return (
    <div className="pending-banner" role="status">
      <Icon name="clock" size={16} />
      <span>
        {count} simulated trade{count > 1 ? "s" : ""} awaiting your approval
      </span>
      <button type="button" className="btn btn-sm btn-warning" onClick={() => openApproval()}>
        Review
      </button>
    </div>
  );
}

/** Ticking leaf components, so only they re-render every second. */
function Clock({ timeZone }: { timeZone: string }) {
  const now = useNow(1000);
  return (
    <span className="muted small">
      {formatIn(now, timeZone, { weekday: "long", month: "short", day: "numeric" })} <span aria-hidden>·</span>{" "}
      {formatIn(now, timeZone, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}
    </span>
  );
}

function MarketStatus() {
  const market = marketStatus(useNow(30_000));
  return (
    <span className="market">
      <span className={`live-dot ${market.open ? "on" : "off"}`} aria-hidden />
      <strong>{market.open ? "Market open" : "Market closed"}</strong>
      <span className="muted">{market.label}</span>
    </span>
  );
}

function TopBar({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { settings, notifications } = useSession();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="dashboard" />
      </button>
      <div className="topbar-title">
        <h1>{title}</h1>
        <Clock timeZone={settings.timezone} />
      </div>
      <div className="topbar-right">
        <MarketStatus />
        <Badge tone="success" dot>
          {settings.defaultTradingMode === "paper" ? "Paper trading" : "Live"}
        </Badge>
        <NotificationMenu unread={unread} />
        <Link to="/settings" className="avatar" aria-label="Account settings">
          {initials(settings.displayName)}
        </Link>
      </div>
    </header>
  );
}

function NotificationMenu({ unread }: { unread: number }) {
  const { notifications } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="notif" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button
              type="button"
              className="link-btn"
              disabled={unread === 0}
              onClick={() => void markNotificationsRead()}
            >
              Mark all as read
            </button>
          </div>
          {notifications.length === 0 && <p className="empty">No notifications.</p>}
          <ul>
            {notifications.slice(0, 5).map((n) => (
              <li key={n.id} className={n.read ? "" : "unread"}>
                <strong>{n.title}</strong>
                <span>{n.body}</span>
                <span className="muted small">{relativeTime(n.time)}</span>
              </li>
            ))}
          </ul>
          <Link to="/approvals" className="link-btn notif-all" onClick={() => setOpen(false)}>
            View all notifications <Icon name="chevronRight" size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}

function RiskMonitor() {
  const state = useAsync(async () => {
    const [p, risk] = await Promise.all([getPortfolio(), getRisk()]);
    return { exposure: (p.investedValue / p.portfolioValue) * 100, limit: risk.maxExposurePct };
  }, []);
  useVisibleInterval(() => void state.reload(), 30000);
  const d = state.data;
  const ratio = d ? d.exposure / d.limit : 0;
  const status = !d ? null : ratio > 1 ? "Breach" : ratio > 0.85 ? "Watch" : "Healthy";
  return (
    <div className="risk-monitor">
      <div className="risk-head">
        <Icon name="shield" size={16} />
        <strong>Risk monitor</strong>
        {status && <Badge tone={status === "Healthy" ? "success" : status === "Watch" ? "warning" : "danger"}>{status}</Badge>}
      </div>
      {d ? (
        <>
          <p className="muted small">
            Exposure {d.exposure.toFixed(0)}% of {d.limit}% limit.
          </p>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={d.limit} aria-valuenow={Math.round(d.exposure)} aria-label="Portfolio exposure">
            <span style={{ width: `${Math.min(100, ratio * 100)}%` }} className={status === "Healthy" ? "ok" : "warn"} />
          </div>
        </>
      ) : (
        <p className="muted small">{state.error ? "Unavailable" : "Checking…"}</p>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ApiError, SESSION_EXPIRED_EVENT, currentUser, getToken, logOut, setToken, type User } from "./api";
import { ApprovalModal } from "./components/ApprovalModal";
import { Layout } from "./components/Layout";
import { ErrorState } from "./components/ui";
import { getAssets, getNotifications, getPendingTrades, getSettings, onDataChange, setDemoAccount } from "./data/service";
import type { AppNotification, Asset, PendingTrade, UserSettings } from "./data/types";
import { errorMessage } from "./lib/format";
import { useVisibleInterval } from "./lib/hooks";
import { type Session, SessionContext } from "./lib/session";
import { AiAnalysis } from "./pages/AiAnalysis";
import { Approvals } from "./pages/Approvals";
import { Backtesting } from "./pages/Backtesting";
import { Dashboard } from "./pages/Dashboard";
import { LoginPage } from "./pages/LoginPage";
import { PaperTrading } from "./pages/PaperTrading";
import { Settings } from "./pages/Settings";
import { Strategies } from "./pages/Strategies";
import { TradeHistory } from "./pages/TradeHistory";

const EXPIRED_MESSAGE = "Your session has expired. Please log in again.";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(() => Boolean(getToken()));
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const signIn = useCallback((u: User) => {
    setDemoAccount(u.id, u.email);
    setAuthNotice(null);
    setUser(u);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    currentUser()
      .then(signIn)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) setToken(null);
        else setAuthNotice(errorMessage(error, "Couldn't check your session."));
      })
      .finally(() => setChecking(false));
  }, [signIn]);

  // Any 401 (or the idle timeout) lands here.
  useEffect(() => {
    function onExpired() {
      setToken(null);
      setUser(null);
      setAuthNotice(EXPIRED_MESSAGE);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  async function handleLogout() {
    await logOut().catch(() => undefined);
    setAuthNotice(null);
    setUser(null);
  }

  if (checking) return <p className="boot">Loading TradeMind…</p>;
  if (!user) return <LoginPage notice={authNotice} onSignedIn={signIn} />;
  return <SignedIn key={user.id} user={user} onLogout={handleLogout} />;
}

type Alerts = { notifications: AppNotification[]; pendingTrades: PendingTrade[] };
const NO_ALERTS: Alerts = { notifications: [], pendingTrades: [] };

function SignedIn({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [boot, setBoot] = useState<{ settings: UserSettings; assets: Asset[] } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alerts>(NO_ALERTS);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const lastAlerts = useRef("");

  const loadBoot = useCallback(() => {
    setBootError(null);
    Promise.all([getSettings(), getAssets()])
      .then(([settings, assets]) => setBoot({ settings, assets }))
      .catch((e: unknown) => setBootError(errorMessage(e, "Couldn't load your workspace")));
  }, []);

  // One fetch, one state update, and none at all when nothing changed.
  const refreshAlerts = useCallback(() => {
    Promise.all([getNotifications(), getPendingTrades()])
      .then(([notifications, pendingTrades]) => {
        const key = JSON.stringify([notifications, pendingTrades]);
        if (key === lastAlerts.current) return;
        lastAlerts.current = key;
        setAlerts({ notifications, pendingTrades });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadBoot();
    refreshAlerts();
    // Mutations anywhere (orders, decisions, read flags) refresh alerts immediately.
    return onDataChange(refreshAlerts);
  }, [loadBoot, refreshAlerts]);
  // Polling still catches server-side changes such as proposals expiring.
  useVisibleInterval(refreshAlerts, 5000);

  useIdleTimeout(boot?.settings.sessionTimeoutMinutes);

  const setSettings = useCallback((settings: UserSettings) => setBoot((b) => (b ? { ...b, settings } : b)), []);

  const firstPendingId = alerts.pendingTrades.find((p) => p.status === "pending")?.id ?? null;
  const openApproval = useCallback((tradeId?: string) => setApprovalId(tradeId ?? firstPendingId), [firstPendingId]);

  const session = useMemo<Session | null>(
    () => boot && { user, settings: boot.settings, setSettings, assets: boot.assets, ...alerts, openApproval },
    [user, boot, setSettings, alerts, openApproval],
  );

  if (!session) {
    return bootError ? (
      <div className="boot">
        <ErrorState message={bootError} onRetry={loadBoot} />
      </div>
    ) : (
      <p className="boot">Loading your workspace…</p>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <Routes>
        <Route element={<Layout onLogout={onLogout} />}>
          <Route index element={<Dashboard />} />
          <Route path="strategies" element={<Strategies />} />
          <Route path="paper-trading" element={<PaperTrading />} />
          <Route path="backtesting" element={<Backtesting />} />
          <Route path="ai-analysis" element={<AiAnalysis />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="trade-history" element={<TradeHistory />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ApprovalModal trade={alerts.pendingTrades.find((p) => p.id === approvalId) ?? null} onClose={() => setApprovalId(null)} />
    </SessionContext.Provider>
  );
}

/** Logs out after the user's preferred idle period; the server still enforces its own expiry. */
function useIdleTimeout(minutes: number | undefined) {
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = window.setInterval(() => {
      if (Date.now() - last > minutes * 60_000) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        void logOut().catch(() => undefined);
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(id);
    };
  }, [minutes]);
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ApiError, SESSION_EXPIRED_EVENT, currentUser, getToken, logOut, setToken, type User } from "./api";
import { ApprovalModal } from "./components/ApprovalModal";
import { Layout } from "./components/Layout";
import { ErrorState } from "./components/ui";
import { getNotifications, getPendingTrades, getSettings, setDemoAccount } from "./data/service";
import type { AppNotification, PendingTrade, UserSettings } from "./data/types";
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

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    currentUser()
      .then(setUser)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setToken(null);
          setAuthNotice("Your session has expired. Please log in again.");
        } else {
          setAuthNotice(error instanceof Error ? error.message : "Couldn't check your session.");
        }
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    function onExpired() {
      setToken(null);
      setUser(null);
      setAuthNotice("Your session has expired. Please log in again.");
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  async function handleLogout() {
    await logOut().catch(() => undefined);
    setAuthNotice(null);
    setUser(null);
  }

  if (checking) {
    return <p className="boot">Loading TradeMind…</p>;
  }

  if (!user) {
    return (
      <LoginPage
        notice={authNotice}
        onSignedIn={(u) => {
          setAuthNotice(null);
          setUser(u);
        }}
      />
    );
  }

  return <SignedIn key={user.id} user={user} onLogout={handleLogout} />;
}

function SignedIn({ user, onLogout }: { user: User; onLogout: () => void }) {
  setDemoAccount(user.id, user.email);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingTrades, setPendingTrades] = useState<PendingTrade[]>([]);
  const [approvalId, setApprovalId] = useState<string | null>(null);

  const loadSettings = useCallback(() => {
    setSettingsError(null);
    getSettings()
      .then(setSettings)
      .catch((e: unknown) => setSettingsError(e instanceof Error ? e.message : "Couldn't load settings"));
  }, []);

  const refreshAlerts = useCallback(() => {
    getNotifications().then(setNotifications).catch(() => undefined);
    getPendingTrades().then(setPendingTrades).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadSettings();
    refreshAlerts();
  }, [loadSettings, refreshAlerts]);
  useVisibleInterval(refreshAlerts, 5000);

  // Client-side idle timeout from the user's preference; the server still enforces its own expiry.
  const timeoutMinutes = settings?.sessionTimeoutMinutes;
  useEffect(() => {
    if (!timeoutMinutes) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = window.setInterval(() => {
      if (Date.now() - last > timeoutMinutes * 60_000) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        void logOut().catch(() => undefined);
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(id);
    };
  }, [timeoutMinutes]);

  const openApproval = useCallback(
    (tradeId?: string) => {
      const target = tradeId ?? pendingTrades.find((p) => p.status === "pending")?.id ?? null;
      setApprovalId(target);
    },
    [pendingTrades],
  );

  const session = useMemo<Session | null>(
    () =>
      settings && {
        user,
        settings,
        setSettings,
        notifications,
        pendingTrades,
        refreshAlerts,
        openApproval,
      },
    [user, settings, notifications, pendingTrades, refreshAlerts, openApproval],
  );

  if (!session) {
    return settingsError ? (
      <div className="boot">
        <ErrorState message={settingsError} onRetry={loadSettings} />
      </div>
    ) : (
      <p className="boot">Loading your workspace…</p>
    );
  }

  const approvalTrade = pendingTrades.find((p) => p.id === approvalId) ?? null;

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
      <ApprovalModal trade={approvalTrade} onClose={() => setApprovalId(null)} onDecided={refreshAlerts} />
    </SessionContext.Provider>
  );
}

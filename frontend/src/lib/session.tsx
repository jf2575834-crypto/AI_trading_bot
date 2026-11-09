import { createContext, useContext } from "react";
import type { User } from "../api";
import type { AppNotification, PendingTrade, UserSettings } from "../data/types";

export type Session = {
  user: User;
  settings: UserSettings;
  setSettings: (next: UserSettings) => void;
  notifications: AppNotification[];
  pendingTrades: PendingTrade[];
  /** Re-fetch notifications and pending approvals (e.g. after a decision). */
  refreshAlerts: () => void;
  /** Open the approval modal for a proposal. */
  openApproval: (tradeId?: string) => void;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionContext");
  return value;
}

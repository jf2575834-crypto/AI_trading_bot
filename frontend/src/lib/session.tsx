import { createContext, useContext } from "react";
import type { User } from "../api";
import type { AppNotification, Asset, PendingTrade, UserSettings } from "../data/types";

export type Session = {
  user: User;
  settings: UserSettings;
  setSettings: (next: UserSettings) => void;
  /** Tradable symbols, loaded once per session. */
  assets: Asset[];
  notifications: AppNotification[];
  pendingTrades: PendingTrade[];
  /** Open the approval modal for a proposal (the first pending one if no id). */
  openApproval: (tradeId?: string) => void;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionContext");
  return value;
}

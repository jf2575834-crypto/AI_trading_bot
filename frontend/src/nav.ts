import type { IconName } from "./components/Icon";

export const NAV_ITEMS: { label: string; title: string; path: string; icon: IconName }[] = [
  { label: "Dashboard", title: "Trading Dashboard", path: "/", icon: "dashboard" },
  { label: "Strategies", title: "Strategies & Risk", path: "/strategies", icon: "sliders" },
  { label: "Paper Trading", title: "Paper Trading", path: "/paper-trading", icon: "trendUp" },
  { label: "Backtesting", title: "Historical Backtesting", path: "/backtesting", icon: "history" },
  { label: "AI Analysis", title: "AI Analysis", path: "/ai-analysis", icon: "sparkles" },
  { label: "Approvals", title: "Trade Approval & Notifications", path: "/approvals", icon: "approve" },
  { label: "Trade History", title: "Trade History", path: "/trade-history", icon: "calendar" },
  { label: "Settings", title: "Settings & Security", path: "/settings", icon: "settings" },
];

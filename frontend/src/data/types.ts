// Shapes mirror the field tables in docs/Trademind UI Design.docx so backend
// endpoints can return these directly when they exist.

export type TradingMode = "paper" | "live";
export type BotStatus = "stopped" | "running" | "error";
export type Side = "BUY" | "SELL";
export type OrderType = "market" | "limit";
export type OrderStatus =
  | "pending"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "rejected"
  | "cancelled";

export type Point = { t: string; value: number };

export type PortfolioSummary = {
  mode: TradingMode;
  portfolioValue: number;
  availableCash: number;
  totalReturnPct: number;
  totalReturnAmount: number;
  dayChange: number;
  activeStrategies: number;
  botStatus: BotStatus;
  asOf: string;
};

export type Position = {
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
};

export type ActivityKind = "order" | "execution" | "signal" | "system";

export type Activity = {
  id: string;
  time: string;
  kind: ActivityKind;
  side?: Side;
  title: string;
  detail: string;
};

export type Asset = { symbol: string; name: string; exchange: string };

export type Quote = Asset & { price: number; changePct: number; asOf: string };

export type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };

export type Order = {
  id: string;
  symbol: string;
  side: Side;
  quantity: number;
  orderType: OrderType;
  limitPrice: number | null;
  price: number;
  status: OrderStatus;
  createdAt: string;
};

export type OrderRequest = {
  symbol: string;
  side: Side;
  quantity: number;
  orderType: OrderType;
  limitPrice: number | null;
  /** Client-generated key so a double click can never create two orders. */
  idempotencyKey: string;
};

export type ParamDef = {
  key: string;
  label: string;
  kind: "int" | "decimal" | "symbols";
  min?: number;
  max?: number;
  hint?: string;
};

export type StrategyKind = "technical" | "disclosure";

export type Strategy = {
  id: string;
  name: string;
  kind: StrategyKind;
  description: string;
  tags: string[];
  enabled: boolean;
  version: number;
  updatedAt: string;
  paramDefs: ParamDef[];
  params: Record<string, number | string[]>;
};

export type RiskSettings = {
  maxPositionSize: number;
  maxExposurePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  dailyLossLimit: number;
  approvalRequired: boolean;
  version: number;
  updatedAt: string;
};

export type BacktestRequest = {
  strategyId: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  feePct: number;
  slippagePct: number;
  /** Optional parameter changes to test (e.g. an AI recommendation) without saving them. */
  paramOverrides?: Record<string, number>;
};

export type BacktestTrade = {
  id: string;
  date: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  pnl: number | null;
};

export type BacktestResult = {
  request: BacktestRequest;
  strategyName: string;
  completedAt: string;
  finalValue: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  winRate: number;
  wins: number;
  closedTrades: number;
  maxDrawdownPct: number;
  totalTrades: number;
  equity: Point[];
  benchmark: Point[];
  periods: { label: string; strategy: number; benchmark: number }[];
  trades: BacktestTrade[];
};

export type RecommendationStatus = "proposed" | "testing" | "accepted" | "rejected";

export type Recommendation = {
  id: string;
  title: string;
  detail: string;
  status: RecommendationStatus;
  suggestedParams?: Record<string, number>;
};

export type AnalysisFactor = { label: string; strength: "Strong" | "Moderate" | "Positive" | "Elevated" | "Weak" };

export type AnalysisReport = {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  model: string;
  runAt: string;
  period: { start: string; end: string };
  headline: string;
  signalLabel: string;
  summary: string;
  /** Only present when the confidence measure is defined and validated. */
  confidence: { value: number; validated: boolean; note: string } | null;
  factors: AnalysisFactor[];
  metrics: { totalReturnPct: number; winRate: number; profitFactor: number; riskScore: number };
  equity: Point[];
  benchmark: Point[];
  recommendations: Recommendation[];
  transparency: { supporting: string[]; limitations: string[]; uncertainty: string[] };
};

export type PendingTradeStatus = "pending" | "approved" | "rejected" | "expired" | "failed";

export type PendingTrade = {
  id: string;
  action: Side;
  symbol: string;
  name: string;
  quantity: number;
  estimatedPrice: number;
  strategyName: string;
  rationale: string;
  riskCheck: { passed: boolean; summary: string; details: string };
  createdAt: string;
  /** Server-provided deadline; the backend enforces expiry. */
  expiresAt: string;
  status: PendingTradeStatus;
  decidedAt: string | null;
};

export type NotificationKind = "approved" | "signal" | "risk" | "rejected" | "system";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  time: string;
  read: boolean;
};

export type UserSettings = {
  displayName: string;
  timezone: string;
  defaultTradingMode: TradingMode;
  notifications: {
    tradeApprovals: boolean;
    orderFills: boolean;
    riskAlerts: boolean;
    systemAlerts: boolean;
  };
  /** null means the backend does not implement 2FA yet. */
  twoFactorEnabled: boolean | null;
  sessionTimeoutMinutes: number;
};

export type ExecutedTrade = {
  id: string;
  time: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  strategyName: string | null;
  source: "manual" | "approved" | "automatic";
};

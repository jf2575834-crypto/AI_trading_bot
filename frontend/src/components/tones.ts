// Status → badge tone, one table per status enum. Use with <StatusBadge tones={...} />.
import type { OrderStatus, PendingTradeStatus, RecommendationStatus } from "../data/types";
import type { Tone } from "./ui";

export const ORDER_TONES: Record<OrderStatus, Tone> = {
  pending: "warning",
  accepted: "info",
  partially_filled: "info",
  filled: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export const DECISION_TONES: Record<PendingTradeStatus, Tone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  expired: "neutral",
  failed: "danger",
};

export const RECOMMENDATION_TONES: Record<RecommendationStatus, Tone> = {
  proposed: "info",
  testing: "warning",
  accepted: "success",
  rejected: "danger",
};

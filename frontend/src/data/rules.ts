// Validation rules shared by the pages (to give instant feedback) and the service
// (which enforces them, as the real backend must). One definition, no drift.
import { HISTORY_START } from "./market";
import type { BacktestRequest, ParamDef, RiskSettings, UserSettings } from "./types";

/** First date with market data; backtests cannot start earlier. */
export const DATA_START = HISTORY_START;

export type Errors<K extends string> = Partial<Record<K, string>>;

/** Blank input becomes NaN so "required" checks fail instead of silently reading 0. */
export function parseNumber(raw: string): number {
  return raw.trim() === "" ? NaN : Number(raw);
}

const TICKER = /^[A-Za-z]{1,5}$/;

export function parseSymbols(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(",");
  return list.map((x) => x.trim().toUpperCase()).filter(Boolean);
}

export function validateParams(defs: ParamDef[], params: Record<string, number | string | string[]>): Errors<string> {
  const errors: Errors<string> = {};
  for (const def of defs) {
    const raw = params[def.key];
    if (def.kind === "symbols") {
      const bad = parseSymbols((raw ?? []) as string | string[]).find((x) => !TICKER.test(x));
      if (bad) errors[def.key] = `"${bad}" is not a valid ticker`;
      continue;
    }
    const n = typeof raw === "number" ? raw : parseNumber(String(raw ?? ""));
    if (!Number.isFinite(n)) errors[def.key] = "Enter a number";
    else if (def.kind === "int" && !Number.isInteger(n)) errors[def.key] = "Enter a whole number";
    else if (def.min !== undefined && n < def.min) errors[def.key] = `Must be at least ${def.min}`;
    else if (def.max !== undefined && n > def.max) errors[def.key] = `Must be at most ${def.max}`;
  }
  // Cross-field rules declared on the definitions, e.g. slow period > fast period.
  for (const def of defs) {
    if (!def.greaterThan || errors[def.key] || errors[def.greaterThan]) continue;
    if (Number(params[def.key]) <= Number(params[def.greaterThan])) {
      const other = defs.find((d) => d.key === def.greaterThan)?.label.toLowerCase() ?? def.greaterThan;
      errors[def.key] = `Must be greater than the ${other}`;
    }
  }
  return errors;
}

type RiskLimits = Pick<RiskSettings, "maxPositionSize" | "maxExposurePct" | "stopLossPct" | "takeProfitPct" | "dailyLossLimit">;

export function validateRisk(r: RiskLimits): Errors<keyof RiskLimits> {
  const e: Errors<keyof RiskLimits> = {};
  if (!(r.maxPositionSize > 0)) e.maxPositionSize = "Enter an amount greater than 0";
  if (!(r.maxExposurePct > 0 && r.maxExposurePct <= 100)) e.maxExposurePct = "Enter 1 to 100";
  if (!(r.stopLossPct > 0 && r.stopLossPct <= 50)) e.stopLossPct = "Enter above 0, up to 50";
  if (!(r.takeProfitPct > 0 && r.takeProfitPct <= 500)) e.takeProfitPct = "Enter above 0, up to 500";
  else if (!e.stopLossPct && r.takeProfitPct <= r.stopLossPct) e.takeProfitPct = "Must be larger than the stop loss";
  if (!(r.dailyLossLimit > 0)) e.dailyLossLimit = "Enter an amount greater than 0";
  return e;
}

export const SESSION_TIMEOUT = { min: 5, max: 720 };
export const DISPLAY_NAME_MAX = 60;

type SettingsFields = Pick<UserSettings, "displayName" | "sessionTimeoutMinutes" | "defaultTradingMode">;

export function validateSettings(s: SettingsFields): Errors<keyof SettingsFields> {
  const e: Errors<keyof SettingsFields> = {};
  const name = s.displayName.trim();
  if (name === "") e.displayName = "Enter a display name";
  else if (name.length > DISPLAY_NAME_MAX) e.displayName = `Use ${DISPLAY_NAME_MAX} characters or fewer`;
  const t = s.sessionTimeoutMinutes;
  if (!Number.isInteger(t) || t < SESSION_TIMEOUT.min || t > SESSION_TIMEOUT.max) {
    e.sessionTimeoutMinutes = `Enter whole minutes between ${SESSION_TIMEOUT.min} and ${SESSION_TIMEOUT.max}`;
  }
  if (s.defaultTradingMode === "live") e.defaultTradingMode = "Live trading is not available in this prototype.";
  return e;
}

type BacktestFields = Omit<BacktestRequest, "paramOverrides">;

export function validateBacktest(r: BacktestFields, today: string): Errors<keyof BacktestFields> {
  const e: Errors<keyof BacktestFields> = {};
  if (!r.strategyId) e.strategyId = "Choose a strategy";
  if (!r.symbol) e.symbol = "Choose an asset";
  if (!r.startDate) e.startDate = "Choose a start date";
  else if (r.startDate < HISTORY_START) e.startDate = `Data starts on ${HISTORY_START}`;
  if (!r.endDate) e.endDate = "Choose an end date";
  else if (r.startDate && r.endDate < r.startDate) e.endDate = "End date cannot be before the start date";
  else if (r.endDate > today) e.endDate = "End date cannot be in the future";
  if (!(r.initialCapital >= 100)) e.initialCapital = "Enter at least $100";
  if (!(r.feePct >= 0 && r.feePct <= 5)) e.feePct = "Enter 0 to 5";
  if (!(r.slippagePct >= 0 && r.slippagePct <= 5)) e.slippagePct = "Enter 0 to 5";
  return e;
}

export function hasErrors(errors: object): boolean {
  return Object.values(errors).some(Boolean);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function money(value: number, whole = false): string {
  return (whole ? usd0 : usd).format(value);
}

export function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "−"}${usd.format(Math.abs(value))}`;
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

export function compact(value: number): string {
  return compactFmt.format(value);
}

/** "partially_filled" → "Partially filled" */
export function humanize(value: string): string {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  return error instanceof Error ? error.message : fallback;
}

// ---------- dates ----------

const validZones = new Map<string, string>();

/** Returns the zone if Intl accepts it, otherwise UTC. */
export function safeZone(timeZone: string): string {
  let zone = validZones.get(timeZone);
  if (!zone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      zone = timeZone;
    } catch {
      zone = "UTC";
    }
    validZones.set(timeZone, zone);
  }
  return zone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Cached formatter: constructing Intl formatters is the expensive part. */
function dtf(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const zone = safeZone(timeZone);
  const key = `${zone}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone });
    formatters.set(key, f);
  }
  return f;
}

export function formatIn(date: Date | number | string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return dtf(timeZone, options).format(new Date(date));
}

export function dateTime(iso: string, timeZone: string): string {
  return formatIn(iso, timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function timeOnly(iso: string, timeZone: string): string {
  return formatIn(iso, timeZone, { hour: "numeric", minute: "2-digit" });
}

export function monthYear(iso: string, timeZone: string): string {
  return formatIn(iso, timeZone, { month: "long", year: "numeric" });
}

export function hourIn(timeZone: string, now: Date | number = Date.now()): number {
  return Number(formatIn(now, timeZone, { hour: "numeric", hourCycle: "h23" }));
}

/** For plain YYYY-MM-DD market dates (no timezone conversion). */
export function shortDate(day: string): string {
  return formatIn(`${day}T00:00:00Z`, "UTC", { month: "short", day: "numeric" });
}

export function longDate(day: string): string {
  return formatIn(`${day}T00:00:00Z`, "UTC", { month: "short", day: "numeric", year: "numeric" });
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD for `n` days before today. */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

export function relativeTime(when: string | number, now = Date.now()): string {
  const seconds = Math.round((now - new Date(when).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function secondsLeft(deadline: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

/** 125 → "02:05" */
export function countdown(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "TM";
}

export function tone(value: number): "up" | "down" | "flat" {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

/** US equity regular session, Mon–Fri 9:30–16:00 America/New_York (holidays not modelled). */
export function marketStatus(now: Date | number): { open: boolean; label: string } {
  const parts = Object.fromEntries(
    dtf("America/New_York", { weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  const open = weekday && minutes >= 570 && minutes < 960;
  if (open) {
    const left = 960 - minutes;
    return { open, label: `Closes in ${Math.floor(left / 60)}h ${left % 60}m` };
  }
  return { open, label: weekday && minutes < 570 ? "Opens 9:30 AM ET" : "Opens next trading day" };
}

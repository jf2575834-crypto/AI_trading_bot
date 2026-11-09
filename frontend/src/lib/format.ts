const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function dateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function timeOnly(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: safeZone(timeZone), hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/** For plain YYYY-MM-DD market dates (no timezone conversion). */
export function shortDate(day: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export function longDate(day: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "TM";
}

export function tone(value: number): "up" | "down" | "flat" {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

/** US equity regular session, Mon–Fri 9:30–16:00 America/New_York (holidays not modelled). */
export function marketStatus(now: Date): { open: boolean; label: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
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

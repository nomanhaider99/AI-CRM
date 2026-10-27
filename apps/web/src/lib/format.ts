const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const amountFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatAmount = (n: number) => amountFmt.format(n);

const moneyFmts = new Map<string, Intl.NumberFormat>();
/** "$1,200" style, without cents when there are none; falls back to "1,200.00 XYZ" for unknown codes. */
export function formatMoney(n: number, currency: string): string {
  let fmt = moneyFmts.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 });
    } catch {
      return `${amountFmt.format(n)} ${currency}`;
    }
    moneyFmts.set(currency, fmt);
  }
  return fmt.format(n);
}

const currencyFmts = new Map<string, Intl.NumberFormat>();
/** Always with cents, for invoices: "$1,200.00"; "1,200.00 XYZ" for unknown codes. */
export function formatCurrency(n: number, currency: string): string {
  let fmt = currencyFmts.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return `${amountFmt.format(n)} ${currency}`;
    }
    currencyFmts.set(currency, fmt);
  }
  return fmt.format(n);
}

/** A calendar date (YYYY-MM-DD) in the local time zone; new Date("2026-10-01") would be UTC midnight. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
export const formatDay = (day: string) => dateFmt.format(parseDay(day));

/** Today (or today + days) as YYYY-MM-DD in the local time zone. */
export function isoDay(addDays = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday" or a date, for timeline day separators. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return dateFmt.format(d);
}

export const dayKey = (iso: string) => new Date(iso).toDateString();

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0], parts[0]?.[1]];
  return letters.filter(Boolean).join("").toUpperCase() || "?";
}

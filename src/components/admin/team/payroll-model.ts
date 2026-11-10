import { brandConfig } from "@/config/brand";

export const STANDARD_DAYS_PER_WEEK = 6;
export const DEFAULT_DAILY_RATE_CENTAVOS = 20_000; // ₱200.00
export const DEFAULT_CASH_ADVANCE_CENTAVOS = 100_000; // ₱1,000.00

/** Returns the Manila day YYYY-MM-DD */
export function manilaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: brandConfig.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Given any day (YYYY-MM-DD), returns the Monday of that week */
export function getMondayOfWeek(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const dayOfWeek = d.getUTCDay(); // 0 is Sunday, 1 is Monday, ...
  const diffToMonday = (dayOfWeek + 6) % 7; // Monday = 0, Sunday = 6
  const mon = new Date(d.getTime() - diffToMonday * 86_400_000);
  return mon.toISOString().slice(0, 10);
}

/** Given a Monday (YYYY-MM-DD), returns the Sunday of that week */
export function getSundayOfWeek(monday: string): string {
  const d = new Date(monday + "T00:00:00Z");
  const sun = new Date(d.getTime() + 6 * 86_400_000);
  return sun.toISOString().slice(0, 10);
}

/** Returns the Monday of the previous week */
export function getPreviousMonday(monday: string): string {
  const d = new Date(monday + "T00:00:00Z");
  const prev = new Date(d.getTime() - 7 * 86_400_000);
  return prev.toISOString().slice(0, 10);
}

/** Returns the Monday of the next week */
export function getNextMonday(monday: string): string {
  const d = new Date(monday + "T00:00:00Z");
  const next = new Date(d.getTime() + 7 * 86_400_000);
  return next.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatWeekLabel(monday: string, sunday: string): string {
  const mParts = { m: Number(monday.slice(5, 7)), d: Number(monday.slice(8, 10)), y: Number(monday.slice(0, 4)) };
  const sParts = { m: Number(sunday.slice(5, 7)), d: Number(sunday.slice(8, 10)), y: Number(sunday.slice(0, 4)) };
  if (mParts.y === sParts.y) {
    if (mParts.m === sParts.m) {
      return `${MONTHS[mParts.m - 1]} ${mParts.d} – ${sParts.d}, ${mParts.y}`;
    }
    return `${MONTHS[mParts.m - 1]} ${mParts.d} – ${MONTHS[sParts.m - 1]} ${sParts.d}, ${mParts.y}`;
  }
  return `${MONTHS[mParts.m - 1]} ${mParts.d}, ${mParts.y} – ${MONTHS[sParts.m - 1]} ${sParts.d}, ${sParts.y}`;
}

export function computeStaffPayroll({
  dailyRateCentavos = DEFAULT_DAILY_RATE_CENTAVOS,
  daysAbsent = 0,
  commissionEarnedCentavos = 0,
  cashAdvanceCentavos = 0,
}: {
  dailyRateCentavos?: number;
  daysAbsent?: number;
  commissionEarnedCentavos?: number;
  cashAdvanceCentavos?: number;
}) {
  const clampedAbsences = Math.max(0, Math.min(STANDARD_DAYS_PER_WEEK, daysAbsent));
  const daysWorked = STANDARD_DAYS_PER_WEEK - clampedAbsences;
  const baseSalaryCentavos = daysWorked * dailyRateCentavos;
  const grossPayCentavos = baseSalaryCentavos + commissionEarnedCentavos;
  const netPayoutCentavos = grossPayCentavos - cashAdvanceCentavos;
  return {
    daysWorked,
    daysAbsent: clampedAbsences,
    baseSalaryCentavos,
    grossPayCentavos,
    netPayoutCentavos,
  };
}

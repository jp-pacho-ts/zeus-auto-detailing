// P1-40: dates, labels and plain words of the Sales Analytics screen. No React, no network, so they are unit tested.
import { formatPesos } from "@/lib/commission";
import { brandConfig } from "@/config/brand";
import type { AdminAnalyticsBucket, AdminAnalyticsBucketUnit } from "@/types/admin-contracts";

export type AnalyticsPreset = "THIS_MONTH" | "LAST_MONTH" | "THIS_YEAR";
export interface AnalyticsPeriod { from: string; to: string }

export const REVENUE_DEFINITION = "Final prices of the jobs finished in this period, by the day they were finished (Manila). This is what the jobs were priced at, not cash counted: the system does not record payments.";
export const PROFIT_LATER = "Profit and expenses arrive with the Expenses page. No figure is shown until then.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const parts = (day: string) => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), date: Number(day.slice(8, 10)) });
const short = (day: string) => `${MONTHS[parts(day).month - 1]} ${parts(day).date}`;

/** The Manila day, whatever zone the device is in. */
export const manilaToday = (now: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: brandConfig.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export function periodRange(preset: AnalyticsPreset, today: string): AnalyticsPeriod {
  const { year, month } = parts(today);
  if (preset === "THIS_YEAR") return { from: `${year}-01-01`, to: `${year}-12-31` };
  const zeroBased = preset === "THIS_MONTH" ? month - 1 : month - 2;
  return { from: iso(Date.UTC(year, zeroBased, 1)), to: iso(Date.UTC(year, zeroBased + 1, 0)) };
}

/** The same limits as AnalyticsQuerySchema, so the screen can say so before asking. */
export function customProblem(from: string, to: string): string | null {
  if (!from || !to) return "Choose a start day and an end day.";
  if (to < from) return "The end day can't be before the start day.";
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 > 365 ? "Choose a range of one year or less." : null;
}

export const analyticsUrl = ({ from, to }: AnalyticsPeriod): string => `/api/admin/analytics?from=${from}&to=${to}`;

export function periodLabel(from: string, to: string): string {
  if (from === to) return `${short(from)}, ${parts(from).year}`;
  return parts(from).year === parts(to).year ? `${short(from)} to ${short(to)}, ${parts(to).year}` : `${short(from)}, ${parts(from).year} to ${short(to)}, ${parts(to).year}`;
}

const isWholeMonth = (b: AdminAnalyticsBucket) => parts(b.start).date === 1 && iso(Date.parse(b.end) + 86_400_000).endsWith("-01");
export function bucketLabel(b: AdminAnalyticsBucket, unit: AdminAnalyticsBucketUnit): string {
  if (unit === "MONTH" && isWholeMonth(b)) return `${MONTHS[parts(b.start).month - 1]} ${parts(b.start).year}`;
  return b.start === b.end ? short(b.start) : `${short(b.start)} to ${short(b.end)}`;
}
export function bucketAxisLabel(b: AdminAnalyticsBucket, unit: AdminAnalyticsBucketUnit): string {
  return unit === "DAY" ? String(parts(b.start).date) : unit === "WEEK" ? short(b.start) : MONTHS[parts(b.start).month - 1];
}
export const chartTitle = (unit: AdminAnalyticsBucketUnit): string => `Revenue by ${unit.toLowerCase()}`;
export const chartEmptyText = (finishedJobs: number): string => (finishedJobs === 0 ? "No finished jobs in this period." : "The finished jobs in this period have no final price.");

export function barText(b: AdminAnalyticsBucket): string {
  if (b.future) return "Not yet";
  if (b.jobs === 0) return "No finished job";
  return `${formatPesos(b.revenueCentavos)} from ${b.jobs} ${b.jobs === 1 ? "job" : "jobs"}`;
}

/** Clean axis steps (1, 2 or 5 x 10^n) from zero to at or above the top value, at most 7 ticks. Display only. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= 1 && Math.ceil(max / s) <= 6) ?? magnitude;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => Math.round(i * step));
}

/** Axis money only: in full under 10,000 pesos, then K and M. Every exact figure uses formatPesos. */
export function compactPesos(centavos: number): string {
  const pesos = centavos / 100;
  if (pesos < 10_000) return `₱${Math.round(pesos).toLocaleString("en-PH")}`;
  return pesos < 1_000_000 ? `₱${+(pesos / 1_000).toFixed(1)}K` : `₱${+(pesos / 1_000_000).toFixed(1)}M`;
}

const GROUPS: Record<string, string> = { WASH: "Wash", DETAILING: "Detailing", GRAPHENE: "Graphene", TINT: "Tint", PPF: "PPF", REPAINT: "Repaint" };
export const groupLabel = (code: string): string => GROUPS[code] ?? code;

export const STATUS_ROWS = [["PENDING", "Pending"], ["CONFIRMED", "Confirmed"], ["IN_PROGRESS", "In progress"], ["COMPLETED", "Finished"], ["CANCELLED", "Cancelled"]] as const;

export const averageText = (centavos: number | null): string => (centavos === null ? "–" : formatPesos(centavos));
export const stockValueText = (centavos: number | null): string => (centavos === null ? "Too large to show" : formatPesos(centavos));

export function unpricedNotice(jobs: number): string | null {
  if (jobs === 0) return null;
  return jobs === 1 ? "1 finished job has a service with no final price, so revenue is short by that service." : `${jobs} finished jobs have a service with no final price, so revenue is short by those services.`;
}
export function deletedNote(n: number): string | null {
  if (n === 0) return null;
  return n === 1 ? "1 finished booking dated in this period was deleted and is not counted." : `${n} finished bookings dated in this period were deleted and are not counted.`;
}
export const olderNote = (n: number): string | null => (n === 0 ? null : `${n} finished ${n === 1 ? "booking" : "bookings"} from the older booking system ${n === 1 ? "is" : "are"} not counted.`);
export function stockNote(noCostItems: number): string {
  const base = "Stock on hand at each supply's cost.";
  if (noCostItems === 0) return base;
  return noCostItems === 1 ? `${base} 1 supply has no cost and is left out.` : `${base} ${noCostItems} supplies have no cost and are left out.`;
}
export function commissionEarnedNote(startsAt: string, from: string): string {
  const base = "On the jobs finished in this period.", began = manilaToday(new Date(startsAt));
  return from < began ? `${base} Commissions began on ${short(began)}, ${parts(began).year}, so earlier jobs have none.` : base;
}

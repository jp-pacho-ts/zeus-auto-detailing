import "server-only";
import { safeCentavos } from "@/lib/commission";
import type { AdminAnalyticsBucket, AdminAnalyticsBucketUnit, AdminAnalyticsSales } from "@/types/admin-contracts";
import type { LocalDate } from "@/types/contracts";
import { addDays } from "./context";
import { bookingTotals, effectivePrice, type TotalsLine } from "./totals";

// P1-40: the money and calendar rules of Sales & Analytics. The price rule is bookingTotals/effectivePrice, not a copy of it.
// Every sum is BigInt; safeCentavos refuses an amount it could not show exactly instead of rounding it.
export interface AnalyticsLineRow {
  bookingId: string;
  reference: string;
  finishedOn: LocalDate; // the Manila day the job was finished
  priceStatus: TotalsLine["priceStatus"];
  subtotalCentavos: number | null;
  staffPriceCentavos: number | null;
  referenceSubtotalCentavos: number | null;
  groupCode: string;
  queueCode: string | null;
  queueName: string | null;
  serviceId: string;
  name: string;
}

const UNPRICED_LIST_LIMIT = 20;
const TOP_SERVICES = 5;
const ZERO = BigInt(0), TWO = BigInt(2); // the build target has no BigInt literals

/** a / b rounded to the nearest whole number, half up (a and b not negative, b above 0). */
export const halfUp = (a: bigint, b: bigint): bigint => (TWO * a + b) / (TWO * b);

const dayCount = (from: LocalDate, to: LocalDate) => (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
const unitFor = (days: number): AdminAnalyticsBucketUnit => (days <= 31 ? "DAY" : days <= 180 ? "WEEK" : "MONTH");
const firstOf = (a: LocalDate, b: LocalDate) => (a < b ? a : b);
function bucketEnd(day: LocalDate, unit: AdminAnalyticsBucketUnit): LocalDate {
  if (unit === "DAY") return day;
  if (unit === "WEEK") return addDays(day, (7 - new Date(day).getUTCDay()) % 7); // the Sunday of its Monday-to-Sunday week
  const next = new Date(day);
  return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

/** The calendar of a range: made here so the screen never does date maths. A bucket that has not started is marked as the future. */
export function bucketsFor(from: LocalDate, to: LocalDate, today: LocalDate): { unit: AdminAnalyticsBucketUnit; rows: AdminAnalyticsBucket[] } {
  const unit = unitFor(dayCount(from, to));
  const rows: AdminAnalyticsBucket[] = [];
  for (let start = from; start <= to; ) {
    const end = firstOf(bucketEnd(start, unit), to);
    rows.push({ start, end, future: start > today, revenueCentavos: 0, jobs: 0 });
    start = addDays(end, 1);
  }
  return { unit, rows };
}

const add = (map: Map<string, bigint>, key: string, amount: bigint) => map.set(key, (map.get(key) ?? ZERO) + amount);
const byMoneyThenCode = <T extends { amount: bigint; code: string }>(a: T, b: T) => (a.amount === b.amount ? a.code.localeCompare(b.code) : a.amount > b.amount ? -1 : 1);

export function summarizeSales(rows: readonly AnalyticsLineRow[], range: { from: LocalDate; to: LocalDate; today: LocalDate }): AdminAnalyticsSales {
  const jobs = new Map<string, AnalyticsLineRow[]>();
  for (const r of rows) jobs.set(r.bookingId, [...(jobs.get(r.bookingId) ?? []), r]);

  const buckets = bucketsFor(range.from, range.to, range.today);
  const bucketOf = (day: LocalDate) => buckets.rows.find((b) => b.start <= day && day <= b.end);
  const bucketMoney = new Map<string, bigint>(), bucketJobs = new Map<string, number>();
  let revenue = ZERO, fullyPricedMoney = ZERO, fullyPriced = 0;
  const unpriced: string[] = [];
  for (const lines of jobs.values()) {
    const totals = bookingTotals(lines.map((l) => ({ ...l, removed: false })), { receiptTotalCentavos: null, receiptEstimatedCentavos: null });
    const money = BigInt(totals.currentTotalCentavos);
    revenue += money;
    if (totals.forQuoteCount === 0) {
      fullyPriced += 1;
      fullyPricedMoney += money;
    } else unpriced.push(lines[0].reference);
    const bucket = bucketOf(lines[0].finishedOn);
    if (bucket) {
      add(bucketMoney, bucket.start, money);
      bucketJobs.set(bucket.start, (bucketJobs.get(bucket.start) ?? 0) + 1);
    }
  }

  const groups = new Map<string, bigint>(), queues = new Map<string, bigint>(), queueNames = new Map<string, string>();
  const services = new Map<string, { serviceId: string; name: string; amount: bigint; count: number }>();
  for (const l of rows) {
    const price = BigInt(effectivePrice({ ...l, removed: false }) ?? 0);
    add(groups, l.groupCode, price);
    const queue = l.queueCode ?? "OTHER";
    add(queues, queue, price);
    queueNames.set(queue, l.queueName ?? "Other");
    const seen = services.get(l.serviceId);
    services.set(l.serviceId, { serviceId: l.serviceId, name: l.name, amount: (seen?.amount ?? ZERO) + price, count: (seen?.count ?? 0) + 1 }); // rows come oldest first: the newest name wins
  }
  const ranked = (map: Map<string, bigint>) => [...map].map(([code, amount]) => ({ code, amount })).filter((x) => x.amount > ZERO).sort(byMoneyThenCode);

  return {
    revenueCentavos: safeCentavos(revenue),
    finishedJobs: jobs.size,
    fullyPricedJobs: fullyPriced,
    averageJobCentavos: fullyPriced === 0 ? null : safeCentavos(halfUp(fullyPricedMoney, BigInt(fullyPriced))),
    unpriced: { jobs: unpriced.length, references: unpriced.reverse().slice(0, UNPRICED_LIST_LIMIT) },
    buckets: {
      unit: buckets.unit,
      rows: buckets.rows.map((b) => ({ ...b, revenueCentavos: safeCentavos(bucketMoney.get(b.start) ?? ZERO), jobs: bucketJobs.get(b.start) ?? 0 })),
    },
    byGroup: ranked(groups).map((x) => ({ code: x.code, revenueCentavos: safeCentavos(x.amount) })),
    byQueue: ranked(queues).map((x) => ({ code: x.code, name: queueNames.get(x.code)!, revenueCentavos: safeCentavos(x.amount) })),
    topServices: [...services.values()]
      .filter((x) => x.amount > ZERO)
      .sort((a, b) => (a.amount === b.amount ? b.count - a.count || a.name.localeCompare(b.name) : a.amount > b.amount ? -1 : 1))
      .slice(0, TOP_SERVICES)
      .map((x) => ({ serviceId: x.serviceId, name: x.name, revenueCentavos: safeCentavos(x.amount), count: x.count })),
  };
}

/** Today's stock at each active supply's cost. P1-38 allows a total past a safe integer: that one figure is null, the page still works. */
export function stockSummary(items: readonly { currentStock: number; costPerUnitCentavos: number; isActive: boolean }[]): { valueCentavos: number | null; noCostItems: number } {
  const active = items.filter((i) => i.isActive);
  const value = active.reduce((total, i) => total + BigInt(i.currentStock) * BigInt(i.costPerUnitCentavos), ZERO);
  return {
    valueCentavos: value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value),
    noCostItems: active.filter((i) => i.currentStock > 0 && i.costPerUnitCentavos === 0).length,
  };
}

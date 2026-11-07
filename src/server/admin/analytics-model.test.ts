// P1-40 Sales & Analytics: the money and calendar rules, with no database. Bookings arrive as one row per active line.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketsFor, halfUp, stockSummary, summarizeSales, type AnalyticsLineRow } from "./analytics-model";

const row = (extra: Partial<AnalyticsLineRow> = {}): AnalyticsLineRow => ({
  bookingId: "b1", reference: "ZEUS-A00001", finishedOn: "2026-10-15", priceStatus: "PRICED", subtotalCentavos: 10_000, staffPriceCentavos: null,
  referenceSubtotalCentavos: null, groupCode: "WASH", queueCode: "WASH", queueName: "Wash", serviceId: "s1", name: "Basic Wash", ...extra,
});
const october = { from: "2026-10-01", to: "2026-10-31", today: "2026-11-07" };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

test("the bucket follows the length of the range: up to 31 days by day, up to 180 by week, then by month", () => {
  assert.equal(bucketsFor("2026-10-01", "2026-10-31", "2026-11-07").unit, "DAY");
  assert.equal(bucketsFor("2026-10-01", "2026-11-01", "2026-11-07").unit, "WEEK");
  assert.equal(bucketsFor("2026-01-01", "2026-06-29", "2026-11-07").unit, "WEEK"); // 180 days
  assert.equal(bucketsFor("2026-01-01", "2026-06-30", "2026-11-07").unit, "MONTH"); // 181 days
});

test("every day of a day range is listed, including the leap day", () => {
  const { rows } = bucketsFor("2028-02-27", "2028-03-01", "2028-12-31");
  assert.deepEqual(rows.map((r) => [r.start, r.end]), [["2028-02-27", "2028-02-27"], ["2028-02-28", "2028-02-28"], ["2028-02-29", "2028-02-29"], ["2028-03-01", "2028-03-01"]]);
});

test("weeks run Monday to Sunday, stay one week across a new year, and are clipped at the edges of the range", () => {
  const { unit, rows } = bucketsFor("2026-12-02", "2027-01-05", "2027-12-31");
  assert.equal(unit, "WEEK");
  assert.deepEqual(rows.map((r) => [r.start, r.end]), [
    ["2026-12-02", "2026-12-06"], ["2026-12-07", "2026-12-13"], ["2026-12-14", "2026-12-20"], ["2026-12-21", "2026-12-27"],
    ["2026-12-28", "2027-01-03"], ["2027-01-04", "2027-01-05"],
  ]);
});

test("months are calendar months, February 2028 has 29 days, and part months are clipped", () => {
  const { unit, rows } = bucketsFor("2028-01-15", "2028-12-31", "2028-12-31");
  assert.equal(unit, "MONTH");
  assert.equal(rows.length, 12);
  assert.deepEqual([rows[0].start, rows[0].end], ["2028-01-15", "2028-01-31"]);
  assert.deepEqual([rows[1].start, rows[1].end], ["2028-02-01", "2028-02-29"]);
  assert.deepEqual([rows[11].start, rows[11].end], ["2028-12-01", "2028-12-31"]);
});

test("only a bucket that starts after today is in the future", () => {
  const { rows } = bucketsFor("2026-11-06", "2026-11-08", "2026-11-07");
  assert.deepEqual(rows.map((r) => r.future), [false, false, true]);
  const weeks = bucketsFor("2026-11-02", "2026-12-20", "2026-11-07").rows;
  assert.equal(weeks[0].future, false, "the week holding today has started");
  assert.equal(weeks[1].future, true);
});

test("a line counts at the price the admin set, else its charged subtotal; a for-quote line with no price counts as nothing", () => {
  const s = summarizeSales([
    row({ bookingId: "a", staffPriceCentavos: 25_000 }),
    row({ bookingId: "b", priceStatus: "FOR_QUOTE", subtotalCentavos: null, staffPriceCentavos: 40_000 }),
    row({ bookingId: "c", priceStatus: "FOR_QUOTE", subtotalCentavos: null, staffPriceCentavos: null, referenceSubtotalCentavos: 99_999 }),
    row({ bookingId: "d", staffPriceCentavos: 0 }),
  ], october);
  assert.equal(s.revenueCentavos, 65_000, "never the reference price");
  assert.equal(s.finishedJobs, 4);
});

test("a job with any unpriced line is listed with its reference, newest first, at most 20", () => {
  const rows = Array.from({ length: 23 }, (_, i) => row({ bookingId: `u${i}`, reference: `ZEUS-U${i}`, priceStatus: "FOR_QUOTE", subtotalCentavos: null }));
  const s = summarizeSales([row(), ...rows], october);
  assert.equal(s.unpriced.jobs, 23);
  assert.equal(s.unpriced.references.length, 20);
  assert.equal(s.unpriced.references[0], "ZEUS-U22");
});

test("the average leaves a part-priced job out of both sides, rounds half up, and is null when there is no fully priced job", () => {
  const job = (id: string, price: number) => row({ bookingId: id, subtotalCentavos: price });
  const partPriced = [row({ bookingId: "p", subtotalCentavos: 1_000_000 }), row({ bookingId: "p", priceStatus: "FOR_QUOTE", subtotalCentavos: null })];
  const s = summarizeSales([job("a", 100), job("b", 101), ...partPriced], october);
  assert.equal(s.fullyPricedJobs, 2);
  assert.equal(s.averageJobCentavos, 101, "201 / 2 = 100.5, half up");
  assert.equal(s.revenueCentavos, 1_000_201, "the priced part still counts in revenue");
  assert.equal(summarizeSales([job("a", 100), job("b", 0), job("c", 0)], october).averageJobCentavos, 33);
  assert.equal(summarizeSales(partPriced, october).averageJobCentavos, null);
  assert.equal(summarizeSales([], october).averageJobCentavos, null);
});

test("halfUp is exact past a safe integer", () => {
  assert.equal(halfUp(9_007_199_254_740_993n, 1n), 9_007_199_254_740_993n);
  assert.equal(halfUp(3n, 2n), 2n);
  assert.equal(halfUp(5n, 4n), 1n);
});

test("sums are exact: an amount that cannot be shown exactly is refused, never rounded", () => {
  const huge = (id: string, price: number) => row({ bookingId: id, subtotalCentavos: price });
  assert.equal(summarizeSales([huge("a", 2 ** 52), huge("b", 2 ** 52 - 1)], october).revenueCentavos, 2 ** 53 - 1);
  assert.throws(() => summarizeSales([huge("a", 2 ** 53 - 1), huge("b", 2)], october), RangeError);
});

test("a job lands in the bucket of the day it was finished", () => {
  const s = summarizeSales([row({ finishedOn: "2026-10-01" }), row({ bookingId: "b", finishedOn: "2026-10-31", subtotalCentavos: 5 })], october);
  assert.equal(s.buckets.rows.find((r) => r.start === "2026-10-01")!.revenueCentavos, 10_000);
  assert.equal(s.buckets.rows.find((r) => r.start === "2026-10-31")!.revenueCentavos, 5);
  assert.equal(s.buckets.rows.find((r) => r.start === "2026-10-31")!.jobs, 1);
  assert.equal(s.buckets.rows.find((r) => r.start === "2026-10-15")!.jobs, 0);
});

test("a job with two lines is one job, and its money splits by group and by queue per line", () => {
  const s = summarizeSales([
    row({ bookingId: "m", subtotalCentavos: 400 }),
    row({ bookingId: "m", groupCode: "TINT", queueCode: "TINT_PPF", queueName: "Tint + PPF", serviceId: "s2", name: "Regular Tint", subtotalCentavos: 1_000 }),
  ], october);
  assert.equal(s.finishedJobs, 1);
  assert.deepEqual(s.byGroup, [{ code: "TINT", revenueCentavos: 1_000 }, { code: "WASH", revenueCentavos: 400 }]);
  assert.deepEqual(s.byQueue, [{ code: "TINT_PPF", name: "Tint + PPF", revenueCentavos: 1_000 }, { code: "WASH", name: "Wash", revenueCentavos: 400 }]);
});

test("money with no known queue still counts, under Other, so the parts always add up", () => {
  const s = summarizeSales([row({ queueCode: null, queueName: null })], october);
  assert.deepEqual(s.byQueue, [{ code: "OTHER", name: "Other", revenueCentavos: 10_000 }]);
});

test("parts with no money are left out, and an unpriced line adds nothing", () => {
  const s = summarizeSales([row({ priceStatus: "FOR_QUOTE", subtotalCentavos: null }), row({ bookingId: "b", staffPriceCentavos: 0, groupCode: "PPF" })], october);
  assert.deepEqual(s.byGroup, []);
  assert.deepEqual(s.byQueue, []);
  assert.deepEqual(s.topServices, []);
});

test("top services are the five highest by revenue, ties by times sold then name, with the newest name of the service", () => {
  const rows = [
    row({ bookingId: "1", serviceId: "a", name: "Old Name", subtotalCentavos: 100 }),
    row({ bookingId: "2", serviceId: "a", name: "New Name", subtotalCentavos: 100 }),
    ...["b", "c", "d", "e", "f"].map((id, i) => row({ bookingId: `x${i}`, serviceId: id, name: `Svc ${id}`, subtotalCentavos: id === "f" ? 1 : 150 })),
    row({ bookingId: "y", serviceId: "c", name: "Svc c", priceStatus: "FOR_QUOTE", subtotalCentavos: null }),
  ];
  const s = summarizeSales(rows, october);
  assert.deepEqual(s.topServices.map((t) => [t.name, t.revenueCentavos, t.count]), [
    ["New Name", 200, 2], ["Svc c", 150, 2], ["Svc b", 150, 1], ["Svc d", 150, 1], ["Svc e", 150, 1],
  ]);
});

test("the hero, the buckets, the groups and the queues always add up to the same money", () => {
  const rows = [
    row({ bookingId: "a", finishedOn: "2026-10-02", subtotalCentavos: 123 }),
    row({ bookingId: "a", finishedOn: "2026-10-02", groupCode: "TINT", queueCode: "TINT_PPF", queueName: "Tint + PPF", serviceId: "t", staffPriceCentavos: 777 }),
    row({ bookingId: "b", finishedOn: "2026-10-20", groupCode: "GRAPHENE", queueCode: "DETAILING_COATING", queueName: "Detailing + Coating", serviceId: "g", subtotalCentavos: 5_001 }),
    row({ bookingId: "c", finishedOn: "2026-10-31", priceStatus: "FOR_QUOTE", subtotalCentavos: null }),
  ];
  const s = summarizeSales(rows, october);
  assert.equal(s.revenueCentavos, 5_901);
  assert.equal(sum(s.buckets.rows.map((r) => r.revenueCentavos)), 5_901);
  assert.equal(sum(s.byGroup.map((r) => r.revenueCentavos)), 5_901);
  assert.equal(sum(s.byQueue.map((r) => r.revenueCentavos)), 5_901);
  assert.equal(sum(s.buckets.rows.map((r) => r.jobs)), 3);
});

test("no finished job gives true zeros and empty lists, and the calendar is still there", () => {
  const s = summarizeSales([], october);
  assert.deepEqual([s.revenueCentavos, s.finishedJobs, s.fullyPricedJobs, s.unpriced.jobs], [0, 0, 0, 0]);
  assert.deepEqual([s.byGroup, s.byQueue, s.topServices, s.unpriced.references], [[], [], [], []]);
  assert.equal(s.buckets.rows.length, 31);
});

const supply = (extra: Partial<{ currentStock: number; costPerUnitCentavos: number; isActive: boolean }> = {}) => ({ currentStock: 2, costPerUnitCentavos: 500, isActive: true, ...extra });

test("stock value is what is on hand at each active supply's cost, and supplies with stock but no cost are counted", () => {
  assert.deepEqual(stockSummary([supply(), supply({ currentStock: 3, costPerUnitCentavos: 100 }), supply({ isActive: false }), supply({ costPerUnitCentavos: 0 }), supply({ currentStock: 0, costPerUnitCentavos: 0 })]), { valueCentavos: 1_300, noCostItems: 1 });
  assert.deepEqual(stockSummary([]), { valueCentavos: 0, noCostItems: 0 });
});

test("a stock value too large to show exactly is null, not a rounded figure and not a failed page", () => {
  assert.equal(stockSummary([supply({ currentStock: 1_000_000_000, costPerUnitCentavos: 100_000_000 })]).valueCentavos, null);
  assert.equal(stockSummary([supply({ currentStock: 1, costPerUnitCentavos: Number.MAX_SAFE_INTEGER })]).valueCentavos, Number.MAX_SAFE_INTEGER);
});

// P1-40 Sales Analytics screen: dates, labels and plain words, with no React and no network. No invented figure may reach the screen.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { AdminAnalyticsBucket } from "@/types/admin-contracts";
import {
  analyticsUrl, averageText, barText, bucketAxisLabel, bucketLabel, chartEmptyText, chartTitle, commissionsBeganNote, compactPesos, customProblem, deletedNote, groupLabel, manilaToday,
  niceTicks, olderNote, periodLabel, periodRange, stockNote, stockValueText, unpricedNotice, REVENUE_DEFINITION,
} from "./analytics-model";

const bucket = (start: string, end = start, extra: Partial<AdminAnalyticsBucket> = {}): AdminAnalyticsBucket => ({ start, end, future: false, revenueCentavos: 0, jobs: 0, ...extra });

test("today is the Manila day, whatever zone the device is in", () => {
  assert.equal(manilaToday(new Date("2026-10-31T15:59:59.999Z")), "2026-10-31");
  assert.equal(manilaToday(new Date("2026-10-31T16:00:00.000Z")), "2026-11-01");
});

test("the period buttons give whole calendar periods in Manila", () => {
  assert.deepEqual(periodRange("THIS_MONTH", "2026-11-07"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(periodRange("LAST_MONTH", "2026-11-07"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(periodRange("LAST_MONTH", "2027-01-15"), { from: "2026-12-01", to: "2026-12-31" }, "across a new year");
  assert.deepEqual(periodRange("THIS_MONTH", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" }, "a leap February");
  assert.deepEqual(periodRange("LAST_MONTH", "2028-03-31"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(periodRange("THIS_YEAR", "2028-02-10"), { from: "2028-01-01", to: "2028-12-31" });
});

test("a custom period is refused in plain words, the same limits as the server", () => {
  assert.equal(customProblem("", "2026-11-01"), "Choose a start day and an end day.");
  assert.equal(customProblem("2026-11-02", "2026-11-01"), "The end day can't be before the start day.");
  assert.equal(customProblem("2026-01-01", "2027-01-02"), "Choose a range of one year or less.");
  assert.equal(customProblem("2026-01-01", "2027-01-01"), null, "365 days apart is allowed");
  assert.equal(customProblem("2026-11-01", "2026-11-01"), null);
});

test("the request carries the two days and nothing else", () => {
  assert.equal(analyticsUrl({ from: "2026-10-01", to: "2026-10-31" }), "/api/admin/analytics?from=2026-10-01&to=2026-10-31");
});

test("periods and buckets read as plain dates", () => {
  assert.equal(periodLabel("2026-10-01", "2026-10-31"), "Oct 1 to Oct 31, 2026");
  assert.equal(periodLabel("2026-12-28", "2027-01-03"), "Dec 28, 2026 to Jan 3, 2027");
  assert.equal(periodLabel("2026-10-05", "2026-10-05"), "Oct 5, 2026");
  assert.equal(bucketLabel(bucket("2026-11-07"), "DAY"), "Nov 7");
  assert.equal(bucketLabel(bucket("2026-11-02", "2026-11-08"), "WEEK"), "Nov 2 to Nov 8");
  assert.equal(bucketLabel(bucket("2026-12-28", "2027-01-03"), "WEEK"), "Dec 28 to Jan 3");
  assert.equal(bucketLabel(bucket("2028-02-01", "2028-02-29"), "MONTH"), "Feb 2028");
  assert.equal(bucketLabel(bucket("2028-01-15", "2028-01-31"), "MONTH"), "Jan 15 to Jan 31", "a part month says so");
  assert.equal(bucketAxisLabel(bucket("2026-11-07"), "DAY"), "7");
  assert.equal(bucketAxisLabel(bucket("2026-11-02", "2026-11-08"), "WEEK"), "Nov 2");
  assert.equal(bucketAxisLabel(bucket("2028-02-01", "2028-02-29"), "MONTH"), "Feb");
  assert.deepEqual((["DAY", "WEEK", "MONTH"] as const).map(chartTitle), ["Revenue by day", "Revenue by week", "Revenue by month"]);
});

test("a bar says what it holds: not yet, no finished job, or the money and the jobs", () => {
  assert.equal(barText(bucket("2026-11-30", "2026-11-30", { future: true })), "Not yet");
  assert.equal(barText(bucket("2026-11-01")), "No finished job");
  assert.equal(barText(bucket("2026-11-01", "2026-11-01", { revenueCentavos: 123_456, jobs: 1 })), "₱1,234.56 from 1 job");
  assert.equal(barText(bucket("2026-11-01", "2026-11-01", { revenueCentavos: 200, jobs: 3 })), "₱2.00 from 3 jobs");
  assert.equal(barText(bucket("2026-11-01", "2026-11-01", { jobs: 2 })), "₱0.00 from 2 jobs", "finished but with no price");
});

test("an empty chart says why", () => {
  assert.equal(chartEmptyText(0), "No finished jobs in this period.");
  assert.equal(chartEmptyText(2), "The finished jobs in this period have no final price.");
});

test("axis ticks are clean, start at zero, reach the top value, and are few", () => {
  assert.deepEqual(niceTicks(0), [0]);
  assert.deepEqual(niceTicks(5_210_000), [0, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_000_000]);
  assert.deepEqual(niceTicks(100), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(1), [0, 1]);
  for (const max of [1, 7, 99, 101, 2_500, 123_456, 9_999_999, 4_000_000_000_000]) {
    const ticks = niceTicks(max);
    assert.ok(ticks.at(-1)! >= max, `${max} reaches the top`);
    assert.ok(ticks.length <= 7, `${max} has few ticks: ${ticks.length}`);
  }
});

test("axis money is short: in full under 10,000 pesos, then K and M", () => {
  assert.deepEqual([0, 50_000, 999_900, 1_000_000, 1_500_000, 150_000_000, 250_000_000].map(compactPesos), ["₱0", "₱500", "₱9,999", "₱10K", "₱15K", "₱1.5M", "₱2.5M"]);
});

test("service groups have plain names", () => {
  assert.deepEqual(["WASH", "DETAILING", "GRAPHENE", "TINT", "PPF", "REPAINT"].map(groupLabel), ["Wash", "Detailing", "Graphene", "Tint", "PPF", "Repaint"]);
});

test("no average is a dash, never zero; a stock value too large to show says so", () => {
  assert.equal(averageText(null), "–");
  assert.equal(averageText(982_097), "₱9,820.97");
  assert.equal(stockValueText(null), "Too large to show");
  assert.equal(stockValueText(0), "₱0.00");
});

test("the notices speak plainly, singular and plural, and stay silent at zero", () => {
  assert.equal(unpricedNotice(0), null);
  assert.equal(unpricedNotice(1), "1 finished job has a service with no final price, so revenue is short by that service.");
  assert.equal(unpricedNotice(2), "2 finished jobs have a service with no final price, so revenue is short by those services.");
  assert.equal(deletedNote(0), null);
  assert.equal(deletedNote(1), "1 finished booking dated in this period was deleted and is not counted.");
  assert.equal(deletedNote(3), "3 finished bookings dated in this period were deleted and are not counted.");
  assert.equal(olderNote(0), null);
  assert.equal(olderNote(2), "2 finished bookings from the older booking system are not counted.");
  assert.equal(stockNote(0), "Stock on hand at each supply's cost.");
  assert.equal(stockNote(1), "Stock on hand at each supply's cost. 1 supply has no cost and is left out.");
  assert.equal(stockNote(3), "Stock on hand at each supply's cost. 3 supplies have no cost and are left out.");
  assert.match(REVENUE_DEFINITION, /not cash/);
});

test("the commission start only shows for a period that begins before it, on the Manila day", () => {
  assert.equal(commissionsBeganNote("2026-11-04T16:30:00.000Z", "2026-11-01"), "Commissions began on Nov 5, 2026, so earlier jobs have none.");
  assert.equal(commissionsBeganNote("2026-11-04T16:30:00.000Z", "2026-11-05"), null);
});

test("no invented figure or code label is left on the screen", () => {
  const tab = fs.readFileSync(path.join(process.cwd(), "src/components/admin/analytics-tab.tsx"), "utf8");
  assert.doesNotMatch(tab, /₱\s*\d|\d+(\.\d+)?%|config\/catalog|chartBars|popularCounts/);
  assert.doesNotMatch(tab, /P1-\d/);
});

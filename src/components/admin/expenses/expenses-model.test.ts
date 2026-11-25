import assert from "node:assert/strict";
import { test } from "node:test";
import { commissionsLine, formatTotal, historyLine, matchesExpenseSearch, monthLabel, owedNote, shortMonth, stockLine, unpricedNote } from "./expenses-model";

test("a total stays exact past a safe integer, and handles a negative month from a paid correction", () => {
  assert.equal(formatTotal("100000000000000000"), "₱1,000,000,000,000,000.00");
  assert.equal(formatTotal("100000000000000001"), "₱1,000,000,000,000,000.01");
  assert.equal(formatTotal("0"), "₱0.00");
  assert.equal(formatTotal("5"), "₱0.05");
  assert.equal(formatTotal("-2500"), "-₱25.00");
});

test("months read in plain words", () => {
  assert.equal(monthLabel("2026-11"), "November 2026");
  assert.equal(monthLabel("2027-01"), "January 2027");
  assert.equal(shortMonth("2026-12"), "Dec");
});

test("the derived lines and the notes say what they count; a note with nothing to say is absent", () => {
  assert.equal(stockLine({ totals: { stockBought: "30150" } as never, pricedStockIns: 1 }), "Stock bought (from Supplies): ₱301.50 from 1 stock-in");
  assert.equal(stockLine({ totals: { stockBought: "0" } as never, pricedStockIns: 0 }), "Stock bought (from Supplies): ₱0.00 from 0 stock-ins");
  assert.equal(commissionsLine({ totals: { commissionsPaid: "100000" } as never }), "Commissions paid: ₱1,000.00");
  assert.equal(unpricedNote(0), null);
  assert.equal(unpricedNote(1), "1 stock-in had no price and is not counted.");
  assert.equal(unpricedNote(3), "3 stock-ins had no price and are not counted.");
  assert.equal(owedNote("0"), null);
  assert.match(owedNote("20000")!, /not in this total: ₱200\.00/);
});

test("search looks at the payee and the note, ignoring case; an empty search matches everything", () => {
  const e = { payee: "Meralco", note: "November bill" };
  for (const q of ["", "  ", "meralco", " NOVEMBER "]) assert.equal(matchesExpenseSearch(e, q), true, q);
  assert.equal(matchesExpenseSearch(e, "rent"), false);
  assert.equal(matchesExpenseSearch({ payee: null, note: null }, "x"), false);
});

test("a history row shows the values as they were then, and the reason only when there is one", () => {
  const base = { kind: "EDITED" as const, amountCentavos: 15_000, categoryName: "Rent", expenseDate: "2026-11-01", payee: null, note: null, reason: null };
  assert.equal(historyLine(base), "Changed · ₱150.00 · Rent · 2026-11-01");
  assert.equal(historyLine({ ...base, kind: "VOIDED", payee: "Landlord", reason: "typed twice" }), "Removed · ₱150.00 · Rent · 2026-11-01 · Landlord · Reason: typed twice");
});

test("expense analytics: bar text and the share of each kind", async () => {
  const { expenseBarText, kindShares } = await import("./expenses-model");
  assert.equal(expenseBarText({ future: true, revenueCentavos: 0 }), "Not yet");
  assert.equal(expenseBarText({ future: false, revenueCentavos: 0 }), "No spending");
  assert.equal(expenseBarText({ future: false, revenueCentavos: 150000 }), "₱1,500.00");
  const shares = kindShares({ total: "1000", manual: "500", stockBought: "250", commissionsPaid: "250", commissionsOwed: "0" });
  assert.deepEqual(shares.map((x) => x.pct), [50, 25, 25]);
  assert.deepEqual(kindShares({ total: "0", manual: "0", stockBought: "0", commissionsPaid: "0", commissionsOwed: "0" }).map((x) => x.pct), [0, 0, 0]);
});

test("expense analytics keeps table amounts exact and uses a table for signed or oversized chart values", async () => {
  const { expenseBucketText, expenseChartRows } = await import("./expenses-model");
  const bucket = (total: string, future = false) => ({ start: "2026-11-01", end: "2026-11-01", total, future, manual: total, stockBought: "0", commissionsPaid: "0" });
  assert.equal(expenseBucketText(bucket("9007199254740993")), "₱90,071,992,547,409.93");
  assert.equal(expenseBucketText(bucket("-2500")), "-₱25.00");
  assert.equal(expenseBucketText(bucket("0")), "No spending");
  assert.equal(expenseBucketText(bucket("0", true)), "Not yet");
  assert.equal(expenseChartRows([bucket("-2500")]), null);
  assert.equal(expenseChartRows([bucket("9007199254740993")]), null);
  assert.deepEqual(expenseChartRows([bucket("12345")]), [{ start: "2026-11-01", end: "2026-11-01", future: false, revenueCentavos: 12345, jobs: 0 }]);
});

test("expense analytics does not claim percentage shares for signed corrections", async () => {
  const { kindShares } = await import("./expenses-model");
  for (const totals of [
    { total: "7500", manual: "10000", stockBought: "0", commissionsPaid: "-2500", commissionsOwed: "0" },
    { total: "-2500", manual: "0", stockBought: "0", commissionsPaid: "-2500", commissionsOwed: "0" },
  ]) assert.deepEqual(kindShares(totals).map((s) => s.pct), [null, null, null]);
});

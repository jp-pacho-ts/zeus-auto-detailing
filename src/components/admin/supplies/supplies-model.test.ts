// P1-38 Supplies screen: the plain-language rules, with no React and no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminSupplyItem, AdminSupplyMovement } from "@/types/admin-contracts";
import { badgeLabel, costLabel, matchesSearch, movementLine, removeResult, removeWarning, stockPreview, summaryLine, SUPPLIES_EMPTY, SUPPLIES_NO_MATCH } from "./supplies-model";

const item = (extra: Partial<AdminSupplyItem> = {}): AdminSupplyItem => ({
  id: "i1", name: "Iron X Spray", category: "Wash", unit: "bottle", currentStock: 5, reorderLevel: 2, costPerUnitCentavos: 12_550, isActive: true, revision: 1, status: "OK",
  hasHistory: true, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z", ...extra,
});

test("search matches the name or the category, ignoring case and spaces, and an empty search matches everything", () => {
  assert.deepEqual(["iron", "  IRON x ", "wash", "WASH", "", "   "].map((q) => matchesSearch(item(), q)), [true, true, true, true, true, true]);
  assert.deepEqual(["wax", "bottles"].map((q) => matchesSearch(item(), q)), [false, false]);
  assert.equal(matchesSearch(item({ category: null }), "wash"), false);
});

test("badges: none when the reorder level is 0, OK, Low and Out otherwise", () => {
  assert.deepEqual((["NONE", "OK", "LOW", "OUT"] as const).map(badgeLabel), [null, "OK", "Low", "Out"]);
});

test("the strip and the cost read in plain words", () => {
  assert.equal(summaryLine(0, 0), "No supplies yet.");
  assert.equal(summaryLine(1, 0), "1 supply · none low");
  assert.equal(summaryLine(12, 1), "12 supplies · 1 low or out");
  assert.equal(summaryLine(12, 3), "12 supplies · 3 low or out");
  assert.equal(costLabel(12_550), "₱125.50 each");
  assert.equal(costLabel(0), "₱0.00 each");
  assert.match(SUPPLIES_EMPTY, /Add your first supply/);
  assert.match(SUPPLIES_NO_MATCH, /No supplies match/);
});

test("the delete dialog says whether the item is erased or hidden, and the result says what happened", () => {
  assert.match(removeWarning(item({ hasHistory: false })), /was never used, so it will be deleted for good/);
  assert.match(removeWarning(item({ hasHistory: true })), /has a history, so it will be hidden .* bring it back/);
  assert.equal(removeResult("DELETED", "Iron X Spray"), "Iron X Spray was deleted.");
  assert.equal(removeResult("ARCHIVED", "Iron X Spray"), "Iron X Spray has a history, so it was hidden instead. Turn on Show archived to bring it back.");
});

test("the stock preview shows what is left, and refuses going below zero or above the largest stock", () => {
  assert.deepEqual(stockPreview(item({ currentStock: 5 }), "USE", 2), { after: 3, problem: null });
  assert.deepEqual(stockPreview(item({ currentStock: 5 }), "RECEIVE", 10), { after: 15, problem: null });
  assert.deepEqual(stockPreview(item({ currentStock: 5 }), "USE", 5), { after: 0, problem: null });
  assert.equal(stockPreview(item({ currentStock: 5 }), "USE", 6).problem, "Not enough stock. Only 5 left.");
  assert.equal(stockPreview(item({ currentStock: 999_999_999 }), "RECEIVE", 2).problem, "That is more than the largest stock we can hold.");
  assert.equal(stockPreview(item(), "USE", 0).problem, "Enter a whole number of 1 or more.");
  assert.equal(stockPreview(item(), "USE", Number.NaN).problem, "Enter a whole number of 1 or more.");
});

test("a history line says what happened, how much, at what price, why and by whom", () => {
  const m = (extra: Partial<AdminSupplyMovement>): AdminSupplyMovement => ({ id: "m", kind: "RECEIVE", delta: 20, stockAfter: 26, unitCostCentavos: null, note: null, actorName: "Shop Admin", createdAt: "2027-01-02T03:04:05.000Z", ...extra });
  assert.equal(movementLine(m({ kind: "OPENING", delta: 12, stockAfter: 12 })), "Starting stock +12 → 12");
  assert.equal(movementLine(m({})), "Stock in +20 → 26");
  assert.equal(movementLine(m({ unitCostCentavos: 6_250, note: "Delivery" })), "Stock in +20 → 26 · ₱62.50 each · Delivery");
  assert.equal(movementLine(m({ kind: "USE", delta: -4, stockAfter: 22, note: "Job 12" })), "Used -4 → 22 · Job 12");
});

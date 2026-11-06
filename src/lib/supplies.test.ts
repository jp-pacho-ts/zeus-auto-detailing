// P1-38: the supply rules that need no database: peso parsing, the low-stock badge, and the request schemas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SupplyCreateSchema, SupplyStockSchema, SupplyUpdateSchema } from "./admin-validation";
import { MAX_STOCK, pesosToCentavos, stockStatus } from "./supplies";

test("pesos typed by a person become whole centavos exactly, and anything else is refused", () => {
  assert.deepEqual(["125.50", "0", "0.05", "7", " 7 ", "12.3", "1000000", "1000000.00"].map(pesosToCentavos), [12_550, 0, 5, 700, 700, 1_230, 100_000_000, 100_000_000]);
  for (const bad of ["", "-1", "-0", "12.345", "1e2", "1,5", "+5", ".5", "5.", "abc", "00", "007", "1000000.01", "1000001", " "]) assert.equal(pesosToCentavos(bad), null, bad);
});

test("the badge: reorder level 0 means no badge at all, even at stock 0 (S6)", () => {
  assert.equal(stockStatus(0, 0), "NONE");
  assert.equal(stockStatus(5, 0), "NONE");
});

test("the badge boundaries for a reorder level of 5: OK above, LOW at and under, OUT only at 0", () => {
  assert.deepEqual([6, 5, 1, 0].map((stock) => stockStatus(stock, 5)), ["OK", "LOW", "LOW", "OUT"]);
});

test("the largest stock is one billion", () => assert.equal(MAX_STOCK, 1_000_000_000));

const id = "0b9a7f4e-6c9f-4a79-9d5a-1d2f6f3a8c11";
test("the create schema is strict, trims, bounds every number and requires the browser-made id", () => {
  const ok = { id, name: "  Iron X  ", unit: "bottle", reorderLevel: 3, costPesos: "125.50" };
  const parsed = SupplyCreateSchema.parse(ok);
  assert.deepEqual([parsed.name, parsed.costCentavos, parsed.startingStock], ["Iron X", 12_550, undefined]);
  assert.equal(SupplyCreateSchema.parse({ ...ok, category: "Wash", startingStock: 10 }).startingStock, 10);
  for (const bad of [{ ...ok, id: "nope" }, { ...ok, id: undefined }, { ...ok, name: "   " }, { ...ok, name: "x".repeat(81) }, { ...ok, unit: "" }, { ...ok, unit: "x".repeat(21) },
    { ...ok, reorderLevel: -1 }, { ...ok, reorderLevel: 1.5 }, { ...ok, reorderLevel: MAX_STOCK + 1 }, { ...ok, costPesos: "12.345" }, { ...ok, costPesos: "-1" },
    { ...ok, startingStock: -1 }, { ...ok, startingStock: MAX_STOCK + 1 }, { ...ok, extra: 1 }, { ...ok, category: "" }])
    assert.equal(SupplyCreateSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
});

test("the update schema leaves absent fields alone, null clears the category, and refuses an empty change", () => {
  assert.equal(SupplyUpdateSchema.parse({ expectedRevision: 1, category: null }).category, null);
  assert.equal(SupplyUpdateSchema.parse({ expectedRevision: 1, costPesos: "3" }).costCentavos, 300);
  for (const bad of [{ expectedRevision: 1 }, { expectedRevision: 0, name: "x" }, { name: "x" }, { expectedRevision: 1, name: "" }, { expectedRevision: 1, kind: "USE" }])
    assert.equal(SupplyUpdateSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("the stock schema allows only RECEIVE and USE (there is no ADJUST), whole positive quantities, a cost on RECEIVE only", () => {
  const ok = { id, expectedRevision: 2, kind: "USE", quantity: 3 };
  assert.equal(SupplyStockSchema.parse(ok).kind, "USE");
  assert.equal(SupplyStockSchema.parse({ ...ok, kind: "RECEIVE", unitCostPesos: "9.99" }).unitCostCentavos, 999);
  assert.equal(SupplyStockSchema.parse({ ...ok, note: "  Job 12  " }).note, "Job 12");
  for (const bad of [{ ...ok, kind: "ADJUST" }, { ...ok, kind: "OPENING" }, { ...ok, quantity: 0 }, { ...ok, quantity: -1 }, { ...ok, quantity: 1.5 }, { ...ok, quantity: MAX_STOCK + 1 },
    { ...ok, unitCostPesos: "9.99" }, { ...ok, id: "x" }, { ...ok, expectedRevision: 0 }, { ...ok, note: "x".repeat(201) }, { ...ok, note: "  " }, { ...ok, extra: true }])
    assert.equal(SupplyStockSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 70));
});

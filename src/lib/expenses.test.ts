import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths, centavosToPesosText, expensePesosToCentavos, isReservedCategoryName, lastTwelveMonths, MAX_EXPENSE_CENTAVOS, monthRange } from "./expenses";
import { ExpenseCreateSchema, ExpenseMonthSchema, ExpenseTotalsSchema, ExpenseUpdateSchema, ExpenseCategoryUpdateSchema } from "./admin-validation";

const ID = "11111111-1111-4111-8111-111111111111";

test("pesos become whole centavos; signs, exponents, commas, zero and more than two decimals are refused", () => {
  assert.equal(expensePesosToCentavos("1250.5"), 125_050);
  assert.equal(expensePesosToCentavos(" 0.01 "), 1);
  assert.equal(expensePesosToCentavos("100000000.00"), MAX_EXPENSE_CENTAVOS);
  // 19.99 * 100 is 1998.9999... in floats: the conversion must not go through a float.
  assert.equal(expensePesosToCentavos("19.99"), 1999);
  for (const bad of ["", "0", "0.00", "-1", "+1", "1e3", "1,250.00", "1.234", "100000000.01", "1000000000", "abc", "01"]) assert.equal(expensePesosToCentavos(bad), null, bad);
});

test("centavos go back to the text the edit form holds", () => {
  assert.equal(centavosToPesosText(125_050), "1250.50");
  assert.equal(centavosToPesosText(5), "0.05");
  assert.equal(expensePesosToCentavos(centavosToPesosText(MAX_EXPENSE_CENTAVOS)), MAX_EXPENSE_CENTAVOS);
});

test("reserved category names are the two derived lines, in any case and with spaces at the ends", () => {
  for (const name of ["Stock bought", "  stock BOUGHT ", "commissions paid"]) assert.equal(isReservedCategoryName(name), true, name);
  for (const name of ["Stock", "Commissions", "Rent"]) assert.equal(isReservedCategoryName(name), false, name);
});

test("month boundaries are calendar months, including February in a leap year and December", () => {
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(monthRange("2027-02"), { from: "2027-02-01", to: "2027-02-28" });
  assert.deepEqual(monthRange("2026-12"), { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2027-01", -1), "2026-12");
  const twelve = lastTwelveMonths("2026-11");
  assert.equal(twelve.length, 12);
  assert.deepEqual([twelve[0], twelve[11]], ["2025-12", "2026-11"]);
});

test("the create form needs date, category and amount; payee and note are optional and trimmed", () => {
  const ok = ExpenseCreateSchema.parse({ id: ID, date: "2026-11-07", categoryId: ID, amountPesos: "19.99", payee: "  Meralco ", note: " Nov bill " });
  assert.deepEqual([ok.amountCentavos, ok.payee, ok.note], [1999, "Meralco", "Nov bill"]);
  for (const missing of ["date", "categoryId", "amountPesos"]) {
    const body: Record<string, unknown> = { id: ID, date: "2026-11-07", categoryId: ID, amountPesos: "1" };
    delete body[missing];
    assert.equal(ExpenseCreateSchema.safeParse(body).success, false, missing);
  }
  assert.equal(ExpenseCreateSchema.safeParse({ id: ID, date: "2026-11-07", categoryId: ID, amountPesos: "0" }).success, false, "zero");
  assert.equal(ExpenseCreateSchema.safeParse({ id: ID, date: "2026-11-07", categoryId: ID, amountPesos: "1", payee: "x".repeat(81) }).success, false, "long payee");
  assert.equal(ExpenseCreateSchema.safeParse({ id: ID, date: "2026-11-07", categoryId: ID, amountPesos: "1", note: "x".repeat(201) }).success, false, "long note");
  assert.equal(ExpenseCreateSchema.safeParse({ id: ID, date: "2026-11-07", categoryId: ID, amountPesos: "1", extra: 1 }).success, false, "unknown key");
});

test("an edit sets every value and carries the revision; a month read takes one well-formed month; totals need from on or before to", () => {
  assert.equal(ExpenseUpdateSchema.safeParse({ expectedRevision: 1, date: "2026-11-07", categoryId: ID, amountPesos: "1" }).success, true);
  assert.equal(ExpenseUpdateSchema.safeParse({ date: "2026-11-07", categoryId: ID, amountPesos: "1" }).success, false, "no revision");
  assert.deepEqual(ExpenseMonthSchema.parse({ month: "2026-11" }).includeRemoved, false);
  assert.deepEqual(ExpenseMonthSchema.parse({ month: "2026-11", includeRemoved: "true" }).includeRemoved, true);
  for (const month of ["2026-13", "2026-00", "2026-1", "26-11", "0050-01", "1999-12"]) assert.equal(ExpenseMonthSchema.safeParse({ month }).success, false, month);
  assert.equal(ExpenseMonthSchema.safeParse({ month: "2026-11", cursor: "2026-11-07_12" }).success, true);
  for (const cursor of ["2026-13-45_1", "2026-02-30_1", "2026-11-07", "2026-11-07_x"]) assert.equal(ExpenseMonthSchema.safeParse({ month: "2026-11", cursor }).success, false, cursor);
  assert.equal(ExpenseTotalsSchema.safeParse({ from: "2026-11-01", to: "2026-11-30" }).success, true);
  assert.equal(ExpenseTotalsSchema.safeParse({ from: "2026-11-30", to: "2026-11-01" }).success, false, "backwards");
});

test("a category change names something to change, and a reserved name is refused before it reaches the database", () => {
  assert.equal(ExpenseCategoryUpdateSchema.safeParse({ expectedRevision: 1 }).success, false);
  assert.equal(ExpenseCategoryUpdateSchema.safeParse({ expectedRevision: 1, isActive: false }).success, true);
  assert.equal(ExpenseCategoryUpdateSchema.safeParse({ expectedRevision: 1, name: " stock bought " }).success, false);
});

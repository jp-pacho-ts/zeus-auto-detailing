import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceCreateSchema, ServiceUpdateSchema } from "./admin-validation";

test("service expense defaults accept integer centavos including disabled zero", () => {
  for (const schema of [ServiceCreateSchema, ServiceUpdateSchema]) {
    for (const expenseDeductionCentavos of [0, 150_000, 250_050]) {
      const parsed = schema.parse({ name: "Synthetic detail", category: "DETAILING", offers: [], expenseDeductionCentavos });
      assert.equal((parsed as { expenseDeductionCentavos?: number }).expenseDeductionCentavos, expenseDeductionCentavos);
    }
    for (const expenseDeductionCentavos of [-1, 1.5, "1500", null, 100_000_001])
      assert.equal(schema.safeParse({ name: "Synthetic detail", category: "DETAILING", offers: [], expenseDeductionCentavos }).success, false);
    assert.equal(schema.safeParse({ name: "Synthetic detail", category: "DETAILING", offers: [] }).success, true, "older clients leave the default unchanged");
  }
});

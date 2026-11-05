// P1-32: the customer's name on a booking request: First and Last, or an old single name from a stale tab.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CustomerNameSchema } from "./validation";

const ok = (v: unknown) => { const r = CustomerNameSchema.safeParse(v); assert.ok(r.success, JSON.stringify(r.success ? "" : r.error.issues)); return r.data; };
const bad = (v: unknown) => { const r = CustomerNameSchema.safeParse(v); assert.equal(r.success, false, JSON.stringify(v)); return r.success ? [] : r.error.issues.map((i) => i.path.join(".")); };

test("P1-32: first and last name are stored apart and the display name is First Last", () => {
  assert.deepEqual(ok({ customerFirstName: "  Ana ", customerLastName: " dela  Cruz " }), { customerFirstName: "Ana", customerLastName: "dela  Cruz", customerName: "Ana dela Cruz" });
  assert.equal(ok({ customerFirstName: "A", customerLastName: "Li" }).customerName, "A Li");
});

test("P1-32: an old single-name request still validates and stores no first or last name", () => {
  assert.deepEqual(ok({ customerName: "Juan Dela Cruz" }), { customerName: "Juan Dela Cruz" });
  assert.deepEqual(bad({ customerName: "J" }), ["customerName"]);
});

test("P1-32: a missing, half-given, oversized or control-character name is refused on the right field", () => {
  assert.deepEqual(bad({}), ["customerFirstName"]);
  assert.deepEqual(bad({ customerFirstName: "Ana" }), ["customerLastName"]);
  assert.deepEqual(bad({ customerLastName: "Cruz" }), ["customerFirstName"]);
  assert.ok(bad({ customerFirstName: "x".repeat(51), customerLastName: "Cruz" }).includes("customerFirstName"));
  assert.ok(bad({ customerFirstName: "Ana", customerLastName: "x".repeat(51) }).includes("customerLastName"));
  assert.ok(bad({ customerFirstName: "An\na", customerLastName: "Cruz" }).includes("customerFirstName"));
  assert.ok(bad({ customerFirstName: "   ", customerLastName: "Cruz" }).includes("customerFirstName"));
  assert.ok(bad({ customerFirstName: "Ana", customerLastName: "Cruz", extra: 1 }).length > 0, "strict");
});

test("P1-32: first and last win over a single name sent with them", () => {
  assert.equal(ok({ customerName: "Someone Else", customerFirstName: "Ana", customerLastName: "Cruz" }).customerName, "Ana Cruz");
});

// Codex F2: the old single-name path keeps the bytes the release-1 parser produced (it only trimmed).
test("P1-32: an old single name keeps its inner spacing exactly; only first and last are normalized", () => {
  assert.deepEqual(ok({ customerName: "Ana  Santos" }), { customerName: "Ana  Santos" });
  assert.deepEqual(ok({ customerName: "  Juan   De  La Cruz  " }), { customerName: "Juan   De  La Cruz" });
  assert.equal(ok({ customerFirstName: "Ana", customerLastName: "De   La Cruz" }).customerName, "Ana De La Cruz", "a new-style name is still composed and normalized");
});

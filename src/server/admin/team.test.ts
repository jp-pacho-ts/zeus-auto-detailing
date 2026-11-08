// P1-37: the Team and Commissions contracts that need no database: the role table (ADMIN only, nothing for STAFF) and the
// strict Zod schemas. The database functions repeat every rule; see team.integration.test.ts and commissions.integration.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CommissionDefaultSchema, CommissionListSchema, CommissionPaidSchema, TeamCreateSchema, TeamRemoveSchema, TeamUpdateSchema } from "@/lib/admin-validation";
import { canPerform } from "./roles";

const ID = "0b8b3b3e-2b1a-4e5c-9f00-000000000001";
const ok = (schema: { safeParse(x: unknown): { success: boolean } }, input: unknown) => assert.equal(schema.safeParse(input).success, true, JSON.stringify(input));
const bad = (schema: { safeParse(x: unknown): { success: boolean } }, input: unknown) => assert.equal(schema.safeParse(input).success, false, JSON.stringify(input));

test("the four new operations are ADMIN only: STAFF can do none of them, every ADMIN operation still follows its table", () => {
  for (const op of ["TEAM_READ", "TEAM_WRITE", "COMMISSION_READ", "COMMISSION_WRITE"] as const) {
    assert.equal(canPerform(op, "ADMIN"), true, `ADMIN ${op}`);
    assert.equal(canPerform(op, "STAFF"), false, `STAFF ${op}`);
  }
  // Existing rules did not move: STAFF still reads and completes; deleting is still ADMIN only.
  assert.deepEqual([canPerform("READ", "STAFF"), canPerform("STATUS_COMPLETED", "STAFF"), canPerform("DELETE_BOOKING", "STAFF")], [true, true, false]);
});

test("TeamCreateSchema: a name is required, optional fields are checked, and nothing else is accepted", () => {
  ok(TeamCreateSchema, { name: "Maria Santos" });
  ok(TeamCreateSchema, { name: "Maria", phone: "+63 917 555 0101", email: "maria@example.test", ratePercent: "12.5" });
  ok(TeamCreateSchema, { name: "Maria", email: "", ratePercent: null });
  // P1-64: a browser-made uuid makes a retried Add harmless, so an id is now accepted; anything but a uuid is still refused below.
  ok(TeamCreateSchema, { name: "Maria", id: ID });
  for (const input of [{}, { name: "" }, { name: "  " }, { name: "x".repeat(81) }, { name: "a\u0000b" }, { name: "M", phone: "call me" }, { name: "M", phone: "1".repeat(31) },
    { name: "M", email: "nope" }, { name: "M", ratePercent: "100.5" }, { name: "M", ratePercent: "" }, { name: "M", ratePercent: 10 },
    { name: "M", role: "ADMIN" }, { name: "M", id: "not-a-uuid" }, { name: "M", isActive: true }, { name: "M", commissionRateBp: 1000 }, { name: "M", revision: 3 }])
    bad(TeamCreateSchema, input);
  assert.equal(TeamCreateSchema.parse({ name: "  Trim Me  ", email: " UP@Example.TEST " }).email, "up@example.test");
});

test("TeamUpdateSchema: the revision is required, an absent field means leave alone, null clears only the percentage", () => {
  ok(TeamUpdateSchema, { expectedRevision: 1 });
  ok(TeamUpdateSchema, { expectedRevision: 2, name: "New", phone: "0917", email: "a@b.co", ratePercent: null });
  for (const input of [{}, { name: "No revision" }, { expectedRevision: 0 }, { expectedRevision: 1.5 }, { expectedRevision: "1" }, { expectedRevision: 1, name: null }, { expectedRevision: 1, phone: null }, { expectedRevision: 1, email: null },
    { expectedRevision: 1, role: "ADMIN" }, { expectedRevision: 1, isActive: false }, { expectedRevision: 1, ratePercent: "abc" }])
    bad(TeamUpdateSchema, input);
  assert.equal("ratePercent" in TeamUpdateSchema.parse({ expectedRevision: 1, name: "X" }), false, "an absent percentage stays absent");
  assert.equal(TeamUpdateSchema.parse({ expectedRevision: 1, ratePercent: null }).ratePercent, null);
});

test("TeamRemoveSchema, CommissionDefaultSchema, CommissionPaidSchema are strict", () => {
  ok(TeamRemoveSchema, { expectedRevision: 1 });
  for (const input of [{}, { expectedRevision: 0 }, { expectedRevision: "one" }, { expectedRevision: 1, extra: 2 }]) bad(TeamRemoveSchema, input);
  ok(TeamRemoveSchema, { expectedRevision: 3 });
  for (const input of [{}, { expectedRevision: 3, force: true }]) bad(TeamRemoveSchema, input);
  ok(CommissionDefaultSchema, { expectedRevision: 1, ratePercent: "10" });
  for (const input of [{ ratePercent: "10" }, { expectedRevision: 1 }, { expectedRevision: 1, ratePercent: "10.123" }, { expectedRevision: 1, ratePercent: null }, { expectedRevision: 1, ratePercent: "10", startsAt: "2020-01-01" }]) bad(CommissionDefaultSchema, input);
  ok(CommissionPaidSchema, { ids: [ID], paid: true });
  for (const input of [{ ids: [], paid: true }, { ids: ["x"], paid: true }, { ids: [ID] }, { ids: [ID], paid: 1 }, { ids: Array.from({ length: 201 }, () => ID), paid: true }, { ids: [ID], paid: true, amountCentavos: 1 }]) bad(CommissionPaidSchema, input);
  assert.equal(CommissionPaidSchema.parse({ ids: [ID.toUpperCase()], paid: false }).ids[0], ID, "ids are lowercased");
});

test("CommissionListSchema: a Manila day range of at most a year, an optional person and status, nothing else", () => {
  ok(CommissionListSchema, { from: "2027-03-01", to: "2027-03-01" });
  ok(CommissionListSchema, { from: "2026-03-01", to: "2027-03-01", staffId: ID, status: "UNPAID" });
  assert.equal(CommissionListSchema.parse({ from: "2027-03-01", to: "2027-03-02" }).status, "ALL");
  for (const input of [{}, { from: "2027-03-01" }, { from: "2027-03-02", to: "2027-03-01" }, { from: "2026-01-01", to: "2027-01-02" }, { from: "2027-02-30", to: "2027-03-01" },
    { from: "2027-03-01", to: "2027-03-02", status: "MAYBE" }, { from: "2027-03-01", to: "2027-03-02", staffId: "x" }, { from: "2027-03-01", to: "2027-03-02", limit: 5 }])
    bad(CommissionListSchema, input);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { canManage, defaultRateLine, manilaToday, monthStart, pesoRange, rangeProblem, ratePhrase, removeResult, removeWarning, selectableIds, warningLines } from "./team-model";

test("today is the Manila day, even when UTC is still the day before", () => {
  assert.equal(manilaToday(new Date("2027-03-01T17:30:00Z")), "2027-03-02");
  assert.equal(manilaToday(new Date("2027-03-01T15:59:00Z")), "2027-03-01");
  assert.equal(monthStart("2027-03-17"), "2027-03-01");
});

test("a range is accepted from one day to one year and refused otherwise, with a sentence", () => {
  assert.equal(rangeProblem("2027-03-01", "2027-03-01"), null);
  assert.equal(rangeProblem("2026-03-01", "2027-03-01"), null);
  assert.match(rangeProblem("2026-03-01", "2027-03-02")!, /one year/);
  assert.match(rangeProblem("2027-03-02", "2027-03-01")!, /before/);
  for (const bad of [["", "2027-03-01"], ["2027-02-30", "2027-03-01"], ["x", "y"]]) assert.match(rangeProblem(bad[0], bad[1])!, /both dates/);
});

test("rates read as plain percentages and the default line is exact", () => {
  assert.equal(ratePhrase({ commissionRateBp: null }, 1000), "10% (shop default)");
  assert.equal(ratePhrase({ commissionRateBp: 1250 }, 1000), "12.5%");
  assert.equal(ratePhrase({ commissionRateBp: 0 }, 1000), "0%");
  assert.equal(defaultRateLine(1000), "Default rate is 10% until you change it.");
  assert.equal(defaultRateLine(725), "Default rate is 7.25% until you change it.");
});

test("removing tells the truth about what will happen and what did", () => {
  assert.match(removeWarning({ name: "Ana", openJobs: 2, hasHistory: true }), /still on 2 open jobs/);
  assert.match(removeWarning({ name: "Ana", openJobs: 1, hasHistory: false }), /1 open job\. /);
  assert.match(removeWarning({ name: "Ana", openJobs: 0, hasHistory: true }), /made inactive/);
  assert.match(removeWarning({ name: "Ana", openJobs: 0, hasHistory: false }), /can't be undone/);
  assert.match(removeResult("DELETED", "Ana"), /was removed/);
  assert.match(removeResult("DEACTIVATED", "Ana"), /job history/);
});

test("only detailers are managed on this screen", () => {
  assert.deepEqual((["DETAILER", "MANAGER", "ADMIN"] as const).map((role) => canManage({ role })), [true, false, false]);
});

test("a clean range shows no warning; each problem gets one plain sentence", () => {
  assert.deepEqual(warningLines({ nobodyCredited: 0, unpricedEntries: 0, missingRecords: 0 }), []);
  const lines = warningLines({ nobodyCredited: 1, unpricedEntries: 3, missingRecords: 2 });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^2 completed bookings in the shop have no commission recorded .* when they finished\. Use "Record missing commissions"/);
  assert.match(lines[1], /^1 completed booking in this range had nobody assigned/);
  assert.match(lines[2], /^3 commissions in this range/);
});

test("totals and bulk-selection use stored centavos only", () => {
  assert.equal(pesoRange([{ amountCentavos: 1050 }, { amountCentavos: 2 }]), "₱10.52");
  const e = [{ id: "a", paidAt: null }, { id: "b", paidAt: "2027-03-01T00:00:00.000Z" }];
  assert.deepEqual(selectableIds(e, true), ["a"]);
  assert.deepEqual(selectableIds(e, false), ["b"]);
});

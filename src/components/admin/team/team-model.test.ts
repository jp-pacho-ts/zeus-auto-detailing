import assert from "node:assert/strict";
import { test } from "node:test";
import { ADD_STAFF, COMMISSION_RULE_LINE, TEAM_EMPTY, TEAM_INTRO, canManage, lineSummary, defaultRateLine, manilaToday, monthStart, pesoRange, rangeProblem, ratePhrase, removeResult, removeWarning, selectableIds, warningLines } from "./team-model";

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
  assert.deepEqual(warningLines({ nobodyCredited: 0, noCommissionBookings: 0, unpricedEntries: 0, missingRecords: 0 }), []);
  const lines = warningLines({ nobodyCredited: 1, noCommissionBookings: 0, unpricedEntries: 3, missingRecords: 2 });
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

test("a negative unpaid figure reads as owed back, never as a bare minus (review R2-4)", async () => {
  const { unpaidText } = await import("./team-model");
  assert.equal(unpaidText(12_345), "Unpaid ₱123.45");
  assert.equal(unpaidText(0), "Unpaid ₱0.00");
  assert.equal(unpaidText(-200), "Owed back ₱2.00");
});

test("round 4: car-wash-only bookings get their own plain sentence, and the counted and not-counted lines are spelled out", () => {
  const lines = warningLines({ nobodyCredited: 0, noCommissionBookings: 2, unpricedEntries: 0, missingRecords: 0 });
  assert.deepEqual(lines, ["No commission: car wash. 2 completed bookings in this range had only car wash services, which earn no commission."]);
  const summary = lineSummary([
    { name: "Basic Wash", counted: false, notCountedReason: "Car wash does not earn commission.", amountCentavos: 40_000 },
    { name: "Regular Tint", counted: true, notCountedReason: null, amountCentavos: 100_000 },
    { name: "Eclipse", counted: true, notCountedReason: null, amountCentavos: null },
  ]);
  assert.deepEqual(summary, { counted: "Regular Tint ₱1,000.00, Eclipse (no price yet)", notCounted: "Basic Wash ₱400.00 (car wash does not earn commission)" });
  assert.deepEqual(lineSummary([]), { counted: null, notCounted: null });
  assert.match(COMMISSION_RULE_LINE, /car wash earns none/i);
});

test("P1-61: the Team screen copy is plain words for names only, with no role, account, email or code labels", () => {
  assert.equal(ADD_STAFF, "Add staff");
  assert.equal(TEAM_INTRO, "Add the names of your staff. They have no login.");
  for (const text of [ADD_STAFF, TEAM_INTRO, TEAM_EMPTY]) assert.doesNotMatch(text.replace("no login", ""), /detailer|manager|admin|sign-in|sign in|account|e-?mail|password/i, text);
});

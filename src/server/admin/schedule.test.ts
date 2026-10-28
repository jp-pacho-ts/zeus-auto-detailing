// P1-20 pure pieces: the schedule and calendar schemas, the SCHEDULE permission and the hours
// version token. No database.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as v from "@/lib/admin-schedule";
import { canPerform } from "./roles";
import { hoursVersion } from "./schedule";

const ok = (schema: { safeParse(x: unknown): { success: boolean } }, x: unknown) => schema.safeParse(x).success;
const week = (over: Record<number, Record<string, unknown>> = {}) =>
  Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, open: true, openTime: "08:00", closeTime: "18:00", ...over[d] }));
const VERSION = "a".repeat(64);

test("SCHEDULE is ADMIN only", () => {
  assert.equal(canPerform("SCHEDULE", "ADMIN"), true);
  assert.equal(canPerform("SCHEDULE", "STAFF"), false);
});

test("week hours: all seven weekdays once, HH:MM times, close after open, strict", () => {
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week() }), true);
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week().slice(0, 6) }), false, "six days");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week({ 6: { dayOfWeek: 5 } }) }), false, "duplicate weekday");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week({ 1: { openTime: "8:00" } }) }), false, "H:MM");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week({ 1: { closeTime: "24:00" } }) }), false, "24:00");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week({ 1: { openTime: "18:00", closeTime: "08:00" } }) }), false, "close before open");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week({ 1: { open: false, openTime: "18:00", closeTime: "08:00" } }) }), true,
    "a closed day keeps whatever times it had");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: "x", days: week() }), false, "version token");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week(), extra: 1 }), false, "strict");
  assert.equal(ok(v.WeekHoursSchema, { expectedVersion: VERSION, days: week({ 2: { note: "x" } }) }), false, "strict day");
});

test("closed dates: a real calendar date and an optional staff-only reason of at most 200 characters", () => {
  assert.equal(ok(v.ClosedDateCreateSchema, { date: "2027-03-07" }), true);
  assert.equal(ok(v.ClosedDateCreateSchema, { date: "2027-03-07", reason: "Holiday" }), true);
  assert.equal(ok(v.ClosedDateCreateSchema, { date: "2027-02-30" }), false);
  assert.equal(ok(v.ClosedDateCreateSchema, { date: "2027-03-07", reason: "x".repeat(201) }), false);
  assert.equal(ok(v.ClosedDateCreateSchema, { date: "2027-03-07", isFullDay: false }), false, "strict");
  assert.equal(v.ClosedDateCreateSchema.parse({ date: "2027-03-07", reason: "   " }).reason, undefined, "blank means no reason");
});

test("calendar range: from <= to, at most 42 days (a six-week month grid)", () => {
  assert.equal(ok(v.CalendarQuerySchema, { from: "2027-02-28", to: "2027-04-10" }), true, "42 days");
  assert.equal(ok(v.CalendarQuerySchema, { from: "2027-02-28", to: "2027-04-11" }), false, "43 days");
  assert.equal(ok(v.CalendarQuerySchema, { from: "2027-03-02", to: "2027-03-01" }), false);
  assert.equal(ok(v.CalendarQuerySchema, { from: "2027-03-01", to: "2027-03-01", q: "x" }), false, "strict");
});

test("the hours version token changes with any slot field and ignores row order", () => {
  const a = { dayOfWeek: 1, startTime: "08:00", endTime: "18:00", isActive: true };
  const b = { dayOfWeek: 2, startTime: "08:00", endTime: "18:00", isActive: true };
  assert.match(hoursVersion([]), /^[a-f0-9]{64}$/);
  assert.equal(hoursVersion([a, b]), hoursVersion([b, a]));
  for (const changed of [{ ...a, endTime: "17:00" }, { ...a, isActive: false }, { ...a, startTime: "09:00" }, { ...a, dayOfWeek: 3 }])
    assert.notEqual(hoursVersion([changed, b]), hoursVersion([a, b]), JSON.stringify(changed));
});

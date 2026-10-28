import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminCalendarDay } from "@/lib/admin-schedule";
import {
  bookingCount,
  monthGrid,
  monthOf,
  nextSortOrder,
  shiftMonth,
  statusParts,
  weekOf,
} from "./calendar-model";

const day = (byStatus: Partial<AdminCalendarDay["byStatus"]>, closed = false): AdminCalendarDay => {
  const full = { PENDING: 0, CONFIRMED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, ...byStatus };
  return { date: "2027-03-16", closed, byStatus: full, total: full.PENDING + full.CONFIRMED + full.IN_PROGRESS + full.COMPLETED };
};

test("month grid: whole Sunday-first weeks around the month, at most 42 days", () => {
  const march = monthGrid("2027-03"); // 1 March 2027 is a Monday
  assert.equal(march[0][0], "2027-02-28");
  assert.equal(march[0][1], "2027-03-01");
  assert.equal(march.at(-1)!.at(-1), "2027-04-03");
  assert.ok(march.every((w) => w.length === 7));
  assert.equal(march.length, 5);
  const feb2026 = monthGrid("2026-02"); // starts on a Sunday, 28 days: exactly 4 weeks
  assert.deepEqual([feb2026.length, feb2026[0][0], feb2026[3][6]], [4, "2026-02-01", "2026-02-28"]);
  assert.ok(monthGrid("2027-05").flat().length <= 42, "a six-week month still fits one calendar request");
});

test("months and weeks move across year ends; a week runs Sunday to Saturday", () => {
  assert.equal(monthOf("2027-12-31"), "2027-12");
  assert.equal(shiftMonth("2027-12", 1), "2028-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.deepEqual(weekOf("2027-03-03"), ["2027-02-28", "2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06"]);
  assert.deepEqual(weekOf("2027-02-28")[0], "2027-02-28");
});

test("status split lists the open and finished statuses in work order; cancelled is counted apart", () => {
  assert.deepEqual(statusParts(day({ CONFIRMED: 2, PENDING: 1, CANCELLED: 4 })), [
    { status: "PENDING", count: 1 },
    { status: "CONFIRMED", count: 2 },
  ]);
  assert.deepEqual(statusParts(day({})), []);
  assert.equal(bookingCount(0), "No bookings");
  assert.equal(bookingCount(1), "1 booking");
  assert.equal(bookingCount(3), "3 bookings");
});

test("a new bay goes after every bay of any type", () => {
  assert.equal(nextSortOrder([]), 1);
  assert.equal(nextSortOrder([{ sortOrder: 3 }, { sortOrder: 7 }, { sortOrder: 2 }]), 8);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeStaffPayroll,
  formatWeekLabel,
  getMondayOfWeek,
  getNextMonday,
  getPreviousMonday,
  getSundayOfWeek,
} from "./payroll-model";

test("getMondayOfWeek returns Monday for any day of the week", () => {
  // 2026-11-10 is Tuesday. The Monday is 2026-11-09.
  assert.equal(getMondayOfWeek("2026-11-10"), "2026-11-09");
  // 2026-11-09 is Monday.
  assert.equal(getMondayOfWeek("2026-11-09"), "2026-11-09");
  // 2026-11-15 is Sunday. The Monday is 2026-11-09.
  assert.equal(getMondayOfWeek("2026-11-15"), "2026-11-09");
});

test("getSundayOfWeek returns Sunday for Monday", () => {
  assert.equal(getSundayOfWeek("2026-11-09"), "2026-11-15");
});

test("getPreviousMonday and getNextMonday navigate by 7 days", () => {
  assert.equal(getPreviousMonday("2026-11-09"), "2026-11-02");
  assert.equal(getNextMonday("2026-11-09"), "2026-11-16");
});

test("formatWeekLabel formats dates within month and across months", () => {
  assert.equal(formatWeekLabel("2026-11-09", "2026-11-15"), "Nov 9 – 15, 2026");
  assert.equal(formatWeekLabel("2026-11-30", "2026-12-06"), "Nov 30 – Dec 6, 2026");
});

test("computeStaffPayroll calculates 6-day week base pay, absences, commissions and cash advances", () => {
  // Standard full week (6 days, 0 absent): 6 * 200 = 1200 pesos (120,000 centavos)
  const full = computeStaffPayroll({
    dailyRateCentavos: 20_000,
    daysAbsent: 0,
    commissionEarnedCentavos: 340_000, // 3,400 pesos
    cashAdvanceCentavos: 100_000, // 1,000 pesos
  });
  assert.equal(full.daysWorked, 6);
  assert.equal(full.baseSalaryCentavos, 120_000); // 1,200 pesos
  assert.equal(full.grossPayCentavos, 460_000); // 1,200 + 3,400 = 4,600 pesos
  assert.equal(full.netPayoutCentavos, 360_000); // 4,600 - 1,000 = 3,600 pesos

  // 1 day absent: 5 days worked -> 5 * 200 = 1,000 pesos (100,000 centavos)
  const withAbsent = computeStaffPayroll({
    dailyRateCentavos: 20_000,
    daysAbsent: 1,
    commissionEarnedCentavos: 200_000, // 2,000 pesos
    cashAdvanceCentavos: 50_000, // 500 pesos
  });
  assert.equal(withAbsent.daysWorked, 5);
  assert.equal(withAbsent.baseSalaryCentavos, 100_000); // 1,000 pesos
  assert.equal(withAbsent.grossPayCentavos, 300_000); // 1,000 + 2,000 = 3,000 pesos
  assert.equal(withAbsent.netPayoutCentavos, 250_000); // 3,000 - 500 = 2,500 pesos
});

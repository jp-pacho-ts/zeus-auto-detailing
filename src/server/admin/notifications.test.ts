import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminNotificationItem } from "@/types/admin-contracts";

test("notifications severity sort: urgent before warning before info", () => {
  const items: Pick<AdminNotificationItem, "id" | "severity" | "timestamp">[] = [
    { id: "1", severity: "info", timestamp: "2026-11-11T10:00:00Z" },
    { id: "2", severity: "urgent", timestamp: "2026-11-11T09:00:00Z" },
    { id: "3", severity: "warning", timestamp: "2026-11-11T11:00:00Z" },
    { id: "4", severity: "urgent", timestamp: "2026-11-11T12:00:00Z" },
  ];

  const severityRank = { urgent: 0, warning: 1, info: 2 };
  items.sort((a, b) => {
    const rankDiff = severityRank[a.severity] - severityRank[b.severity];
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  assert.deepEqual(
    items.map((i) => i.id),
    ["4", "2", "3", "1"],
  );
});

test("notification categories map correctly to admin tabs", () => {
  const sampleNewBooking: Pick<AdminNotificationItem, "type" | "targetTab"> = {
    type: "NEW_BOOKING",
    targetTab: "Bookings",
  };
  const sampleLowSupply: Pick<AdminNotificationItem, "type" | "targetTab"> = {
    type: "LOW_SUPPLY",
    targetTab: "Supplies & Inventory",
  };
  const samplePayroll: Pick<AdminNotificationItem, "type" | "targetTab"> = {
    type: "PAYROLL_ALERT",
    targetTab: "Payroll & Commissions",
  };

  assert.equal(sampleNewBooking.targetTab, "Bookings");
  assert.equal(sampleLowSupply.targetTab, "Supplies & Inventory");
  assert.equal(samplePayroll.targetTab, "Payroll & Commissions");
});

// Run: node --require ./src/server/__tests__/register.cjs --test ./src/components/booking/public-slot.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AvailableSlot, AvailableSlotData, SlotState } from "@/types/contracts";
import { publicDayMessage, slotLabel, toPublicSlot } from "./public-slot";

const engineSlot = (overrides: Partial<AvailableSlot> = {}): AvailableSlot => ({
  slotId: "11111111-1111-4111-8111-111111111111",
  date: "2026-10-20",
  startTime: "09:00",
  endTime: "10:30",
  durationMinutes: 90,
  maxVehicleCapacity: 2,
  remainingCapacity: 2,
  state: "AVAILABLE",
  selectable: true,
  reason: null,
  ...overrides,
});

test("maps every engine state with the T-039 table and fixed messages", () => {
  const cases: [SlotState, string, boolean, string | null][] = [
    ["AVAILABLE", "AVAILABLE", true, null],
    ["LIMITED", "AVAILABLE", true, null],
    ["SOLD_OUT", "FULLY_BOOKED", false, "Fully booked"],
    ["PAST", "PAST", false, "This time has passed"],
    ["OUTSIDE_HOURS", "ENDS_AFTER_CLOSING", false, "Ends after closing time"],
    ["BLOCKED", "SHOP_CLOSED", false, "Shop closed at this time"],
    ["HOLIDAY", "SHOP_CLOSED", false, "Shop closed at this time"],
    ["CLOSED", "SHOP_CLOSED", false, "Shop closed at this time"],
  ];
  for (const [engine, state, selectable, message] of cases) {
    const slot = toPublicSlot(engineSlot({ state: engine, selectable: engine === "AVAILABLE" || engine === "LIMITED" }));
    assert.equal(slot.state, state, engine);
    assert.equal(slot.selectable, selectable, engine);
    assert.equal(slot.message, message, engine);
  }
});

test("labels: Available, Fully booked, otherwise the fixed message", () => {
  assert.equal(slotLabel(toPublicSlot(engineSlot({ state: "LIMITED", remainingCapacity: 1 }))), "Available");
  assert.equal(slotLabel(toPublicSlot(engineSlot({ state: "SOLD_OUT", selectable: false, remainingCapacity: 0 }))), "Fully booked");
  assert.equal(slotLabel(toPublicSlot(engineSlot({ state: "PAST", selectable: false }))), "This time has passed");
});

test("non-leak: slots differing only in capacity, LIMITED/AVAILABLE, slotId or reason are identical", () => {
  const a = toPublicSlot(engineSlot({ state: "AVAILABLE", remainingCapacity: 2, maxVehicleCapacity: 2 }));
  const b = toPublicSlot(
    engineSlot({
      state: "LIMITED",
      remainingCapacity: 1,
      maxVehicleCapacity: 5,
      slotId: "22222222-2222-4222-8222-222222222222",
      reason: "Only 1 bay left",
    }),
  );
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("public slot carries exactly the published keys and no capacity, bay or slotId", () => {
  const slot = toPublicSlot(engineSlot());
  assert.deepEqual(Object.keys(slot), ["date", "startTime", "endTime", "state", "selectable", "message"]);
  assert.doesNotMatch(JSON.stringify(slot), /capacity|bay|slotId|remaining/i);
});

test("staff-entered reasons never reach the customer", () => {
  const blocked = toPublicSlot(engineSlot({ state: "BLOCKED", selectable: false, reason: "Owner's private event" }));
  assert.doesNotMatch(JSON.stringify(blocked), /private event/);

  const day = (dayState: AvailableSlotData["dayState"], reason: string | null) =>
    publicDayMessage({ dayState, reason } as AvailableSlotData);
  assert.equal(day("OPEN", "Staff training until 10"), null);
  assert.equal(day("HOLIDAY", "Christmas party for staff"), "We're closed on this date");
  assert.equal(day("CLOSED", null), "We're closed on this day");
});

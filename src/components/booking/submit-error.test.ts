// Run: node --require ./src/server/__tests__/register.cjs --test ./src/components/booking/submit-error.test.ts
// P1-09 F1 regression: a stale submission must never show staff-entered BlockedDate.reason text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateAvailability } from "@/server/availability-core";
import { contractError, DomainError } from "@/server/errors";
import type { ContractError } from "@/types/contracts";
import { SLOT_UNAVAILABLE_MESSAGE, publicSubmitError } from "./submit-error";

const FULL_DAY_CANARY = "PRIVATE-CANARY-full-day owner family event";
const PARTIAL_CANARY = "PRIVATE-CANARY-partial polisher repair by Jun";
const date = "2026-10-19";

function availability(blocks: { isFullDay: boolean; startTime: string | null; endTime: string | null; reason: string }[]) {
  return calculateAvailability({
    request: { date, vehicleCategoryId: "11111111-1111-4111-8111-111111111111", serviceId: "22222222-2222-4222-8222-222222222222" },
    now: new Date("2026-10-16T00:00:00Z"),
    config: { openTime: "08:00", closeTime: "17:00", defaultSlotIntervalMinutes: 30 },
    durationMinutes: 60,
    totalPriceCentavos: 180000,
    templates: Array.from({ length: 18 }, (_, i) => ({
      id: "slot-" + i, dayOfWeek: 1, isActive: true, maxVehicleCapacity: 2,
      startTime: String(8 + Math.floor(i / 2)).padStart(2, "0") + ":" + (i % 2 ? "30" : "00"),
      endTime: String(8 + Math.floor((i + 1) / 2)).padStart(2, "0") + ":" + ((i + 1) % 2 ? "30" : "00"),
    })),
    overrides: [],
    blocks,
    bookings: [],
  });
}

// Mirrors the unchanged reservation path (src/server/bookings.ts) for a time that became unselectable.
function staleSubmission(startTime: string, data: ReturnType<typeof availability>): ContractError {
  const slot = data.slots.find((s) => s.startTime === startTime);
  assert.ok(!slot?.selectable, "fixture time must be unselectable");
  return contractError(new DomainError("SLOT_UNAVAILABLE", slot?.reason || data.reason || "Choose an available arrival time.", { startTime: [slot?.reason || data.reason || "This arrival time is unavailable."] }));
}

const rendered = (e: ReturnType<typeof publicSubmitError>) => JSON.stringify(e);

test("fixtures prove the server error carries each private canary before sanitising", () => {
  assert.match(JSON.stringify(staleSubmission("09:00", availability([{ isFullDay: true, startTime: null, endTime: null, reason: FULL_DAY_CANARY }]))), /PRIVATE-CANARY-full-day/);
  assert.match(JSON.stringify(staleSubmission("10:00", availability([{ isFullDay: false, startTime: "10:00", endTime: "11:00", reason: PARTIAL_CANARY }]))), /PRIVATE-CANARY-partial/);
});

test("SLOT_UNAVAILABLE from a full-day block shows fixed wording only", () => {
  const shown = publicSubmitError(staleSubmission("09:00", availability([{ isFullDay: true, startTime: null, endTime: null, reason: FULL_DAY_CANARY }])));
  assert.equal(shown.message, SLOT_UNAVAILABLE_MESSAGE);
  assert.deepEqual(shown.fieldErrors, {});
  assert.doesNotMatch(rendered(shown), /PRIVATE-CANARY/);
});

test("SLOT_UNAVAILABLE from a partial block shows fixed wording only", () => {
  const shown = publicSubmitError(staleSubmission("10:00", availability([{ isFullDay: false, startTime: "10:00", endTime: "11:00", reason: PARTIAL_CANARY }])));
  assert.equal(shown.message, SLOT_UNAVAILABLE_MESSAGE);
  assert.deepEqual(shown.fieldErrors, {});
  assert.doesNotMatch(rendered(shown), /PRIVATE-CANARY/);
});

test("SCHEDULE_CONFLICT never renders server text, even if a reason were attached", () => {
  for (const canary of [FULL_DAY_CANARY, PARTIAL_CANARY]) {
    const shown = publicSubmitError({ code: "SCHEDULE_CONFLICT", message: canary, fieldErrors: { startTime: [canary], bookingDate: [canary] }, retryable: false });
    assert.equal(shown.message, SLOT_UNAVAILABLE_MESSAGE);
    assert.deepEqual(shown.fieldErrors, {});
    assert.doesNotMatch(rendered(shown), /PRIVATE-CANARY/);
  }
});

test("the real SCHEDULE_CONFLICT from the engine is also shown with fixed wording", () => {
  let error: unknown;
  try {
    // A one-hour template on a 30-minute grid is a malformed schedule: the engine fails closed.
    calculateAvailability({ request: { date, vehicleCategoryId: "a", serviceId: "b" }, now: new Date("2026-10-16T00:00:00Z"), config: { openTime: "08:00", closeTime: "17:00", defaultSlotIntervalMinutes: 30 }, durationMinutes: 60, totalPriceCentavos: 1, templates: [{ id: "x", dayOfWeek: 1, isActive: true, maxVehicleCapacity: 2, startTime: "08:00", endTime: "09:00" }], overrides: [], blocks: [{ isFullDay: false, startTime: "10:00", endTime: "11:00", reason: PARTIAL_CANARY }], bookings: [] });
  } catch (e) { error = e; }
  const contract = contractError(error);
  assert.equal(contract.code, "SCHEDULE_CONFLICT");
  const shown = publicSubmitError(contract);
  assert.equal(shown.message, SLOT_UNAVAILABLE_MESSAGE);
  assert.deepEqual(shown.fieldErrors, {});
});

test("validation errors keep their field messages for the details form", () => {
  const error: ContractError = { code: "VALIDATION_ERROR", message: "Please check the highlighted details.", fieldErrors: { customerPhone: ["Enter a valid Philippine mobile number."] }, retryable: false };
  assert.deepEqual(publicSubmitError(error), { message: error.message, fieldErrors: error.fieldErrors });
});

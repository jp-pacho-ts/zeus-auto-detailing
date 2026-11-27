// The New booking dialog's pure rules (2026-11-27).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DayAvailabilityData } from "@/types/contracts";
import { AdminRequestError } from "./client";
import { nextKey, pickerData } from "./new-booking-model";

test("the day picker never sees the online pause, so the admin can still choose a day", () => {
  const data = { days: [{ date: "2026-11-28", state: "AVAILABLE" }], nextAvailableDay: "2026-11-28", onlineBookingStatus: "PAUSED" } as DayAvailabilityData;
  assert.deepEqual(pickerData(data), { days: data.days, nextAvailableDay: "2026-11-28" });
  assert.equal(pickerData(null), null);
});

test("the retry key is kept only while the outcome is unknown", () => {
  const fresh = () => "new";
  assert.equal(nextKey(new AdminRequestError(503, { code: "RETRYABLE_ERROR" }), "old", fresh), "old");
  assert.equal(nextKey(new TypeError("Failed to fetch"), "old", fresh), "old");
  assert.equal(nextKey(new AdminRequestError(409, { code: "SCHEDULE_CONFLICT" }), "old", fresh), "new");
  assert.equal(nextKey(new AdminRequestError(400, { code: "VALIDATION_ERROR" }), "old", fresh), "new");
});

// P1-42: the booking switch on the screen can only close; the server setting stays the floor.
import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveBookingMode } from "./online-booking-mode";

test("booking is open only when both the server setting and the database say so", () => {
  assert.equal(effectiveBookingMode("OPEN", false), "OPEN");
  assert.equal(effectiveBookingMode("OPEN", true), "PAUSED");
  assert.equal(effectiveBookingMode("PAUSED", false), "PAUSED", "the screen cannot open what the server closed");
  assert.equal(effectiveBookingMode("PAUSED", true), "PAUSED");
});

// P1-19 item 9 (LE 2026-10-28): today is no longer offered once the shop has closed (brand closeTime,
// Asia/Manila). Rulings R2 (brand closeTime) and R3 (closed from closeTime inclusive).
import assert from "node:assert/strict";
import { test } from "node:test";
import { brandConfig } from "@/config/brand";
import { afterClosing } from "./availability-days";

const manila = (local: string) => new Date(local + "+08:00");

test("today is open before closing time and closed from closing time on", () => {
  assert.equal(brandConfig.closeTime, "18:00");
  assert.equal(afterClosing("2026-10-28", manila("2026-10-28T08:00:00.000")), false);
  assert.equal(afterClosing("2026-10-28", manila("2026-10-28T17:59:59.999")), false);
  assert.equal(afterClosing("2026-10-28", manila("2026-10-28T18:00:00.000")), true);
  assert.equal(afterClosing("2026-10-28", manila("2026-10-28T23:59:59.999")), true);
});

test("other days are never closed by the clock", () => {
  const evening = manila("2026-10-28T21:00:00.000");
  assert.equal(afterClosing("2026-10-29", evening), false);
  assert.equal(afterClosing("2026-11-05", evening), false);
});

test("at Manila midnight the new day is today and open", () => {
  const midnight = manila("2026-10-29T00:00:00.000");
  assert.equal(afterClosing("2026-10-29", midnight), false);
  assert.equal(afterClosing("2026-10-28", midnight), false, "yesterday is outside the booking window, not a closing question");
});

test("the Manila date is used, not the UTC date", () => {
  // 2026-10-28 10:30 UTC is 18:30 in Manila on the 28th; 2026-10-28 16:30 UTC is 00:30 on the 29th.
  assert.equal(afterClosing("2026-10-28", new Date("2026-10-28T10:30:00.000Z")), true);
  assert.equal(afterClosing("2026-10-29", new Date("2026-10-28T16:30:00.000Z")), false);
  assert.equal(afterClosing("2026-10-28", new Date("2026-10-28T09:59:59.999Z")), false);
});

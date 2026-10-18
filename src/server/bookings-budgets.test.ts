import assert from "node:assert/strict";
import { test } from "node:test";
import { newEffectBudget } from "./bookings-create";
const now = new Date("2026-10-18T00:00:00Z"), clientHash = "a".repeat(64);
const rows = (n: number, age: number, key = clientHash) => Array.from({ length: n }, () => ({ createdAt: new Date(now.getTime() - age), clientHash: key }));
test("new-effect budgets enforce six rolling daily commits and expire at the half-open boundary", () => {
    const c = { committed: rows(6, 2 * 3600000), anonymous: [] };
    const denied = newEffectBudget(c, clientHash, 100, now);
    assert.equal(denied?.code, "RATE_LIMITED");
    assert.equal(denied?.retryAfterSeconds, 22 * 3600);
    const old = { committed: rows(6, 86400000), anonymous: [] };
    assert.equal(newEffectBudget(old, clientHash, 100, now), null);
});
test("daily shop threshold follows target-day cap sum and hourly burst remains five", () => {
    const c = { committed: rows(4, 2 * 3600000, "other"), anonymous: [] };
    assert.equal(newEffectBudget(c, clientHash, 4, now)?.code, "ONLINE_BOOKING_UNAVAILABLE");
    assert.equal(newEffectBudget(c, clientHash, 8, now), null);
    assert.equal(newEffectBudget({ committed: rows(5, 1000, "other"), anonymous: [] }, clientHash, 100, now)?.code, "ONLINE_BOOKING_UNAVAILABLE");
});

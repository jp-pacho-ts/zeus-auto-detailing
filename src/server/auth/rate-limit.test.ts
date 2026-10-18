// Per-client login limits and unknown-token lookup limits (S-02, D-01 case 3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoginLimiter, createWindowCounter } from "./rate-limit";

test("login: 10 a minute, 100 a day and 1 in flight per key", () => {
  let now = 0;
  const limiter = createLoginLimiter({ perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 1 }, () => now);
  const first = limiter.enter("a");
  assert.ok(first.ok);
  const parallel = limiter.enter("a");
  assert.equal(parallel.ok, false); // in flight, including the failure-floor wait
  assert.ok(limiter.enter("b").ok); // keys are independent
  first.leave(); first.leave(); // idempotent
  for (let i = 1; i < 10; i++) { const e = limiter.enter("a"); assert.ok(e.ok); e.leave(); }
  const over = limiter.enter("a");
  assert.equal(over.ok, false);
  assert.ok(!over.ok && over.retryAfterSeconds > 0 && over.retryAfterSeconds <= 60);
  now += 60_000;
  const later = limiter.enter("a"); assert.ok(later.ok); later.leave();
  // The daily cap holds across minute windows.
  let day = 0;
  for (let m = 0; m < 20 && day < 200; m++) {
    now += 60_000;
    for (let i = 0; i < 10; i++) { const e = limiter.enter("c"); if (e.ok) { day++; e.leave(); } }
  }
  assert.equal(day, 100);
  const dayOver = limiter.enter("c");
  assert.ok(!dayOver.ok && dayOver.retryAfterSeconds > 60);
});

test("login limiter refuses new keys when its table is full instead of growing", () => {
  const limiter = createLoginLimiter({ perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 1 }, () => 0, 3);
  for (const k of ["a", "b", "c"]) assert.ok(limiter.enter(k).ok);
  assert.equal(limiter.enter("d").ok, false);
});

test("window counter blocks after the limit and resets with the window", () => {
  let now = 0;
  const counter = createWindowCounter(30, 60_000, () => now);
  for (let i = 0; i < 30; i++) { assert.equal(counter.blocked("k"), false); counter.record("k"); }
  assert.equal(counter.blocked("k"), true);
  assert.equal(counter.blocked("other"), false);
  now += 60_000;
  assert.equal(counter.blocked("k"), false);
});

test("window counter blocks new keys while its table is full of live keys", () => {
  let now = 0;
  const counter = createWindowCounter(30, 60_000, () => now, 2);
  counter.record("a"); counter.record("b");
  assert.equal(counter.blocked("c"), true);
  assert.equal(counter.blocked("a"), false);
  now += 60_000; // expired entries are pruned
  assert.equal(counter.blocked("c"), false);
});

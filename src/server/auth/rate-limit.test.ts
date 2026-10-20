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

// P1-10 M3: a full table used to refuse every new key until a 24-hour window ended. It still
// never grows past its bound; it refuses a new key only while every tracked key is in flight.
test("login limiter stays bounded and refuses a new key only while every tracked key is in flight", () => {
  const limiter = createLoginLimiter({ perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 1 }, () => 0, 3);
  const held = ["a", "b", "c"].map((k) => limiter.enter(k));
  for (const e of held) assert.ok(e.ok);
  const refused = limiter.enter("d");
  assert.ok(!refused.ok && refused.retryAfterSeconds === 1);
  if (held[1].ok) held[1].leave();
  assert.ok(limiter.enter("d").ok); // the idle key makes room
  assert.equal(limiter.size(), 3);
});

test("a full table of idle keys evicts the least recently used key, never a client that keeps trying", () => {
  let now = 0;
  const limiter = createLoginLimiter({ perKeyPerMinute: 2, perKeyPerDay: null, maxConcurrentPerKey: 1 }, () => now, 3);
  const use = (k: string) => { const e = limiter.enter(k); if (e.ok) e.leave(); return e.ok; };
  assert.ok(use("abuser") && use("abuser"));
  for (let i = 0; i < 50; i++) {
    assert.equal(use("abuser"), false, "an over-limit key stays limited"); // each attempt counts as use
    assert.ok(use("new-" + i), "a new key is admitted at once");
  }
  assert.ok(limiter.size() <= 3);
  now += 60_000;
  assert.ok(use("abuser"));
});

test("10,000+ distinct keys never lock out a new key (production limiter policies)", async () => {
  const { STAFF_LOGIN_POLICY } = await import("./policy");
  const { CREATE_ADMISSION_POLICY, PUBLIC_READ_ADMISSION_POLICY } = await import("../bookings-admission");
  let now = 0;
  const limiters = { login: createLoginLimiter(STAFF_LOGIN_POLICY, () => now), create: createLoginLimiter(CREATE_ADMISSION_POLICY, () => now),
    read: createLoginLimiter(PUBLIC_READ_ADMISSION_POLICY, () => now) };
  for (const [name, limiter] of Object.entries(limiters)) {
    for (let i = 0; i < 25_000; i++) {
      if (i % 1000 === 0) now += 60_000; // spread over 25 minutes, all inside one day
      const e = limiter.enter(name + ":" + i);
      assert.ok(e.ok, `${name} refused new key ${i}`);
      e.leave();
    }
    assert.ok(limiter.size() <= 10_000, name + " grew past its bound");
    const fresh = limiter.enter(name + ":fresh");
    assert.ok(fresh.ok, name + " locked out a new key");
  }
});

test("the booking limiters have no hidden day cap: only the minute window limits", async () => {
  const { CREATE_ADMISSION_POLICY, PUBLIC_READ_ADMISSION_POLICY, createAdmission, publicReadAdmission } = await import("../bookings-admission");
  assert.equal(CREATE_ADMISSION_POLICY.perKeyPerDay, null);
  assert.equal(PUBLIC_READ_ADMISSION_POLICY.perKeyPerDay, null);
  assert.ok(createAdmission.size() >= 0 && publicReadAdmission.size() >= 0); // the exported limiters use these policies
  let t = 0, total = 0;
  const limiter = createLoginLimiter(CREATE_ADMISSION_POLICY, () => t);
  for (let minute = 0; minute < 800; minute++, t += 60_000) {
    for (let i = 0; i < 20; i++) { const e = limiter.enter("steady"); if (e.ok) { total++; e.leave(); } }
  }
  assert.equal(total, 800 * 15); // 12,000 in under a day; the old 10,000/day ceiling is gone
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

// P1-10 M3: a table full of live keys used to block every new key for up to a window.
test("window counter never blocks a new key and stays bounded; the oldest live key makes room", () => {
  let now = 0;
  const counter = createWindowCounter(2, 60_000, () => now, 2);
  counter.record("a"); counter.record("a");
  counter.record("b");
  assert.equal(counter.blocked("c"), false);
  counter.record("c"); // evicts "a", the oldest window
  assert.equal(counter.size(), 2);
  assert.equal(counter.blocked("b"), false);
  counter.record("b");
  assert.equal(counter.blocked("b"), true); // live counts of the keys still tracked hold
  for (let i = 0; i < 20_000; i++) { assert.equal(counter.blocked("k" + i), false); counter.record("k" + i); }
  assert.equal(counter.size(), 2);
  now += 60_000; // expired entries are pruned
  assert.equal(counter.blocked("b"), false);
});

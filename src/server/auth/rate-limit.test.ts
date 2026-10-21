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

// P1-10 M3 and Codex F1 (PM ruling 2026-10-21): a key whose window can still limit it is never
// evicted, so no client can reset another client's counts. The table holds 100,000 keys and
// forgets only expired ones. When every key is live, only a new key is refused, until the
// earliest window ends.
const FLOOD = 100_000;
const flood = (enter: (key: string) => void, prefix: string) => { for (let i = 0; i < FLOOD; i++) enter(prefix + i); };

test("staff login: a victim's minute and day counts survive a full-table flood of other keys", async () => {
  const { STAFF_LOGIN_POLICY } = await import("./policy");
  let now = 600_000;
  const limiter = createLoginLimiter(STAFF_LOGIN_POLICY, () => now);
  const use = (k: string) => { const e = limiter.enter(k); if (e.ok) e.leave(); return e; };
  for (let m = 0; m < 10; m++, now += 60_000) for (let i = 0; i < 10; i++) assert.ok(use("victim").ok);
  const before = use("victim");
  assert.ok(!before.ok && before.retryAfterSeconds > 60, "the day limit refuses the victim");
  use("partial"); use("partial"); use("partial"); // 3 of 10 this minute
  flood((k) => use(k), "flood-");
  assert.equal(limiter.size(), FLOOD, "bounded at 100,000 keys");
  const after = use("victim");
  assert.ok(!after.ok && after.retryAfterSeconds >= before.retryAfterSeconds - 1, "still refused for the rest of its day");
  for (let i = 0; i < 7; i++) assert.ok(use("partial").ok, "a tracked key keeps its remaining attempts");
  assert.equal(use("partial").ok, false, "and no more: its 3 earlier attempts still count");
});

test("create and public read: minute counts survive a full-table flood; a new key waits at most 60 s", async () => {
  const { CREATE_ADMISSION_POLICY, PUBLIC_READ_ADMISSION_POLICY } = await import("../bookings-admission");
  for (const policy of [CREATE_ADMISSION_POLICY, PUBLIC_READ_ADMISSION_POLICY]) {
    let now = 0;
    const limiter = createLoginLimiter(policy, () => now);
    const use = (k: string) => { const e = limiter.enter(k); if (e.ok) e.leave(); return e; };
    for (let i = 0; i < policy.perKeyPerMinute; i++) assert.ok(use("victim").ok);
    now = 1_000;
    flood((k) => use(k), "flood-");
    now = 30_000;
    assert.equal(use("victim").ok, false, "the victim stays limited");
    const fresh = use("fresh");
    assert.ok(!fresh.ok && fresh.retryAfterSeconds === 30, "a new key waits for the earliest window (the victim's, ending at 60 s)");
    assert.ok(use("flood-5").ok, "tracked keys keep working");
    assert.equal(limiter.size(), FLOOD);
    now = 60_000;
    assert.ok(use("fresh").ok, "admitted once the earliest window ends: the expired victim made room");
    assert.equal(limiter.size(), FLOOD);
  }
});

test("a full table of in-flight keys refuses a new key for 1 s; in-flight keys are never pruned", () => {
  let now = 0;
  const limiter = createLoginLimiter({ perKeyPerMinute: 10, perKeyPerDay: null, maxConcurrentPerKey: 1 }, () => now, 3);
  const held = ["a", "b", "c"].map((k) => limiter.enter(k));
  for (const e of held) assert.ok(e.ok);
  now = 120_000; // every window has ended, but all three are in flight
  const refused = limiter.enter("d");
  assert.ok(!refused.ok && refused.retryAfterSeconds === 1);
  assert.equal(limiter.enter("a").ok, false, "a's request is still in flight");
  if (held[1].ok) held[1].leave();
  now += 1_000; // as Retry-After said: the next scan is at most a second later
  assert.ok(limiter.enter("d").ok, "b had expired and left: it makes room");
  assert.equal(limiter.size(), 3);
});

// The original M3 lockout: once the table was full, every new key was refused until a 24-hour
// window ended.
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
    assert.ok(limiter.size() <= 100_000, name + " grew past its bound");
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

test("unknown-session counter: counts survive a full-table flood; a new key is blocked only until the earliest window ends", () => {
  let now = 0;
  const counter = createWindowCounter(30, 60_000, () => now); // session.ts: 30 a minute, production table size
  for (let i = 0; i < 30; i++) counter.record("victim");
  for (let i = 0; i < 10; i++) counter.record("partial");
  now = 1_000;
  flood((k) => { if (!counter.blocked(k)) counter.record(k); }, "flood-");
  assert.equal(counter.size(), FLOOD, "bounded at 100,000 keys");
  assert.equal(counter.blocked("victim"), true, "the victim stays blocked");
  for (let i = 0; i < 20; i++) { assert.equal(counter.blocked("partial"), false); counter.record("partial"); }
  assert.equal(counter.blocked("partial"), true, "its 10 earlier lookups still count");
  now = 30_000;
  assert.equal(counter.blocked("fresh"), true, "a new key cannot be counted while every window is live");
  now = 60_000;
  assert.equal(counter.blocked("fresh"), false, "the windows that started at 0 have ended");
  counter.record("fresh");
  assert.equal(counter.blocked("flood-5"), false);
  assert.ok(counter.size() <= FLOOD);
});

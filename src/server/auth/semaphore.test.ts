// D-01 / S-02 admission primitive: bounded active, bounded queue, deadline, abort.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AdmissionRefused, createSemaphore } from "./semaphore";

const refusal = (reason: string) => (e: unknown) => e instanceof AdmissionRefused && e.reason === reason;

test("grants up to maxActive, queues up to maxQueued and refuses the rest at once", async () => {
  const s = createSemaphore({ maxActive: 2, maxQueued: 10, maxWaitMs: 2000 });
  const held = [await s.acquire(), await s.acquire()];
  const queued = Array.from({ length: 10 }, () => s.acquire());
  assert.deepEqual(s.stats(), { active: 2, queued: 10 });
  await assert.rejects(s.acquire(), refusal("QUEUE_FULL"));
  held[0]();
  const next = await queued[0]; // FIFO
  assert.deepEqual(s.stats(), { active: 2, queued: 9 });
  next(); held[1]();
  for (const p of queued.slice(1)) (await p)();
  assert.deepEqual(s.stats(), { active: 0, queued: 0 });
});

test("a queued wait past its deadline leaves the queue without a permit", async () => {
  const s = createSemaphore({ maxActive: 1, maxQueued: 5, maxWaitMs: 50 });
  const release = await s.acquire();
  const started = Date.now();
  await assert.rejects(s.acquire(), refusal("TIMEOUT"));
  assert.ok(Date.now() - started >= 45);
  assert.deepEqual(s.stats(), { active: 1, queued: 0 });
  release();
  assert.deepEqual(s.stats(), { active: 0, queued: 0 });
});

test("abort while queued leaves the queue; an already-aborted signal never acquires", async () => {
  const s = createSemaphore({ maxActive: 1, maxQueued: 5, maxWaitMs: 5000 });
  const release = await s.acquire();
  const controller = new AbortController();
  const waiting = s.acquire(controller.signal);
  controller.abort();
  await assert.rejects(waiting, refusal("ABORTED"));
  await assert.rejects(s.acquire(AbortSignal.abort()), refusal("ABORTED"));
  assert.deepEqual(s.stats(), { active: 1, queued: 0 });
  release();
  // An abort after acquisition does not release: the holder releases when its work ends.
  const late = new AbortController();
  const held = await s.acquire(late.signal);
  late.abort();
  assert.deepEqual(s.stats(), { active: 1, queued: 0 });
  held();
});

test("tryAcquire takes a free permit at once and never queues", async () => {
  const s = createSemaphore({ maxActive: 1, maxQueued: 5, maxWaitMs: 1000 });
  const a = s.tryAcquire();
  assert.ok(a);
  assert.equal(s.tryAcquire(), null);
  assert.deepEqual(s.stats(), { active: 1, queued: 0 });
  const queued = s.acquire();
  a(); a();
  (await queued)(); // the queued waiter got the permit first; tryAcquire never jumps the queue
  assert.deepEqual(s.stats(), { active: 0, queued: 0 });
});

test("release is idempotent: a double release never frees a second permit", async () => {
  const s = createSemaphore({ maxActive: 1, maxQueued: 5, maxWaitMs: 1000 });
  const a = await s.acquire();
  const b = s.acquire();
  a(); a();
  const bRelease = await b;
  assert.deepEqual(s.stats(), { active: 1, queued: 0 });
  const c = s.acquire();
  assert.deepEqual(s.stats(), { active: 1, queued: 1 });
  bRelease();
  (await c)();
});

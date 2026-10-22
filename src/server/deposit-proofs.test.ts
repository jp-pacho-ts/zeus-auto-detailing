import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { depositProofHttp, DEPOSIT_UPLOAD_POLICIES, MAX_PROOFS_PER_BOOKING, MAX_UPLOAD_BODY_BYTES, UPLOAD_BODY_DEADLINE_MS } from "./deposit-proofs";
import { bookingError, lifecycleHttpStatus } from "./bookings-errors";
import { parseBookingConfiguration, signManagementToken } from "./bookings-credentials";
import { managementCookieName } from "./bookings-management";
import { canPerform } from "./admin/roles";
import { proofImageResponse } from "./admin/deposit";
import { depositNoticeMessage } from "./notifications/bookings";
import { png } from "./deposit-image.fixture";

// P1-12 F2 (Codex review): signed sessions (stateless check only), a database that fails the test
// if anything touches it, partial request bodies and a timer the test fires itself.
const c = parseBookingConfiguration({
  BOOKING_QUOTE_KEYS: "q:" + randomBytes(32).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID: "q",
  MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(32).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID: "g",
  MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(32).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID: "s",
  ONLINE_BOOKING_MODE: "OPEN", TURNSTILE_SECRET_KEY: "synthetic_secret_for_local_deposit_checks",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic_site_key_for_deposit_checks", TURNSTILE_ALLOWED_HOSTNAMES: "localhost",
  APP_ORIGIN: "http://localhost:3000", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1", NODE_ENV: "test",
});
const dbTouched: string[] = [];
const noDb = new Proxy({}, { get(_t, p) { dbTouched.push(String(p)); throw new Error("database touched: " + String(p)); } }) as unknown as PrismaClient;
let client = 0;
function uploadRequest(body: ReadableStream<Uint8Array> | string, extra: { signal?: AbortSignal } = {}) {
  const bookingId = randomUUID(), now = Date.now();
  const token = signManagementToken("BOOKING_MANAGEMENT_SESSION", {
    bookingId, credentialVersion: 1, issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), grantKid: "g",
  }, c.session);
  return new Request("http://localhost:3000/api/bookings/manage/deposit-proofs", {
    method: "POST", body, duplex: "half", signal: extra.signal,
    headers: { origin: c.origin, "x-zeus-booking": "1", "content-type": "application/json", "x-forwarded-for": "198.18.60." + ++client, cookie: managementCookieName() + "=" + token },
  } as RequestInit);
}
// A body that sends its first byte and then stays open; records whether the reader cancelled it.
function partialBody() {
  const state = { cancelled: false, controller: null as ReadableStreamDefaultController<Uint8Array> | null };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { state.controller = controller; controller.enqueue(new TextEncoder().encode("{")); },
    cancel() { state.cancelled = true; },
  });
  return { stream, state };
}
function fakeTimer() {
  const pending: { ms: number; fire: () => void; cleared: boolean }[] = [];
  const start = (ms: number, fire: () => void) => {
    const t = { ms, fire, cleared: false };
    pending.push(t);
    return () => { t.cleared = true; };
  };
  return { start, pending, fireAll: () => pending.filter((t) => !t.cleared).forEach((t) => t.fire()) };
}
const settled = async (p: Promise<unknown>, ms = 50) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))]);
async function errorOf(res: Response) {
  const body = await res.json();
  return { status: res.status, code: body.error?.code, commitState: body.error?.commitState, retryable: body.error?.retryable };
}

test("upload limits: 3 files per booking, per-client and per-booking rate limits, one upload at a time", () => {
  assert.equal(MAX_PROOFS_PER_BOOKING, 3);
  assert.deepEqual(DEPOSIT_UPLOAD_POLICIES, {
    client: { perKeyPerMinute: 10, perKeyPerDay: 30, maxConcurrentPerKey: 1 },
    booking: { perKeyPerMinute: 6, perKeyPerDay: 20, maxConcurrentPerKey: 1 },
  });
  // base64 of 5 MiB plus the JSON envelope; anything longer is refused while reading.
  assert.ok(MAX_UPLOAD_BODY_BYTES >= Math.ceil((5 * 1024 * 1024) / 3) * 4 + 200);
  assert.ok(MAX_UPLOAD_BODY_BYTES < 7.2 * 1024 * 1024);
});

test("upload error codes map to HTTP 400, 413 and 409", () => {
  assert.equal(lifecycleHttpStatus(bookingError("UNSUPPORTED_FILE", "x")), 400);
  assert.equal(lifecycleHttpStatus(bookingError("FILE_TOO_LARGE", "x")), 413);
  assert.equal(lifecycleHttpStatus(bookingError("DEPOSIT_PROOF_LIMIT", "x")), 409);
});

test("only ADMIN sets the deposit status; STAFF reads", () => {
  assert.equal(canPerform("DEPOSIT_STATUS", "ADMIN"), true);
  assert.equal(canPerform("DEPOSIT_STATUS", "STAFF"), false);
  assert.equal(canPerform("READ", "STAFF"), true);
});

test("staff image responses: fixed type, inline without a file name, no-store, nosniff, sandboxed", async () => {
  const data = png();
  const res = proofImageResponse({ contentType: "image/png", data });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("content-disposition"), "inline");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(res.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("content-length"), String(data.length));
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(data));
  assert.throws(() => proofImageResponse({ contentType: "text/html", data }), /content type/);
});

test("the shop email names the reference only: no image, no customer details", () => {
  const m = depositNoticeMessage("ZEUS-ABC123", "11111111-2222-4333-8444-555555555555", "https://zeus.example.test");
  assert.equal(m.subject, "Deposit proof sent for ZEUS-ABC123");
  assert.equal(m.text, [
    "ZEUS-ABC123",
    "The customer sent a deposit proof. Check it against the shop account, then mark the deposit received or rejected.",
    "https://zeus.example.test/admin/bookings?bookingId=11111111-2222-4333-8444-555555555555",
  ].join("\n"));
});

async function until(check: () => boolean, what: string, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    assert.ok(Date.now() < end, "timed out waiting for " + what);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const admittedBody = () => JSON.stringify({ bookingId: randomUUID(), idempotencyKey: randomUUID(), image: "" });
const stopped = { status: 503, code: "RETRYABLE_ERROR", commitState: "UNKNOWN", retryable: true };

test("F2: two unfinished bodies hit the 15 s deadline: refused UNKNOWN, readers cancelled, no database work; a waiting upload then gets in", { timeout: 10000 }, async () => {
  assert.equal(UPLOAD_BODY_DEADLINE_MS, 15000);
  dbTouched.length = 0;
  const timer = fakeTimer(), opts = { db: noDb, config: c, bodyTimer: timer.start };
  const a = partialBody(), b = partialBody();
  const first = depositProofHttp(uploadRequest(a.stream), opts);
  const second = depositProofHttp(uploadRequest(b.stream), opts);
  await until(() => timer.pending.length === 2, "both uploads to hold a body permit and start their deadline");
  assert.deepEqual(timer.pending.map((t) => t.ms), [UPLOAD_BODY_DEADLINE_MS, UPLOAD_BODY_DEADLINE_MS]);
  // Both body permits are taken: a third upload waits.
  const third = depositProofHttp(uploadRequest(admittedBody()), opts);
  assert.equal(await settled(third, 100), false, "the third upload waits for a body permit");
  assert.equal(await settled(first), false);
  timer.fireAll(); // the controlled clock passes the deadline
  assert.deepEqual(await errorOf(await first), stopped);
  assert.deepEqual(await errorOf(await second), stopped);
  assert.ok(a.state.cancelled && b.state.cancelled, "both request bodies were cancelled");
  // The third got a permit: it reaches validation (an empty image), not a queue refusal.
  assert.deepEqual(await errorOf(await third), { status: 400, code: "VALIDATION_ERROR", commitState: "NOT_APPLICABLE", retryable: false });
  assert.equal(timer.pending[2].cleared, true, "a finished read clears its deadline");
  assert.deepEqual(dbTouched, []);
});

test("F2: a body reader that ignores cancellation is still cut off at the deadline", { timeout: 10000 }, async () => {
  const { uploadDepositProof } = await import("./deposit-proofs");
  const timer = fakeTimer(), req = uploadRequest(admittedBody());
  const never = uploadDepositProof(() => new Promise<never>(() => {}), { db: noDb, config: c, headers: req.headers, bodyTimer: timer.start });
  await until(() => timer.pending.length === 1, "the deadline to start");
  timer.fireAll();
  const r = await never;
  assert.deepEqual(!r.result.ok && [r.result.error.code, r.result.error.commitState, r.result.error.retryable], ["RETRYABLE_ERROR", "UNKNOWN", true]);
  assert.deepEqual(dbTouched, []);
});

test("F2: a client that disconnects mid-body is refused at once and frees its permit", { timeout: 10000 }, async () => {
  dbTouched.length = 0;
  const timer = fakeTimer(), opts = { db: noDb, config: c, bodyTimer: timer.start };
  // The connection drops: the body stream errors.
  const a = partialBody();
  const first = depositProofHttp(uploadRequest(a.stream), opts);
  await until(() => timer.pending.length === 1, "the first upload to start reading");
  a.state.controller!.error(new Error("connection reset"));
  assert.equal((await first).status, 400);
  // The client goes away: the request is aborted while its body is still open.
  const gone = new AbortController(), b = partialBody();
  const second = depositProofHttp(uploadRequest(b.stream, { signal: gone.signal }), opts);
  await until(() => timer.pending.length === 2, "the second upload to start reading");
  gone.abort();
  assert.deepEqual(await errorOf(await second), stopped);
  assert.ok(b.state.cancelled, "the aborted request's body was cancelled");
  assert.ok(timer.pending.every((t) => t.cleared), "no deadline left running");
  // Both permits are free again: two more uploads are admitted together, without waiting.
  const results = await Promise.all([depositProofHttp(uploadRequest(admittedBody()), opts), depositProofHttp(uploadRequest(admittedBody()), opts)]);
  assert.deepEqual(results.map((r) => r.status), [400, 400]);
  assert.deepEqual(dbTouched, []);
});

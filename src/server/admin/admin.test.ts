// P1-07 pure pieces: schemas, the role matrix, totals, cursors, the history key ring and the
// error envelope. No database.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import * as v from "@/lib/admin-validation";
import { ADMIN_OPS, canPerform, type AdminOp } from "./roles";
import { bookingTotals, effectivePrice } from "./totals";
import { decodeCursor, encodeCursor, filterHash } from "./cursor";
import { HistoryKeyRingError, historyDigest, parseHistoryKeyRing } from "./history-key-ring";
import { AdminServiceError, isGuardViolation } from "./errors";

const id = "0B8B3B3E-2B1A-4E5C-9F00-000000000001";
const ok = (schema: { safeParse(x: unknown): { success: boolean } }, x: unknown) => schema.safeParse(x).success;

test("schemas are strict, bounded and lowercase IDs; list GET refuses q (T-019 S-03)", () => {
  assert.equal(v.AdminIdSchema.parse(id), id.toLowerCase());
  assert.equal(ok(v.BookingListSchema, { q: "Juan" }), false);
  assert.equal(ok(v.BookingListSchema, { from: "2027-01-01", to: "2028-06-01" }), false);
  assert.equal(ok(v.BookingSearchSchema, { q: "Juan" }), true);
  assert.equal(ok(v.BookingStatusWriteSchema, { expectedRevision: 1, status: "PENDING" }), false, "reinstate needs a reason");
  assert.equal(ok(v.BookingStatusWriteSchema, { expectedRevision: 1, status: "PENDING", reason: "Declined by mistake" }), true);
  assert.equal(ok(v.BookingStatusWriteSchema, { expectedRevision: 1, status: "CANCELLED" }), false, "cancel goes through decline");
  for (const bad of [{ expectedRevision: 0, status: "CONFIRMED" }, { expectedRevision: 1.5, status: "CONFIRMED" }, { expectedRevision: 1, status: "CONFIRMED", extra: 1 }]) {
    assert.equal(ok(v.BookingStatusWriteSchema, bad), false, JSON.stringify(bad));
  }
  assert.equal(ok(v.LinePriceSchema, { expectedRevision: 1, priceCentavos: 100_000_001, reason: "x" }), false);
  assert.equal(ok(v.LinePriceSchema, { expectedRevision: 1, priceCentavos: 1.5, reason: "x" }), false);
  assert.equal(ok(v.LinePriceSchema, { expectedRevision: 1, priceCentavos: 5000, reason: " " }), false);
  assert.equal(ok(v.LinePriceSchema, { expectedRevision: 1, priceCentavos: 5000, reason: "x".repeat(501) }), false);
  assert.equal(ok(v.AddLineSchema, { expectedRevision: 1, serviceId: id, quantity: 21 }), false);
  assert.equal(ok(v.DefaultCapSchema, { expectedRevision: 1, dailyCap: 501 }), false);
  assert.equal(ok(v.DefaultCapSchema, { expectedRevision: 1, dailyCap: null }), true);
  assert.equal(ok(v.ReorderSchema, { bookings: [{ id, expectedRevision: 1 }, { id, expectedRevision: 2 }] }), false);
  assert.equal(ok(v.MoveSchema, { expectedRevision: 1, toDate: "2027-02-30", toQueueCode: "WASH" }), false);
  assert.equal(ok(v.MoveSchema, { expectedRevision: 1, toDate: "2027-02-27", toQueueCode: "wash" }), false);
  assert.equal(ok(v.BayUpdateSchema, { expectedUpdatedAt: "2027-01-01T00:00:00.000Z" }), false);
  assert.equal(ok(v.CustomerHistorySchema, { phone: "not a phone" }), true, "malformed is not a 400 (D8)");
  assert.equal(ok(v.CustomerHistorySchema, { phone: "1".repeat(65) }), false);
});

test("the role matrix follows ADR-005 §15, A3 and PM decisions D4/D5", () => {
  const staff: AdminOp[] = ["READ", "LINE_STATUS", "BAY_ASSIGN", "STATUS_IN_PROGRESS", "STATUS_COMPLETED", "NOTIFY"];
  const adminOnly: AdminOp[] = ["STATUS_CONFIRMED", "STATUS_REINSTATE", "DECLINE", "MOVE", "REORDER", "LINE_ADD", "LINE_REMOVE",
    "LINE_PRICE", "BAY_LIST", "CAPS", "HISTORY_LOOKUP"];
  assert.deepEqual([...staff, ...adminOnly].sort(), [...ADMIN_OPS].sort(), "every operation is classified");
  for (const op of staff) assert.deepEqual([canPerform(op, "STAFF"), canPerform(op, "ADMIN")], [true, true], op);
  for (const op of adminOnly) assert.deepEqual([canPerform(op, "STAFF"), canPerform(op, "ADMIN")], [false, true], op);
});

test("totals: staff price over the snapshot, removed lines excluded, no estimate while a for-quote line has no reference", () => {
  const line = (o: Partial<Parameters<typeof effectivePrice>[0]>) => ({ priceStatus: "PRICED" as const, subtotalCentavos: null, referenceSubtotalCentavos: null,
    staffPriceCentavos: null, removed: false, ...o });
  assert.equal(effectivePrice(line({ subtotalCentavos: 18000 })), 18000);
  assert.equal(effectivePrice(line({ subtotalCentavos: 18000, staffPriceCentavos: 15000 })), 15000);
  assert.equal(effectivePrice(line({ priceStatus: "FOR_QUOTE", referenceSubtotalCentavos: 1_310_000 })), null);
  const lines = [line({ subtotalCentavos: 18000 }), line({ priceStatus: "FOR_QUOTE", referenceSubtotalCentavos: 1_310_000 }),
    line({ priceStatus: "FOR_QUOTE", referenceSubtotalCentavos: 50000, staffPriceCentavos: 40000 }), line({ subtotalCentavos: 99999, removed: true })];
  assert.deepEqual(bookingTotals(lines, { receiptTotalCentavos: 18000, receiptEstimatedCentavos: 1_378_000 }),
    { receiptTotalCentavos: 18000, receiptEstimatedCentavos: 1_378_000, currentTotalCentavos: 58000, currentEstimateCentavos: 1_368_000, forQuoteCount: 1 });
  assert.equal(bookingTotals([line({ priceStatus: "FOR_QUOTE" })], { receiptTotalCentavos: 0, receiptEstimatedCentavos: null }).currentEstimateCentavos, null);
});

test("cursors: round trip; a filter, sort or version mismatch and malformed text are 400 on cursor", () => {
  const f = filterHash(["LIST", "2027-01-01", null, ["PENDING"], null]);
  assert.match(f, /^[a-f0-9]{16}$/);
  assert.notEqual(f, filterHash(["SEARCH", "2027-01-01", null, ["PENDING"], null, "NAME", "juan"]));
  const c = encodeCursor({ s: "DAY_ASC", f, k: ["2027-01-01", "2027-01-01T00:00:00.000Z", id.toLowerCase()] });
  assert.deepEqual(decodeCursor(c, "DAY_ASC", f), ["2027-01-01", "2027-01-01T00:00:00.000Z", id.toLowerCase()]);
  for (const [text, sort, hash] of [[c, "CREATED_AT_DESC", f], [c, "DAY_ASC", "0".repeat(16)], ["not-base64!", "DAY_ASC", f],
    [Buffer.from(JSON.stringify({ v: 2, s: "DAY_ASC", f, k: [] })).toString("base64url"), "DAY_ASC", f]] as const) {
    assert.throws(() => decodeCursor(text, sort, hash), (e: unknown) => e instanceof AdminServiceError && e.code === "VALIDATION_ERROR" && "cursor" in e.fieldErrors);
  }
});

const secret = (seed: number) => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + seed * 101 + 11) % 256)).toString("base64url");
test("the HISTORY_LOOKUP key ring follows the quote-ring rules, and the digest is a keyed, domain-separated HMAC", () => {
  const good = { HISTORY_LOOKUP_KEYS: `h-1:${secret(1)},h-2:${secret(2)}`, HISTORY_LOOKUP_ACTIVE_KID: "h-2" };
  const ring = parseHistoryKeyRing(good);
  assert.equal(ring.activeKid, "h-2");
  const lowEntropy = Buffer.from(Array.from({ length: 32 }, (_, i) => i % 15)).toString("base64url");
  for (const [label, env] of [["missing", {}], ["active not listed", { ...good, HISTORY_LOOKUP_ACTIVE_KID: "h-9" }],
    ["four keys", { HISTORY_LOOKUP_KEYS: [1, 2, 3, 4].map((n) => `k${n}:${secret(n)}`).join(","), HISTORY_LOOKUP_ACTIVE_KID: "k1" }],
    ["bad kid", { HISTORY_LOOKUP_KEYS: `Bad:${secret(1)}`, HISTORY_LOOKUP_ACTIVE_KID: "Bad" }],
    ["short", { HISTORY_LOOKUP_KEYS: `a:${Buffer.alloc(31, 7).toString("base64url")}`, HISTORY_LOOKUP_ACTIVE_KID: "a" }],
    ["padded", { HISTORY_LOOKUP_KEYS: `a:${secret(1)}=`, HISTORY_LOOKUP_ACTIVE_KID: "a" }],
    ["low entropy", { HISTORY_LOOKUP_KEYS: `a:${lowEntropy}`, HISTORY_LOOKUP_ACTIVE_KID: "a" }],
    ["duplicate secret", { HISTORY_LOOKUP_KEYS: `a:${secret(1)},b:${secret(1)}`, HISTORY_LOOKUP_ACTIVE_KID: "a" }],
    ["shared with the quote ring", { ...good, BOOKING_QUOTE_KEYS: `q:${secret(1)}` }],
    ["shared with the grant ring", { ...good, MANAGEMENT_GRANT_KEYS: `g:${secret(2)}` }],
    ["equals the origin secret", { ...good, ORIGIN_AUTH_SECRET: secret(2) }]] as [string, Record<string, string>][]) {
    assert.throws(() => parseHistoryKeyRing(env), (e: unknown) => e instanceof HistoryKeyRingError && !String((e as Error).message).includes(secret(1)), label);
  }
  const digest = historyDigest(ring, "+639170000001");
  assert.match(digest, /^[a-f0-9]{64}$/);
  const key = Buffer.from(secret(2), "base64url");
  assert.equal(digest, createHmac("sha256", key).update("zeus.history-lookup.v1\u0000+639170000001").digest("hex"));
  assert.notEqual(digest, createHmac("sha256", key).update("+639170000001").digest("hex"), "domain separated");
  assert.notEqual(historyDigest(ring, null, "+639170000001"), digest, "a malformed input has its own prefix (D8)");
  assert.equal(digest.includes("639170000001"), false);
});

test("the error envelope: status per code, currentBooking only where given, and DB guard detection", () => {
  const cases: [AdminServiceError, number][] = [[new AdminServiceError("VERSION_CONFLICT"), 409], [new AdminServiceError("SCHEDULE_CONFLICT"), 409],
    [new AdminServiceError("BOOKING_NOT_MANAGEABLE"), 409], [new AdminServiceError("CATALOG_UPDATED"), 409], [new AdminServiceError("NOT_FOUND"), 404],
    [new AdminServiceError("FORBIDDEN"), 403], [new AdminServiceError("VALIDATION_ERROR"), 400], [new AdminServiceError("RATE_LIMITED", undefined, { retryAfterSeconds: 60 }), 429],
    [new AdminServiceError("INTERNAL_ERROR"), 500]];
  for (const [e, status] of cases) {
    assert.equal(e.status, status, e.code);
    const env = e.toEnvelope();
    assert.deepEqual([env.code, env.currentBooking, env.commitState], [e.code, null, "NOT_COMMITTED"]);
  }
  assert.equal(new AdminServiceError("RATE_LIMITED", undefined, { retryAfterSeconds: 60 }).toEnvelope().retryable, true);
  assert.equal(isGuardViolation(new Error("Raw query failed. Code: `P0001`. Message: `ERROR: Queue day is full or has no cap configured`")), true);
  assert.equal(isGuardViolation(new Error("new row for relation \"booking_audit_events\" violates check constraint \"booking_audit_shape\"")), true);
  assert.equal(isGuardViolation(new Error("Connection refused")), false);
});

test("Codex F3: cursor tuples validate dates, timestamps, UUIDs and exact arity for each sort", () => {
  const f = filterHash(["LIST", null, null, null, null]);
  const uuid = id.toLowerCase(), instant = "2027-01-01T00:00:00.000Z";
  for (const [sort, keys] of [
    ["DAY_ASC", ["not-a-date"]], ["DAY_ASC", ["2027-02-30", instant, uuid]], ["DAY_ASC", ["2027-01-01", "not-an-instant", uuid]],
    ["DAY_ASC", ["2027-01-01", instant, "bad-id"]], ["DAY_ASC", ["2027-01-01", instant, uuid, "extra"]], ["DAY_ASC", [1, instant, uuid]],
    ["CREATED_AT_DESC", [instant]], ["CREATED_AT_DESC", ["2027-02-30T00:00:00.000Z", uuid]], ["CREATED_AT_DESC", [instant, "bad-id"]],
    ["CREATED_AT_DESC", [instant, uuid, "extra"]], ["CREATED_AT_DESC", [1, uuid]],
  ] as const) {
    assert.throws(() => decodeCursor(encodeCursor({ s: sort, f, k: [...keys] }), sort, f), (e: unknown) => e instanceof AdminServiceError && e.status === 400 && Boolean(e.fieldErrors.cursor), `${sort} ${JSON.stringify(keys)}`);
  }
  assert.deepEqual(decodeCursor(encodeCursor({ s: "CREATED_AT_DESC", f, k: [instant, uuid] }), "CREATED_AT_DESC", f), [instant, uuid]);
});
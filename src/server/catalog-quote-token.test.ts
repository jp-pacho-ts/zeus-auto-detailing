// Quote v2 signature binding, token parser and key ring (T-043 T-046 cases 3, 4 and 5).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { BookingQuote } from "@/types/catalog-contracts";
import { priceSelection } from "./catalog-pricing";
import { QuoteKeyRingError, parseQuoteKeyRing, signQuote, verifyQuote, type QuoteKeyRing } from "./catalog-quote-token";
import { bySlug, releaseFromManifest, sizeId } from "./catalog.fixture";

const secret = (seed: number) => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + seed * 101 + 11) % 256)).toString("base64url");
const ring = parseQuoteKeyRing({ BOOKING_QUOTE_KEYS: `q-2026a:${secret(1)},q-2026b:${secret(2)}`, BOOKING_QUOTE_ACTIVE_KID: "q-2026a" });
const NOW = new Date("2026-10-18T02:00:00.000Z");
const release = releaseFromManifest();

function freshQuote(slug = "signature-wash", size = "M", keys: QuoteKeyRing = ring, now = NOW): BookingQuote {
  const priced = priceSelection(release, { serviceId: bySlug(release, slug).id, vehicleCategoryId: sizeId(release, size), quantity: 1, addOnServiceIds: [] });
  assert.equal(priced.kind, "BOOKABLE");
  return signQuote(priced.kind === "BOOKABLE" ? priced.quote : (null as never), keys, now);
}
const decode = (token: string) => JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
// Signs arbitrary payload text with a ring key, to prove that a valid MAC alone is not enough.
const forge = (payloadText: string, key = ring.keys.get("q-2026a")!, algorithm = "sha256") => {
  const encoded = Buffer.from(payloadText, "utf8").toString("base64url");
  return encoded + "." + createHmac(algorithm, key).update(encoded).digest("base64url");
};
const ok = (q: unknown, now = NOW, keys = ring) => verifyQuote(q, keys, now).ok;

test("a signed quote verifies; the payload is the fixed-order v2 BOOKING_QUOTE object", () => {
  const q = freshQuote();
  const v = verifyQuote(q, ring, NOW);
  assert.ok(v.ok && !v.expired);
  assert.equal(q.issuedAt, NOW.toISOString());
  assert.equal(Date.parse(q.expiresAt) - Date.parse(q.issuedAt), 15 * 60_000);
  const payload = decode(q.quoteToken);
  assert.deepEqual(Object.keys(payload), ["v", "kid", "purpose", "quote"]);
  assert.deepEqual([payload.v, payload.kid, payload.purpose], [2, "q-2026a", "BOOKING_QUOTE"]);
  assert.deepEqual(Object.keys(payload.quote), ["serviceId", "vehicleCategoryId", "quantity", "addOnServiceIds", "version", "catalogReleaseId",
    "catalogFingerprint", "pricingAlgorithm", "lines", "totalPriceCentavos", "durationMinutes", "currency", "issuedAt", "expiresAt"]);
  assert.deepEqual(Object.keys(payload.quote.lines[0]), ["kind", "serviceId", "offerId", "name", "unit", "quantity", "unitPriceCentavos", "subtotalCentavos", "addedMinutes"]);
  const signed: Partial<BookingQuote> = { ...q };
  delete signed.quoteToken;
  assert.deepEqual(payload.quote, signed);
  // A verify-only key still verifies quotes it signed (rotation step 2).
  const older = freshQuote("basic-wash", "S", { ...ring, activeKid: "q-2026b" });
  assert.equal(decode(older.quoteToken).kid, "q-2026b");
  assert.ok(ok(older));
});

test("changing any outer field or signed line field is rejected, even with consistent arithmetic", () => {
  const q = freshQuote();
  const line = q.lines[0];
  const other = "22222222-2222-4222-8222-222222222222";
  const mutations: [string, BookingQuote][] = [
    ["serviceId", { ...q, serviceId: bySlug(release, "basic-wash").id, lines: [{ ...line, serviceId: bySlug(release, "basic-wash").id }] }],
    ["vehicleCategoryId", { ...q, vehicleCategoryId: sizeId(release, "L") }],
    ["catalogReleaseId", { ...q, catalogReleaseId: other }],
    ["catalogFingerprint", { ...q, catalogFingerprint: "a".repeat(64) }],
    ["issuedAt and expiresAt", { ...q, issuedAt: new Date(NOW.getTime() + 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + 16 * 60_000).toISOString() }],
    ["offerId", { ...q, lines: [{ ...line, offerId: other }] }],
    ["name", { ...q, lines: [{ ...line, name: line.name + " Promo" }] }],
    ["addedMinutes and duration", { ...q, durationMinutes: 30, lines: [{ ...line, addedMinutes: 30 }] }],
    // Every price changed consistently: the schema accepts the arithmetic, the MAC does not.
    ["all prices", { ...q, totalPriceCentavos: 100, lines: [{ ...line, unitPriceCentavos: 100, subtotalCentavos: 100 }] }],
  ];
  for (const [label, mutated] of mutations) assert.equal(ok(mutated), false, label);
  // Shape-level tampering never reaches the MAC check.
  for (const [label, mutated] of [
    ["quantity", { ...q, quantity: 2 }],
    ["unit", { ...q, lines: [{ ...line, unit: "PANEL" }] }],
    ["subtotal", { ...q, lines: [{ ...line, subtotalCentavos: line.subtotalCentavos + 1 }] }],
    ["total", { ...q, totalPriceCentavos: q.totalPriceCentavos + 1 }],
    ["currency", { ...q, currency: "USD" }],
    ["version", { ...q, version: 1 }],
    ["algorithm", { ...q, pricingAlgorithm: "legacy-php-size-v1" }],
    ["add-on", { ...q, addOnServiceIds: [bySlug(release, "bac-to-zero").id] }],
    ["extra field", { ...q, discountCentavos: 0 }],
    ["missing token", { ...q, quoteToken: undefined }],
    ["estimate as quote", { kind: "QUOTE_REQUIRED", quote: null }],
  ] as [string, unknown][]) assert.equal(ok(mutated), false, label);
  // Uppercase IDs are the same quote (IDs are lowercased before binding).
  assert.equal(ok({ ...q, serviceId: q.serviceId.toUpperCase() }), true);
});

test("token parser: purpose, version, kid, framing, canonical JSON and algorithm are all exact", () => {
  const q = freshQuote();
  const [encoded, mac] = q.quoteToken.split(".");
  const text = Buffer.from(encoded, "base64url").toString("utf8");
  const payload = JSON.parse(text);
  const withToken = (token: string) => ({ ...q, quoteToken: token });
  // Sanity: re-signing the exact payload text is accepted.
  assert.equal(ok(withToken(forge(text))), true);
  const rejects: [string, string][] = [
    ["wrong purpose", forge(JSON.stringify({ ...payload, purpose: "BOOKING_MANAGEMENT" }))],
    ["v1 payload", forge(JSON.stringify({ ...payload, v: 1 }))],
    ["unknown kid", forge(JSON.stringify({ ...payload, kid: "q-retired" }))],
    ["kid not matching key", forge(text, ring.keys.get("q-2026b")!)],
    ["extra payload field", forge(JSON.stringify({ ...payload, admin: true }))],
    ["extra quote field", forge(JSON.stringify({ ...payload, quote: { ...payload.quote, note: "x" } }))],
    ["reordered keys", forge(JSON.stringify({ kid: payload.kid, v: 2, purpose: payload.purpose, quote: payload.quote }))],
    ["whitespace", forge(JSON.stringify(payload, null, 1))],
    ["duplicate key", forge(text.replace('"v":2,', '"v":2,"v":2,'))],
    ["escaped text", forge(text.replace('"BOOKING_QUOTE"', '"BOOKING_\\u0051UOTE"'))],
    ["HMAC-SHA512", forge(text, ring.keys.get("q-2026a")!, "sha512")],
    ["changed MAC", encoded + "." + (mac[0] === "A" ? "B" : "A") + mac.slice(1)],
    ["changed payload", Buffer.from(text.replace('"quantity":1', '"quantity":1 '), "utf8").toString("base64url") + "." + mac],
    ["padded base64url", encoded + "=." + mac],
    ["standard base64", Buffer.from(text).toString("base64") + "." + mac],
    ["three parts", q.quoteToken + ".x"],
    ["no MAC", encoded],
    ["empty MAC", encoded + "."],
    ["oversize", "a".repeat(4097)],
    ["not UTF-8", Buffer.from([0xff, 0xfe, 0x7b]).toString("base64url") + "." + mac],
    ["not JSON", forge("{")],
    ["array payload", forge("[]")],
  ];
  for (const [label, token] of rejects) assert.equal(ok(withToken(token)), false, label);
  // A key from another ring never verifies a quote (no ring fallback).
  const other = parseQuoteKeyRing({ BOOKING_QUOTE_KEYS: `q-2026a:${secret(9)}`, BOOKING_QUOTE_ACTIVE_KID: "q-2026a" });
  assert.equal(ok(q, NOW, other), false);
  // Retiring the kid ends every quote it signed.
  const retired = parseQuoteKeyRing({ BOOKING_QUOTE_KEYS: `q-2026b:${secret(2)}`, BOOKING_QUOTE_ACTIVE_KID: "q-2026b" });
  assert.equal(ok(q, NOW, retired), false);
});

test("time: exactly fifteen minutes, expiry edge, future issuedAt and malformed instants", () => {
  const q = freshQuote();
  const at = (ms: number) => verifyQuote(q, ring, new Date(NOW.getTime() + ms));
  const live = at(15 * 60_000 - 1);
  assert.ok(live.ok && !live.expired);
  const edge = at(15 * 60_000);
  assert.ok(edge.ok && edge.expired); // authentic but expired: QUOTE_EXPIRED, not a forgery
  // issuedAt more than one minute in the future is refused; exactly one minute is tolerated.
  const future = freshQuote("signature-wash", "M", ring, new Date(NOW.getTime() + 60_001));
  assert.equal(ok(future), false);
  assert.equal(ok(freshQuote("signature-wash", "M", ring, new Date(NOW.getTime() + 60_000))), true);
  // Malformed instants and a different TTL fail the shape check before any MAC work.
  for (const [issuedAt, expiresAt] of [["2026-10-18T02:00:00Z", "2026-10-18T02:15:00Z"], ["2026-10-18T02:00:00.000+08:00", q.expiresAt],
    [q.issuedAt, new Date(NOW.getTime() + 16 * 60_000).toISOString()], ["not a date", q.expiresAt]]) {
    assert.equal(ok({ ...q, issuedAt, expiresAt }), false, issuedAt);
  }
});

test("verification never logs tokens or quotes", () => {
  const seen: unknown[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const original = methods.map((m) => console[m]);
  methods.forEach((m) => { console[m] = (...args: unknown[]) => { seen.push(args); }; });
  try {
    const q = freshQuote();
    verifyQuote(q, ring, NOW);
    verifyQuote({ ...q, quoteToken: q.quoteToken.slice(0, -2) + "xx" }, ring, NOW);
    verifyQuote({ ...q, totalPriceCentavos: 1 }, ring, NOW);
  } finally {
    methods.forEach((m, i) => { console[m] = original[i]; });
  }
  assert.deepEqual(seen, []);
});

test("the BOOKING_QUOTE key ring is validated, and no message carries a secret", () => {
  const good = { BOOKING_QUOTE_KEYS: `a:${secret(1)}`, BOOKING_QUOTE_ACTIVE_KID: "a" };
  assert.doesNotThrow(() => parseQuoteKeyRing(good));
  const lowEntropy = Buffer.from(Array.from({ length: 32 }, (_, i) => i % 15)).toString("base64url");
  const cases: [string, Record<string, string | undefined>][] = [
    ["missing", {}],
    ["missing active", { BOOKING_QUOTE_KEYS: good.BOOKING_QUOTE_KEYS }],
    ["active not listed", { ...good, BOOKING_QUOTE_ACTIVE_KID: "b" }],
    ["four keys", { BOOKING_QUOTE_KEYS: [1, 2, 3, 4].map((n) => `k${n}:${secret(n)}`).join(","), BOOKING_QUOTE_ACTIVE_KID: "k1" }],
    ["bad kid", { BOOKING_QUOTE_KEYS: `Bad_Kid:${secret(1)}`, BOOKING_QUOTE_ACTIVE_KID: "Bad_Kid" }],
    ["long kid", { BOOKING_QUOTE_KEYS: `${"k".repeat(33)}:${secret(1)}`, BOOKING_QUOTE_ACTIVE_KID: "k".repeat(33) }],
    ["duplicate kid", { BOOKING_QUOTE_KEYS: `a:${secret(1)},a:${secret(2)}`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["duplicate secret", { BOOKING_QUOTE_KEYS: `a:${secret(1)},b:${secret(1)}`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["short secret", { BOOKING_QUOTE_KEYS: `a:${Buffer.alloc(31, 7).toString("base64url")}`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["long secret", { BOOKING_QUOTE_KEYS: `a:${Buffer.from(Array.from({ length: 65 }, (_, i) => i)).toString("base64url")}`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["padded secret", { BOOKING_QUOTE_KEYS: `a:${secret(1)}=`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["standard base64", { BOOKING_QUOTE_KEYS: `a:${Buffer.from(secret(1), "base64url").toString("base64").replace(/=+$/, "")}+/`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["low entropy", { BOOKING_QUOTE_KEYS: `a:${lowEntropy}`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["empty entry", { BOOKING_QUOTE_KEYS: `a:${secret(1)},`, BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["no colon", { BOOKING_QUOTE_KEYS: secret(1), BOOKING_QUOTE_ACTIVE_KID: "a" }],
    ["shared with grant ring", { ...good, MANAGEMENT_GRANT_KEYS: `g:${secret(1)}` }],
    ["shared with session ring", { ...good, MANAGEMENT_SESSION_KEYS: `s:${secret(5)},t:${secret(1)}` }],
    ["equals origin secret", { ...good, ORIGIN_AUTH_SECRET: secret(1) }],
  ];
  for (const [label, env] of cases) {
    assert.throws(() => parseQuoteKeyRing(env), (e: unknown) => e instanceof QuoteKeyRingError && !String((e as Error).message).includes(secret(1)), label);
  }
});

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { CreateDayBookingSchema, DayAvailabilitySchema } from "@/lib/validation";
import { bySlug, releaseFromManifest, sizeId } from "./catalog.fixture";
import { priceSelection } from "./catalog-pricing";
import { signQuote } from "./catalog-quote-token";
import { bookingRequestHash, legacyRequestHash } from "./bookings-hash";
import { grantExpiry, parseBookingConfiguration, signManagementToken, verifyManagementToken } from "./bookings-credentials";
const ring = { activeKid: "test", keys: new Map([["test", randomBytes(32)]]) };
const release = releaseFromManifest();
const selection = { vehicleCategoryId: sizeId(release, "S"), lines: [{ serviceId: bySlug(release, "basic-wash").id, quantity: 1 }] };
const priced = priceSelection(release, selection);
assert.equal(priced.kind, "QUOTED");
const quote = signQuote(priced.kind === "QUOTED" ? priced.quote : (null as never), ring, new Date());
const request = () => ({
    contractVersion: 4, idempotencyKey: randomUUID(), ...selection, bookingDate: "2026-11-02", acceptedQuote: quote, turnstileToken: "proof", customerName: "  Synthetic Customer ", customerPhone: "0917 123 4567", vehicleModel: "Test Car", vehiclePlate: " abc 123 "
});
test("day create strictly binds selection to signed quote and normalizes customer and UUID fields", () => {
    const p = CreateDayBookingSchema.parse(request());
    assert.equal(p.customerName, "Synthetic Customer");
    assert.equal(p.customerPhone, "+639171234567");
    assert.equal(p.vehiclePlate, "ABC 123");
    for (const bad of [
        { ...request(), contractVersion: 3 }, { ...request(), startTime: "08:00" }, { ...request(), queuePosition: 1 }, { ...request(), customerName: "A\nB" }, { ...request(), lines: [{ serviceId: randomUUID(), quantity: 1 }] }, { ...request(), lines: [{ ...selection.lines[0], quantity: "1" }] }
    ])
        assert.equal(CreateDayBookingSchema.safeParse(bad).success, false);
    assert.equal(DayAvailabilitySchema.safeParse({
        ...selection, fromDate: "2026-02-30", days: 14
    }).success, false);
    assert.equal(DayAvailabilitySchema.safeParse({
        ...selection, fromDate: "2026-11-02", days: 92
    }).success, false);
});
test("frozen create hash excludes only key/challenge and binds primary, quote and normalized PII", () => {
    const p = CreateDayBookingSchema.parse(request()), hash = bookingRequestHash(p);
    assert.equal(bookingRequestHash({
        ...p, idempotencyKey: randomUUID(), turnstileToken: "fresh"
    }), hash);
    assert.notEqual(bookingRequestHash({ ...p, customerName: "Different" }), hash);
    assert.notEqual(bookingRequestHash({ ...p, acceptedQuote: { ...p.acceptedQuote, quoteToken: "changed" } }), hash);
    assert.match(legacyRequestHash({
        idempotencyKey: randomUUID(), vehicleCategoryId: selection.vehicleCategoryId, serviceId: selection.lines[0].serviceId, bookingDate: "2026-11-02", startTime: "09:00", customerName: "Test", customerPhone: "+639171234567", vehicleModel: "Test"
    }), /^[a-f0-9]{64}$/);
});
const env = () => ({
    BOOKING_QUOTE_KEYS: "q:" + randomBytes(32).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID: "q", MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(32).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID: "g", MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(32).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID: "s", ONLINE_BOOKING_MODE: "OPEN", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_ALLOWED_HOSTNAMES: "localhost", APP_ORIGIN: "http://localhost:3000", NODE_ENV: "test"
});
test("three distinct rings, strict production challenge/origin settings, no fallback secrets", () => {
    const e = env();
    assert.ok(parseBookingConfiguration(e));
    for (const key of [
        "BOOKING_QUOTE_KEYS", "MANAGEMENT_GRANT_KEYS", "MANAGEMENT_SESSION_KEYS", "TURNSTILE_SECRET_KEY", "TURNSTILE_ALLOWED_HOSTNAMES", "APP_ORIGIN"
    ])
        assert.throws(() => parseBookingConfiguration({ ...e, [key]: "" }), key);
    assert.throws(() => parseBookingConfiguration({ ...e, MANAGEMENT_SESSION_KEYS: "s:" + e.MANAGEMENT_GRANT_KEYS.slice(2) }));
    assert.throws(() => parseBookingConfiguration({ ...e, NODE_ENV: "production" }));
});
test("day grant expiry, purpose separation and transitive grant-key retirement", () => {
    const c = parseBookingConfiguration(env()), now = new Date("2026-10-18T00:00:00Z");
    assert.equal(grantExpiry(now, new Date("2026-10-20T16:00:00Z"), null).toISOString(), "2026-10-21T16:00:00.000Z");
    assert.equal(grantExpiry(now, new Date("2027-01-01T16:00:00Z"), null).toISOString(), "2026-11-17T00:00:00.000Z");
    const claims = {
        id: randomUUID(), bookingId: randomUUID(), credentialVersion: 1, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(), grantKid: c.grant.activeKid
    };
    const grant = signManagementToken("BOOKING_MANAGEMENT", claims, c.grant);
    assert.ok(verifyManagementToken(grant, "BOOKING_MANAGEMENT", c, now));
    assert.equal(verifyManagementToken(grant, "BOOKING_MANAGEMENT_SESSION", c, now), null);
    const session = signManagementToken("BOOKING_MANAGEMENT_SESSION", claims, c.session);
    assert.ok(verifyManagementToken(session, "BOOKING_MANAGEMENT_SESSION", c, now));
    assert.equal(verifyManagementToken(session, "BOOKING_MANAGEMENT_SESSION", { ...c, grant: { ...c.grant, keys: new Map() } }, now), null);
    assert.equal(verifyManagementToken(session, "BOOKING_MANAGEMENT_SESSION", c, new Date(claims.expiresAt)), null);
    assert.equal(verifyManagementToken(session + "x", "BOOKING_MANAGEMENT_SESSION", c, now), null);
});
test("management token claims match the frozen flat ARCHITECTURE contract",()=>{
 const now=new Date(),claims={id:randomUUID(),bookingId:randomUUID(),credentialVersion:1,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),grantKid:ring.activeKid};
 for(const purpose of ["BOOKING_MANAGEMENT","BOOKING_MANAGEMENT_SESSION"] as const){
  const token=signManagementToken(purpose,claims,ring),payload=JSON.parse(Buffer.from(token.split(".")[0],"base64url").toString("utf8"));
  assert.equal(payload.aud,"booking-management");assert.equal(payload.bookingId,claims.bookingId);assert.equal(payload.purpose,purpose);
  assert.equal("claims" in payload,false);assert.equal("id" in payload,false);assert.equal("audience" in payload,false);
  assert.equal("grantKid" in payload,purpose==="BOOKING_MANAGEMENT_SESSION");
 }
});

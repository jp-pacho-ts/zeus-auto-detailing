import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { bookingQuoteGet } from "./bookings-http";
test("quote transport throttling is a 429 read error with a matching Retry-After envelope", async () => {
    for (const [name, kid] of [["BOOKING_QUOTE", "q"], ["MANAGEMENT_GRANT", "g"], ["MANAGEMENT_SESSION", "s"]]) {
        process.env[name + "_KEYS"] = kid + ":" + randomBytes(48).toString("base64url");
        process.env[name + "_ACTIVE_KID"] = kid;
    }
    Object.assign(process.env, { NODE_ENV: "test", APP_ORIGIN: "http://localhost", ONLINE_BOOKING_MODE: "OPEN", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_ALLOWED_HOSTNAMES: "localhost", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1" });
    let response: Response | undefined;
    for (let i = 0; i < 61; i++)
        response = await bookingQuoteGet(new Request("http://localhost/api/bookings/quote?invalid=1", { headers: { "x-forwarded-for": "spoofed, 192.0.2.201" } }));
    assert.equal(response!.status, 429);
    const body = await response!.json();
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(body.error.commitState, "NOT_APPLICABLE");
    assert.equal(response!.headers.get("retry-after"), String(body.error.retryAfterSeconds));
});

// Same-origin, Fetch Metadata, JSON and body-size rules for unsafe /api/admin methods,
// session token/cookie rules and production pool configuration (no database needed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStaffDbConfiguration, StaffDbConfigError } from "./startup";
import { StaffAuthError } from "./errors";
import { checkSameOrigin, readAdminJson } from "./http";
import { generateSessionToken, hashSessionToken, isWellFormedSessionToken, sessionCookieAttributes, staffSessionCookieName } from "./session";

const ORIGIN = "http://localhost:3000";
const req = (headers: Record<string, string>, body?: string) =>
  new Request("http://localhost:3000/api/admin/auth/login", { method: "POST", headers, body });
const forbidden = (e: unknown) => e instanceof StaffAuthError && e.code === "FORBIDDEN";

test("Origin must be present and exactly APP_ORIGIN; Sec-Fetch-Site must be same-origin", () => {
  assert.doesNotThrow(() => checkSameOrigin(req({ origin: ORIGIN }), { APP_ORIGIN: ORIGIN }));
  assert.doesNotThrow(() => checkSameOrigin(req({ origin: ORIGIN, "sec-fetch-site": "same-origin" }), { APP_ORIGIN: ORIGIN }));
  const rejected: Record<string, string>[] = [{}, { origin: "null" }, { origin: "https://evil.example" }, { origin: ORIGIN + "/" },
    { origin: "http://localhost:3001" }, { origin: ORIGIN, "sec-fetch-site": "cross-site" }, { origin: ORIGIN, "sec-fetch-site": "same-site" }];
  for (const headers of rejected) {
    assert.throws(() => checkSameOrigin(req(headers), { APP_ORIGIN: ORIGIN }), forbidden, JSON.stringify(headers));
  }
  // A missing or malformed APP_ORIGIN fails closed.
  for (const env of [{}, { APP_ORIGIN: "" }, { APP_ORIGIN: "localhost:3000" }, { APP_ORIGIN: ORIGIN + "/" }, { APP_ORIGIN: ORIGIN + "/admin" }]) {
    assert.throws(() => checkSameOrigin(req({ origin: ORIGIN }), env), forbidden, JSON.stringify(env));
  }
});

test("bodies must be JSON and at most 16 KiB; an empty body is allowed only where stated", async () => {
  assert.deepEqual(await readAdminJson(req({ "content-type": "application/json" }, '{"a":1}')), { a: 1 });
  assert.deepEqual(await readAdminJson(req({ "content-type": "application/json; charset=utf-8" }, '{"a":1}')), { a: 1 });
  assert.equal(await readAdminJson(req({}), { allowEmpty: true }), null);
  await assert.rejects(readAdminJson(req({})), (e) => e instanceof StaffAuthError && e.code === "VALIDATION_ERROR");
  await assert.rejects(readAdminJson(req({ "content-type": "text/plain" }, '{"a":1}')), forbidden);
  await assert.rejects(readAdminJson(req({ "content-type": "application/x-www-form-urlencoded" }, "a=1"), { allowEmpty: true }), forbidden);
  await assert.rejects(readAdminJson(req({ "content-type": "application/json" }, "x".repeat(16385))), forbidden);
  assert.ok(await readAdminJson(req({ "content-type": "application/json" }, JSON.stringify({ p: "x".repeat(16370) }))));
  await assert.rejects(readAdminJson(req({ "content-type": "application/json" }, "{not json")), (e) => e instanceof StaffAuthError && e.code === "VALIDATION_ERROR");
});

test("session tokens are 32 random bytes in base64url and stored only as SHA-256 hex", () => {
  const a = generateSessionToken(), b = generateSessionToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.match(hashSessionToken(a), /^[0-9a-f]{64}$/);
  assert.equal(isWellFormedSessionToken(a), true);
  for (const bad of [undefined, null, "", a.slice(1), a + "A", a.slice(0, 42) + "=", a.slice(0, 42) + "/"]) {
    assert.equal(isWellFormedSessionToken(bad), false);
  }
});

test("cookie: __Host- and Secure in production; the plain name only for loopback HTTP development", () => {
  const prod = { NODE_ENV: "production", APP_ORIGIN: "https://zeus.example" };
  assert.equal(staffSessionCookieName(prod), "__Host-zeus-staff-session");
  assert.deepEqual(sessionCookieAttributes(3600, prod), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
  // Production never falls back, even on a loopback origin.
  assert.equal(staffSessionCookieName({ NODE_ENV: "production", APP_ORIGIN: "http://localhost:3000" }), "__Host-zeus-staff-session");
  const dev = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:3000" };
  assert.equal(staffSessionCookieName(dev), "zeus-staff-session");
  assert.equal(sessionCookieAttributes(60, dev).secure, false);
  assert.equal(staffSessionCookieName({ NODE_ENV: "development", APP_ORIGIN: "http://127.0.0.1:3000" }), "zeus-staff-session");
  assert.equal(staffSessionCookieName({ NODE_ENV: "development", APP_ORIGIN: "https://localhost:3000" }), "__Host-zeus-staff-session");
  assert.equal(staffSessionCookieName({ NODE_ENV: "development", APP_ORIGIN: "http://192.168.1.5:3000" }), "__Host-zeus-staff-session");
});

test("production refuses staff database work without the pool settings", () => {
  const ok = "postgresql://u:p@db.internal:5432/zeus?connection_limit=32&pool_timeout=2";
  assert.doesNotThrow(() => checkStaffDbConfiguration(ok, "production"));
  assert.doesNotThrow(() => checkStaffDbConfiguration("postgresql://u@localhost/zeus", "development"));
  for (const url of [undefined, "not a url", "postgresql://u:p@db/zeus", "postgresql://u:p@db/zeus?connection_limit=31&pool_timeout=2",
    "postgresql://u:p@db/zeus?connection_limit=32", "postgresql://u:p@db/zeus?connection_limit=32&pool_timeout=10",
    "postgresql://u:p@db/zeus?connection_limit=3.2e1&pool_timeout=2", "postgresql://u:p@db/zeus?connection_limit=-40&pool_timeout=2"]) {
    assert.throws(() => checkStaffDbConfiguration(url, "production"), (e) => e instanceof StaffDbConfigError && !String(e.message).includes("u:p"), String(url));
  }
});

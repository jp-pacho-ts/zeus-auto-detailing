// P1-42 maintenance mode: which paths close, what they answer, and that every failure keeps the site live. No network, no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE, cachedFor, maintenancePage, maintenanceResponse, maintenanceTarget, parseSiteState } from "./maintenance";

const ON = { maintenance: true, message: "Back soon." };

test("the customer pages and customer APIs close", () => {
  for (const page of ["/", "/book", "/book/manage", "/book/manage/x"]) assert.equal(maintenanceTarget(page), "PAGE", page);
  for (const api of ["/api/bookings", "/api/bookings/quote", "/api/bookings/manage/lookup", "/api/availability", "/api/catalog"]) assert.equal(maintenanceTarget(api), "API", api);
});

test("the admin, sign-in, the state itself and static files never close, including look-alikes", () => {
  for (const open of ["/admin", "/admin/login", "/admin/settings", "/api/admin", "/api/admin/auth/login", "/api/admin/settings", "/api/site-state", "/_next/static/a.js", "/images/logo.png", "/icon.svg",
    "/administrator", "/bookings", "/booking", "/book2", "/api/bookingsx", "/api/catalogue", "/api/availability2", "/admin/../book", "//book", "/api/admin/../bookings"]) {
    assert.equal(maintenanceTarget(open), null, open);
  }
});

test("while on, a page answers 503 with a plain page and an API answers 503 with the booking error shape; neither may be cached", () => {
  const page = maintenanceResponse("/", ON, false)!;
  assert.equal(page.status, 503);
  assert.deepEqual([page.headers["Retry-After"], page.headers["Cache-Control"], page.headers["Content-Type"]], ["600", "no-store", "text/html; charset=utf-8"]);
  assert.match(page.body, /Back soon\./);
  const api = maintenanceResponse("/api/bookings", ON, false)!;
  assert.equal(api.status, 503);
  assert.deepEqual([api.headers["Retry-After"], api.headers["Cache-Control"], api.headers["Content-Type"]], ["600", "no-store", "application/json"]);
  const error = JSON.parse(api.body);
  assert.equal(error.ok, false);
  assert.equal(error.error.code, "ONLINE_BOOKING_UNAVAILABLE");
  assert.equal(error.error.commitState, "NOT_COMMITTED", "nothing was saved");
  assert.equal(error.error.retryable, true);
  assert.match(error.error.message, /maintenance.*call/i);
});

test("nothing closes when the site is live, on an open path, or when the emergency switch is on", () => {
  assert.equal(maintenanceResponse("/", LIVE, false), null);
  assert.equal(maintenanceResponse("/admin", ON, false), null);
  assert.equal(maintenanceResponse("/api/admin/settings", ON, false), null);
  assert.equal(maintenanceResponse("/", ON, true), null, "MAINTENANCE_FORCE_OFF");
});

test("the page names the shop and its phone, escapes the message, and loads nothing else", () => {
  const html = maintenancePage(`<script>alert("x")</script> & 'more'`);
  assert.match(html, /Zeus Auto Detailing/);
  assert.match(html, /0930 016 2234/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;more&#39;/);
  assert.doesNotMatch(html, /\bsrc=|\bhref="http|url\(/);
  assert.doesNotMatch(maintenancePage(null), /null|undefined/);
});

test("a bad answer is refused, so the caller stays live", () => {
  assert.deepEqual(parseSiteState({ maintenance: true, message: "x" }), { maintenance: true, message: "x" });
  assert.deepEqual(parseSiteState({ maintenance: false, message: null }), LIVE);
  for (const bad of [null, "on", {}, { maintenance: "true", message: null }, { maintenance: true }, { maintenance: true, message: 3 }]) assert.throws(() => parseSiteState(bad));
});

test("the cache holds one answer for its time, shares one read, and refreshes after", async () => {
  let t = 1_000, reads = 0;
  const read = cachedFor(async () => { reads++; return ON; }, 3_000, () => t);
  assert.deepEqual(await Promise.all([read(), read(), read()]), [ON, ON, ON]);
  assert.equal(reads, 1, "one read for all");
  t += 2_999;
  await read();
  assert.equal(reads, 1, "still inside its time");
  t += 1;
  await read();
  assert.equal(reads, 2, "refreshed");
});

test("any failure means live: the site is never taken down by its own check, and the failure is not retried on every request", async () => {
  let t = 0, reads = 0, fail = true;
  const read = cachedFor(async () => { reads++; if (fail) throw new Error("database down"); return ON; }, 3_000, () => t);
  assert.deepEqual(await read(), LIVE);
  assert.deepEqual(await read(), LIVE);
  assert.equal(reads, 1);
  fail = false;
  t = 3_000;
  assert.deepEqual(await read(), ON, "recovers by itself");
});

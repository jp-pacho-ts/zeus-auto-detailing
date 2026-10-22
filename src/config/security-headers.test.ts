import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { documentContentSecurityPolicy, securityHeaders } from "./security-headers.mjs";

// P1-12 A8 (Codex review, exact launch policy): every response gets framing, sniffing and referrer
// headers, plus HSTS in production only; HTML documents get one CSP, while /api routes keep the
// stricter headers they set themselves (proof images, no-store JSON).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (p: string) => RegExp };
type Rule = { source: string; headers: { key: string; value: string }[] };
const headerMap = (rule: Rule) => Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
const matching = (rules: Rule[], url: string) => rules.filter((r) => pathToRegexp(r.source).test(url));
const DOCUMENT_CSP_PRODUCTION =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

test("production: HSTS without subdomains or preload, deny framing, nosniff, no referrer, and the exact document CSP", () => {
  const rules = securityHeaders(true) as Rule[];
  const everywhere = headerMap(matching(rules, "/api/bookings/manage")[0]);
  assert.deepEqual(everywhere, {
    "Strict-Transport-Security": "max-age=31536000",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  assert.equal(documentContentSecurityPolicy(true), DOCUMENT_CSP_PRODUCTION);
  for (const page of ["/", "/book", "/book/manage", "/admin", "/admin/login", "/admin/bookings", "/no-such-page"]) {
    const applied = Object.assign({}, ...matching(rules, page).map(headerMap));
    assert.equal(applied["Content-Security-Policy"], DOCUMENT_CSP_PRODUCTION, page);
    assert.equal(applied["X-Frame-Options"], "DENY", page);
    assert.equal(applied["Strict-Transport-Security"], "max-age=31536000", page);
  }
});

test("API routes keep their own stricter headers: no document CSP is added under /api", () => {
  const rules = securityHeaders(true) as Rule[];
  for (const api of ["/api/catalog", "/api/bookings/manage", "/api/bookings/manage/deposit-proofs", "/api/admin/bookings/x/deposit-proofs/y"]) {
    const applied = Object.assign({}, ...matching(rules, api).map(headerMap));
    assert.equal(applied["Content-Security-Policy"], undefined, api);
    assert.equal(applied["X-Frame-Options"], "DENY", api);
    assert.equal(applied["X-Content-Type-Options"], "nosniff", api);
  }
});

test("outside production (loopback http): no HSTS and no upgrade-insecure-requests; the rest is the same", () => {
  const rules = securityHeaders(false) as Rule[];
  const applied = Object.assign({}, ...matching(rules, "/book").map(headerMap));
  assert.equal(applied["Strict-Transport-Security"], undefined);
  assert.equal(applied["Content-Security-Policy"], DOCUMENT_CSP_PRODUCTION.replace("; upgrade-insecure-requests", ""));
  assert.equal(applied["X-Frame-Options"], "DENY");
  assert.equal(applied["Referrer-Policy"], "no-referrer");
});

test("next.config.mjs serves these headers, chosen by NODE_ENV at the time Next reads them", async () => {
  const config = (await import(path.join(process.cwd(), "next.config.mjs"))).default as { headers: () => Promise<Rule[]>; poweredByHeader: boolean };
  const saved = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  try {
    env.NODE_ENV = "production";
    assert.deepEqual(await config.headers(), securityHeaders(true));
    env.NODE_ENV = "development";
    assert.deepEqual(await config.headers(), securityHeaders(false));
  } finally {
    env.NODE_ENV = saved;
  }
  assert.equal(config.poweredByHeader, false);
});

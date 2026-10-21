// P1-10 M3: the catalog route's per-client limit (rateLimit) used to refuse every new client once
// 5,000 keys were live, for as long as the flood went on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "./errors";
import { rateLimit } from "./http";

process.env.CLIENT_IP_SOURCE = "PROXY_HOPS";
process.env.TRUSTED_PROXY_HOPS = "1";
const from = (address: string) => new Headers({ "x-forwarded-for": address });
const limited = (fn: () => void) => { try { fn(); return false; } catch (e) { if (e instanceof DomainError && e.code === "RATE_LIMITED") return true; throw e; } };

test("rateLimit keeps 60 a minute per client", () => {
  for (let i = 0; i < 60; i++) assert.equal(limited(() => rateLimit(from("198.51.100.7"), "catalog-test", 60)), false);
  assert.equal(limited(() => rateLimit(from("198.51.100.7"), "catalog-test", 60)), true);
  assert.equal(limited(() => rateLimit(from("198.51.100.8"), "catalog-test", 60)), false);
});

test("rateLimit never locks out a new client after 10,000+ distinct clients", () => {
  for (let i = 0; i < 12_000; i++) {
    const address = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
    assert.equal(limited(() => rateLimit(from(address), "catalog", 60)), false, "client " + i + " refused");
  }
  assert.equal(limited(() => rateLimit(from("192.0.2.200"), "catalog", 60)), false);
});

// Codex F1 (PM ruling 2026-10-21): other clients can never reset a client's count.
test("rateLimit: a limited client stays limited through a flood of 100,000 other clients", () => {
  for (let i = 0; i < 60; i++) assert.equal(limited(() => rateLimit(from("198.51.100.9"), "catalog-flood", 60)), false);
  assert.equal(limited(() => rateLimit(from("198.51.100.9"), "catalog-flood", 60)), true);
  for (let i = 0; i < 100_000; i++) limited(() => rateLimit(from(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`), "catalog-flood", 60));
  assert.equal(limited(() => rateLimit(from("198.51.100.9"), "catalog-flood", 60)), true, "the victim's count survived");
});

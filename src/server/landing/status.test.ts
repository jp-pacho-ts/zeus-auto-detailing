import test from "node:test";
import assert from "node:assert/strict";
import { resolveLandingStatus } from "./status";
test("known environment pause never opens the database", async () => {
  let reads = 0; assert.equal(await resolveLandingStatus("PAUSED", async () => { reads++; throw Error(); }), "PAUSED"); assert.equal(reads, 0);
});
test("database pause wins; a failed read is UNKNOWN, not OPEN", async () => {
  assert.equal(await resolveLandingStatus("OPEN", async () => true), "PAUSED");
  assert.equal(await resolveLandingStatus("OPEN", async () => false), "OPEN");
  assert.equal(await resolveLandingStatus("OPEN", async () => { throw Error(); }), "UNKNOWN");
});

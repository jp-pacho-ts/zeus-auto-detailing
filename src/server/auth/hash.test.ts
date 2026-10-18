// argon2id at ARGON2ID_MIN_PARAMS, PHC parameters parsed on every verification.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hash as rawHash, parseOptions } from "@node-rs/argon2";
import { dummyPasswordHash, hashStaffPassword, needsRehash, verifyStaffPassword } from "./hash";

test("hashes are argon2id PHC strings at the configured minimum parameters", async () => {
  const phc = await hashStaffPassword("plum orbit lantern seventy");
  assert.match(phc, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  const parsed = parseOptions(phc);
  assert.equal(parsed.saltLen, 16);
  assert.equal(parsed.outputLen, 32);
  assert.notEqual(await hashStaffPassword("plum orbit lantern seventy"), phc); // fresh salt
  assert.equal(needsRehash(phc), false);
});

test("verification uses the UTF-8 bytes of the NFC string and never throws", async () => {
  const phc = await hashStaffPassword("Café crème brûlée".normalize("NFC"));
  assert.equal(await verifyStaffPassword(phc, "Café crème brûlée".normalize("NFC")), true);
  assert.equal(await verifyStaffPassword(phc, "Café crème brûlée".normalize("NFD")), false); // callers normalize first
  assert.equal(await verifyStaffPassword(phc, "cafe creme brulee"), false);
  assert.equal(await verifyStaffPassword("not-a-phc-string", "x"), false);
  assert.equal(await verifyStaffPassword("", "x"), false);
});

test("weaker stored parameters need a rehash; the dummy hash matches the current cost", async () => {
  const weak = await rawHash("plum orbit lantern seventy", { memoryCost: 4096, timeCost: 1, parallelism: 1 });
  assert.equal(needsRehash(weak), true);
  assert.equal(await verifyStaffPassword(weak, "plum orbit lantern seventy"), true); // parameters come from the PHC
  assert.equal(needsRehash("garbage"), true);
  const dummy = await dummyPasswordHash();
  assert.equal(dummy, await dummyPasswordHash()); // once per process
  assert.equal(needsRehash(dummy), false);
});

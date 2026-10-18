import "server-only";
import { randomBytes } from "node:crypto";
import { hash, parseOptions, verify, type Algorithm } from "@node-rs/argon2";
import { ARGON2ID_MIN_PARAMS as P } from "./policy";

// @node-rs/argon2 declares Algorithm as an ambient const enum (not usable with isolatedModules).
const ARGON2ID = 2 as Algorithm;
const ARGON2_VERSION_0x13 = 1;

// The argument is already NFC-normalized; the hash input is its UTF-8 encoding.
export function hashStaffPassword(normalized: string): Promise<string> {
  return hash(Buffer.from(normalized, "utf8"), {
    algorithm: ARGON2ID, memoryCost: P.memoryKiB, timeCost: P.iterations,
    parallelism: P.parallelism, outputLen: P.hashBytes, salt: randomBytes(P.saltBytes),
  });
}

// Parameters are parsed from the stored PHC string. A malformed hash never verifies.
export async function verifyStaffPassword(phc: string, normalized: string): Promise<boolean> {
  try { return await verify(phc, Buffer.from(normalized, "utf8")); } catch { return false; }
}

export function needsRehash(phc: string): boolean {
  try {
    const o = parseOptions(phc);
    return o.algorithm !== ARGON2ID || o.version !== ARGON2_VERSION_0x13 || o.memoryCost < P.memoryKiB
      || o.timeCost < P.iterations || o.outputLen < P.hashBytes || o.saltLen < P.saltBytes;
  } catch { return true; }
}

// Unknown and credential-less logins verify against this, so every admitted attempt
// pays one comparable argon2id verification (S-02). Created once per process.
let dummy: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashStaffPassword(randomBytes(32).toString("base64url"));
  return dummy;
}

import "server-only";
import { createHmac } from "node:crypto";

// HISTORY_LOOKUP key ring (ADR-005 §16a; PM decisions Q1, D7, D9): the same rules as P1-02's
// BOOKING_QUOTE ring, copied here and consolidated in P1-10. The key never reaches the database,
// logs, responses or evidence. The audit row stores only the keyed digest; to investigate a
// number, recompute it under each listed key. Retiring a kid makes older digests unlinkable.
//   HISTORY_LOOKUP_KEYS=kid:secret[,kid:secret] (at most 3), HISTORY_LOOKUP_ACTIVE_KID=kid
// Rotation: add the new kid, deploy, switch the active kid, drop the old kid after retention.
export interface HistoryKeyRing { activeKid: string; keys: ReadonlyMap<string, Buffer> }
export class HistoryKeyRingError extends Error {}

const KID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const OTHER_RINGS = ["BOOKING_QUOTE_KEYS", "MANAGEMENT_GRANT_KEYS", "MANAGEMENT_SESSION_KEYS"];
const canonical = (text: string) => BASE64URL.test(text) && Buffer.from(text, "base64url").toString("base64url") === text;

export function parseHistoryKeyRing(env: Record<string, string | undefined> = process.env): HistoryKeyRing {
  const raw = env.HISTORY_LOOKUP_KEYS;
  if (!raw) throw new HistoryKeyRingError("HISTORY_LOOKUP_KEYS is required");
  const entries = raw.split(",");
  if (entries.length > 3) throw new HistoryKeyRingError("HISTORY_LOOKUP_KEYS lists more than 3 keys");
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const kid = entry.slice(0, colon), value = entry.slice(colon + 1);
    if (colon < 1 || !KID.test(kid)) throw new HistoryKeyRingError("HISTORY_LOOKUP_KEYS has a malformed entry or kid");
    if (keys.has(kid)) throw new HistoryKeyRingError(`HISTORY_LOOKUP_KEYS lists kid ${kid} twice`);
    const secret = canonical(value) ? Buffer.from(value, "base64url") : null;
    if (!secret || secret.length < 32 || secret.length > 64) throw new HistoryKeyRingError(`HISTORY_LOOKUP_KEYS secret for ${kid} must be unpadded base64url of 32-64 bytes`);
    if (new Set(secret).size < 16) throw new HistoryKeyRingError(`HISTORY_LOOKUP_KEYS secret for ${kid} is not random enough`);
    if ([...keys.values()].some((k) => k.equals(secret))) throw new HistoryKeyRingError(`HISTORY_LOOKUP_KEYS repeats a secret (${kid})`);
    keys.set(kid, secret);
  }
  const active = env.HISTORY_LOOKUP_ACTIVE_KID;
  if (!active || !keys.has(active)) throw new HistoryKeyRingError("HISTORY_LOOKUP_ACTIVE_KID must name a listed kid");
  const elsewhere = [...OTHER_RINGS.flatMap((name) => (env[name] ?? "").split(",").map((e) => e.slice(e.indexOf(":") + 1))), env.ORIGIN_AUTH_SECRET ?? ""]
    .filter((v) => v.length > 0).map((v) => Buffer.from(v, "base64url"));
  if (elsewhere.some((other) => [...keys.values()].some((k) => k.equals(other)))) {
    throw new HistoryKeyRingError("A HISTORY_LOOKUP secret is reused by another ring or ORIGIN_AUTH_SECRET");
  }
  return { activeKid: active, keys };
}

// Validated on first use and cached; a refusal stays a refusal (D7: fail closed until startup wiring).
let processRing: HistoryKeyRing | HistoryKeyRingError | undefined;
export function historyKeyRing(): HistoryKeyRing | null {
  if (processRing === undefined) {
    try { processRing = parseHistoryKeyRing(process.env); } catch (error) {
      processRing = error instanceof HistoryKeyRingError ? error : new HistoryKeyRingError("HISTORY_LOOKUP key ring is invalid");
    }
  }
  return processRing instanceof HistoryKeyRingError ? null : processRing;
}

// HMAC-SHA256 under the active key, domain separated. A malformed input (no normalized phone)
// gets its own prefix so it is still audited without ever matching a real number (D8).
export function historyDigest(ring: HistoryKeyRing, normalizedPhone: string | null, rawInput = ""): string {
  const message = normalizedPhone !== null ? `zeus.history-lookup.v1\u0000${normalizedPhone}` : `zeus.history-lookup.v1\u0000invalid\u0000${rawInput.trim().slice(0, 64)}`;
  return createHmac("sha256", ring.keys.get(ring.activeKid)!).update(message, "utf8").digest("hex");
}

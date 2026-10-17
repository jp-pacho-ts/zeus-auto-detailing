import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { BookingQuoteSchema, type BookingQuote, type QuotedLine } from "@/types/catalog-contracts";
import type { UnsignedQuote } from "./catalog-pricing";

// Booking quote v2 tokens (ARCHITECTURE T-042 "Transport, tamper evidence and exact acceptance"):
// base64url(payload UTF-8 JSON) + "." + base64url(HMAC-SHA256(BOOKING_QUOTE[kid], payloadEncoded)),
// payload {v:2,kid,purpose:"BOOKING_QUOTE",quote:<every BookingQuote field but quoteToken>}.
// A quote carries no authority of its own: create recomputes it from the current release.

export const QUOTE_TTL_MS = 15 * 60_000;
export const QUOTE_CLOCK_TOLERANCE_MS = 60_000;
const KID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_KEYS = 3;

export interface QuoteKeyRing { activeKid: string; keys: ReadonlyMap<string, Buffer> }
export class QuoteKeyRingError extends Error {}

const canonicalBase64url = (text: string) => BASE64URL.test(text) && Buffer.from(text, "base64url").toString("base64url") === text;

// Key-ring rules (ARCHITECTURE "Key-ring operations"): at most three kid:secret entries, the
// active kid listed, secrets unpadded base64url of 32-64 bytes with 16+ distinct byte values,
// never repeated within or across rings or as ORIGIN_AUTH_SECRET. Messages name no secret.
export function parseQuoteKeyRing(env: Record<string, string | undefined> = process.env): QuoteKeyRing {
  const raw = env.BOOKING_QUOTE_KEYS;
  if (!raw) throw new QuoteKeyRingError("BOOKING_QUOTE_KEYS is required");
  const entries = raw.split(",");
  if (entries.length > MAX_KEYS) throw new QuoteKeyRingError(`BOOKING_QUOTE_KEYS lists more than ${MAX_KEYS} keys`);
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const kid = entry.slice(0, colon), value = entry.slice(colon + 1);
    if (colon < 1 || !KID.test(kid)) throw new QuoteKeyRingError("BOOKING_QUOTE_KEYS has a malformed entry or kid");
    if (keys.has(kid)) throw new QuoteKeyRingError(`BOOKING_QUOTE_KEYS lists kid ${kid} twice`);
    const secret = canonicalBase64url(value) ? Buffer.from(value, "base64url") : null;
    if (!secret || secret.length < 32 || secret.length > 64) throw new QuoteKeyRingError(`BOOKING_QUOTE_KEYS secret for ${kid} must be unpadded base64url of 32-64 bytes`);
    if (new Set(secret).size < 16) throw new QuoteKeyRingError(`BOOKING_QUOTE_KEYS secret for ${kid} is not random enough`);
    if ([...keys.values()].some((k) => k.equals(secret))) throw new QuoteKeyRingError(`BOOKING_QUOTE_KEYS repeats a secret (${kid})`);
    keys.set(kid, secret);
  }
  const active = env.BOOKING_QUOTE_ACTIVE_KID;
  if (!active || !keys.has(active)) throw new QuoteKeyRingError("BOOKING_QUOTE_ACTIVE_KID must name a listed kid");
  const elsewhere = [
    ...[env.MANAGEMENT_GRANT_KEYS, env.MANAGEMENT_SESSION_KEYS].flatMap((list) => (list ?? "").split(",").map((e) => e.slice(e.indexOf(":") + 1))),
    env.ORIGIN_AUTH_SECRET ?? "",
  ].filter((value) => value.length > 0).map((value) => Buffer.from(value, "base64url"));
  if (elsewhere.some((other) => [...keys.values()].some((k) => k.equals(other)))) {
    throw new QuoteKeyRingError("A BOOKING_QUOTE secret is reused by another ring or ORIGIN_AUTH_SECRET");
  }
  return { activeKid: active, keys };
}

// The process ring, validated on first use and cached (a refusal stays a refusal).
let processRing: QuoteKeyRing | QuoteKeyRingError | undefined;
export function quoteKeyRing(): QuoteKeyRing {
  if (processRing === undefined) {
    try { processRing = parseQuoteKeyRing(process.env); } catch (error) {
      processRing = error instanceof QuoteKeyRingError ? error : new QuoteKeyRingError("BOOKING_QUOTE key ring is invalid");
    }
  }
  if (processRing instanceof QuoteKeyRingError) throw processRing;
  return processRing;
}

type QuoteFields = Omit<BookingQuote, "quoteToken">;
const orderedLine = (l: QuotedLine) => ({ kind: l.kind, serviceId: l.serviceId, offerId: l.offerId, name: l.name, unit: l.unit,
  quantity: l.quantity, unitPriceCentavos: l.unitPriceCentavos, subtotalCentavos: l.subtotalCentavos, addedMinutes: l.addedMinutes });
// The schema's field order, and only its fields: anything else is dropped and so fails comparison.
const orderedQuote = (q: QuoteFields): QuoteFields => ({
  serviceId: q.serviceId, vehicleCategoryId: q.vehicleCategoryId, quantity: q.quantity,
  addOnServiceIds: Array.isArray(q.addOnServiceIds) ? [...q.addOnServiceIds] : q.addOnServiceIds,
  version: q.version, catalogReleaseId: q.catalogReleaseId, catalogFingerprint: q.catalogFingerprint, pricingAlgorithm: q.pricingAlgorithm,
  lines: Array.isArray(q.lines) ? q.lines.map((l) => (l && typeof l === "object" ? orderedLine(l) : l)) : q.lines,
  totalPriceCentavos: q.totalPriceCentavos, durationMinutes: q.durationMinutes, currency: q.currency, issuedAt: q.issuedAt, expiresAt: q.expiresAt,
});
const payloadText = (kid: string, quote: QuoteFields) => JSON.stringify({ v: 2, kid, purpose: "BOOKING_QUOTE", quote: orderedQuote(quote) });
const mac = (key: Buffer, encoded: string) => createHmac("sha256", key).update(encoded, "ascii").digest();

export function signQuote(body: UnsignedQuote, ring: QuoteKeyRing, now: Date): BookingQuote {
  const fields: QuoteFields = { ...body, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString() };
  const encoded = Buffer.from(payloadText(ring.activeKid, fields), "utf8").toString("base64url");
  const key = ring.keys.get(ring.activeKid);
  if (!key) throw new QuoteKeyRingError("BOOKING_QUOTE_ACTIVE_KID must name a listed kid");
  return { ...orderedQuote(fields), quoteToken: `${encoded}.${mac(key, encoded).toString("base64url")}` };
}

export type VerifiedQuote = { ok: true; quote: BookingQuote; expired: boolean } | { ok: false };
const INVALID: VerifiedQuote = { ok: false };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// Authenticates a quote presented by a client. Ok only if the MAC is valid under a listed kid,
// the payload is the exact canonical serialization, and every outer field equals the signed
// data; expired is reported separately (QUOTE_EXPIRED is not a forgery). Never logs.
export function verifyQuote(candidate: unknown, ring: QuoteKeyRing, now: Date): VerifiedQuote {
  const outer = BookingQuoteSchema.safeParse(candidate);
  if (!outer.success) return INVALID;
  const token = outer.data.quoteToken;
  const parts = token.split(".");
  if (parts.length !== 2 || !canonicalBase64url(parts[0]) || !canonicalBase64url(parts[1])) return INVALID;
  const [encoded, tagText] = parts;
  const tag = Buffer.from(tagText, "base64url");
  if (tag.length !== 32) return INVALID; // HMAC-SHA256 only; no algorithm negotiation
  let text: string, payload: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded, "base64url"));
    payload = JSON.parse(text);
  } catch { return INVALID; }
  if (!isRecord(payload) || payload.v !== 2 || payload.purpose !== "BOOKING_QUOTE" || typeof payload.kid !== "string") return INVALID;
  const key = ring.keys.get(payload.kid);
  if (!key || !timingSafeEqual(mac(key, encoded), tag)) return INVALID;
  // The signed text must be exactly our serialization of its own content: no extra or missing
  // fields, duplicate names, reordering, whitespace or escapes.
  if (!isRecord(payload.quote) || payloadText(payload.kid, payload.quote as QuoteFields) !== text) return INVALID;
  const signed = BookingQuoteSchema.safeParse({ ...payload.quote, quoteToken: token });
  if (!signed.success) return INVALID;
  if (JSON.stringify(orderedQuote(outer.data)) !== JSON.stringify(orderedQuote(signed.data))) return INVALID;
  if (Date.parse(signed.data.issuedAt) > now.getTime() + QUOTE_CLOCK_TOLERANCE_MS) return INVALID;
  return { ok: true, quote: signed.data, expired: now.getTime() >= Date.parse(signed.data.expiresAt) };
}

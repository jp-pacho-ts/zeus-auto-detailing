import "server-only";
import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

// Trusted client identity for login and session admission (T-027 F-02 rule).
// NONE (default): forwarding headers are ignored and every client shares one key, so
// spoofing can never earn independent limits. PROXY_HOPS: the address the Nth trusted
// proxy from the right appended to X-Forwarded-For. P1-10 verifies the production
// topology before it is enabled; CLOUDFLARE mode is not implemented yet.
export type ClientIdentityMode = "NONE" | "PROXY_HOPS";
export interface ClientIdentityConfig { mode: ClientIdentityMode; hops: number }
export const UNTRUSTED_CLIENT_KEY = "untrusted";
const MAX_PROXY_HOPS = 5;

export class ClientIdentityConfigError extends Error {}

export function clientIdentityConfig(env: Record<string, string | undefined> = process.env): ClientIdentityConfig {
  const mode = env.TRUSTED_CLIENT_IP_MODE ?? "NONE";
  const hops = env.TRUSTED_PROXY_HOPS;
  if (mode === "NONE") {
    if (hops !== undefined) throw new ClientIdentityConfigError("TRUSTED_PROXY_HOPS needs TRUSTED_CLIENT_IP_MODE=PROXY_HOPS");
    return { mode, hops: 0 };
  }
  if (mode !== "PROXY_HOPS") throw new ClientIdentityConfigError("TRUSTED_CLIENT_IP_MODE must be NONE or PROXY_HOPS");
  if (!hops || !/^[1-9]$/.test(hops) || Number(hops) > MAX_PROXY_HOPS) {
    throw new ClientIdentityConfigError(`TRUSTED_PROXY_HOPS must be an integer from 1 to ${MAX_PROXY_HOPS}`);
  }
  return { mode, hops: Number(hops) };
}

export function trustedClientKey(headers: Headers, config: ClientIdentityConfig): string {
  if (config.mode === "NONE") return UNTRUSTED_CLIENT_KEY;
  const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim());
  if (entries.length < config.hops) return UNTRUSTED_CLIENT_KEY;
  return normalizeClientAddress(entries[entries.length - config.hops]) ?? UNTRUSTED_CLIENT_KEY;
}

// Logs carry only a digest of the client key, never the raw address.
export function clientKeyDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

// Canonical IPv4; IPv4-mapped IPv6 as IPv4; other IPv6 keyed by its /64 prefix.
export function normalizeClientAddress(raw: string): string | null {
  if (isIPv4(raw)) {
    if (raw.split(".").some((part) => part.length > 1 && part.startsWith("0"))) return null;
    return raw;
  }
  if (!isIPv6(raw) || raw.includes("%")) return null;
  const groups = expandIPv6(raw.toLowerCase());
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  return groups.slice(0, 4).map((g) => g.toString(16)).join(":") + "::/64";
}

function expandIPv6(address: string): number[] | null {
  let text = address;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4[1].split(".").map(Number);
    text = text.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.split("::");
  const parse = (s: string | undefined) => (s ? s.split(":").map((g) => parseInt(g, 16)) : []);
  const left = parse(head), right = parse(tail);
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<number>(tail === undefined ? 0 : missing).fill(0), ...right];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

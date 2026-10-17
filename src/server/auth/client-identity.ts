import "server-only";
import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

// Trusted client identity for login and session admission (ARCHITECTURE "Admission
// control (T-027, F-02)", N-02), selected by CLIENT_IP_SOURCE:
// - PROXY_HOPS: the rightmost TRUSTED_PROXY_HOPS (1-3) X-Forwarded-For entries were written
//   by trusted proxies. If any one is missing or invalid, the shared `untrusted` key is used.
// - LOCAL_DEVELOPMENT: every client shares the `local` key. Refused in production, and the
//   default outside production only.
// CLOUDFLARE (origin-authenticated) is not implemented yet and is refused. P1-10 verifies the
// production topology. Startup (src/instrumentation.ts) and every first use apply these rules.
export type ClientIpSource = "PROXY_HOPS" | "LOCAL_DEVELOPMENT";
export interface ClientIdentityConfig { source: ClientIpSource; hops: number }
export const UNTRUSTED_CLIENT_KEY = "untrusted";
export const LOCAL_CLIENT_KEY = "local";

export class ClientIdentityConfigError extends Error {}

export function clientIdentityConfig(env: Record<string, string | undefined> = process.env): ClientIdentityConfig {
  const production = env.NODE_ENV === "production";
  if (env.TRUSTED_CLIENT_IP_MODE !== undefined) throw new ClientIdentityConfigError("TRUSTED_CLIENT_IP_MODE is replaced by CLIENT_IP_SOURCE");
  const source = env.CLIENT_IP_SOURCE ?? (production ? undefined : "LOCAL_DEVELOPMENT");
  const hops = env.TRUSTED_PROXY_HOPS;
  if (source === undefined) throw new ClientIdentityConfigError("CLIENT_IP_SOURCE is required in production");
  if (source === "LOCAL_DEVELOPMENT") {
    if (production) throw new ClientIdentityConfigError("CLIENT_IP_SOURCE=LOCAL_DEVELOPMENT is refused in production");
    if (hops !== undefined) throw new ClientIdentityConfigError("TRUSTED_PROXY_HOPS needs CLIENT_IP_SOURCE=PROXY_HOPS");
    return { source, hops: 0 };
  }
  if (source === "CLOUDFLARE") throw new ClientIdentityConfigError("CLIENT_IP_SOURCE=CLOUDFLARE is not implemented yet");
  if (source !== "PROXY_HOPS") throw new ClientIdentityConfigError("CLIENT_IP_SOURCE must be PROXY_HOPS or LOCAL_DEVELOPMENT");
  if (!hops || !/^[1-3]$/.test(hops)) throw new ClientIdentityConfigError("TRUSTED_PROXY_HOPS must be 1, 2 or 3");
  return { source, hops: Number(hops) };
}

export function trustedClientKey(headers: Headers, config: ClientIdentityConfig): string {
  if (config.source === "LOCAL_DEVELOPMENT") return LOCAL_CLIENT_KEY;
  const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim());
  if (entries.length < config.hops) return UNTRUSTED_CLIENT_KEY;
  // Everything left of the trusted suffix is client-controlled and ignored.
  const keys = entries.slice(entries.length - config.hops).map(normalizeClientAddress);
  return keys.some((key) => key === null) ? UNTRUSTED_CLIENT_KEY : keys[0]!;
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

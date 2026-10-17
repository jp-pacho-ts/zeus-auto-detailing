// Trusted client key (ARCHITECTURE "Admission control (T-027, F-02)", revised by T-031 for N-02).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ClientIdentityConfigError, LOCAL_CLIENT_KEY, UNTRUSTED_CLIENT_KEY, clientIdentityConfig, normalizeClientAddress, trustedClientKey,
} from "./client-identity";

const headers = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });
const hops = (n: string) => clientIdentityConfig({ CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: n });

test("LOCAL_DEVELOPMENT ignores forwarding headers: every client shares the local key", () => {
  for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test", CLIENT_IP_SOURCE: "LOCAL_DEVELOPMENT" }]) {
    const config = clientIdentityConfig(env);
    assert.deepEqual(config, { source: "LOCAL_DEVELOPMENT", hops: 0 }, JSON.stringify(env));
    assert.equal(trustedClientKey(headers("203.0.113.9"), config), LOCAL_CLIENT_KEY);
    assert.equal(trustedClientKey(headers(), config), LOCAL_CLIENT_KEY);
  }
});

test("PROXY_HOPS takes the rightmost trusted entries, never a spoofed prefix", () => {
  assert.equal(trustedClientKey(headers("198.51.100.7"), hops("1")), "198.51.100.7");
  assert.equal(trustedClientKey(headers("1.1.1.1, 2.2.2.2, 198.51.100.7"), hops("1")), "198.51.100.7");
  assert.equal(trustedClientKey(headers("9.9.9.9, 198.51.100.7, 10.0.0.2"), hops("2")), "198.51.100.7");
  assert.equal(trustedClientKey(headers("198.51.100.7, 10.0.0.3, 10.0.0.2"), hops("3")), "198.51.100.7");
  // Client-controlled prefixes, however malformed, padded or duplicated, never change a valid suffix's key.
  for (const prefix of ["", "garbage, ", " , , ", "not-an-ip,", "198.51.100.7, 198.51.100.7, ", "::1, 01.2.3.4, ", ",,,"]) {
    assert.equal(trustedClientKey(headers(`${prefix}203.0.113.5, 10.0.0.2`), hops("2")), "203.0.113.5", JSON.stringify(prefix));
  }
});

test("a short, missing or malformed trusted suffix maps to untrusted at every position (F1)", () => {
  // The review's reproductions.
  assert.equal(trustedClientKey(headers("198.51.100.7, invalid"), hops("2")), UNTRUSTED_CLIENT_KEY);
  assert.equal(trustedClientKey(headers("198.51.100.8, "), hops("2")), UNTRUSTED_CLIENT_KEY);
  const valid = ["198.51.100.7", "10.0.0.3", "10.0.0.2"];
  for (const n of [1, 2, 3]) {
    const config = hops(String(n));
    const suffix = valid.slice(3 - n);
    assert.equal(trustedClientKey(headers(["1.1.1.1", ...suffix].join(", ")), config), suffix[0], `hops ${n} valid`);
    for (let position = 0; position < n; position++) {
      for (const bad of ["", " ", "invalid", "01.2.3.4", "256.1.1.1", "1.2.3.4:80", "[2001:db8::1]", "fe80::1%eth0", "unknown"]) {
        const entries = [...suffix];
        entries[position] = bad;
        const xff = ["1.1.1.1", ...entries].join(",");
        assert.equal(trustedClientKey(headers(xff), config), UNTRUSTED_CLIENT_KEY, `hops ${n} position ${position}: ${JSON.stringify(xff)}`);
      }
    }
    // Fewer entries than trusted hops, or no header at all.
    if (n > 1) assert.equal(trustedClientKey(headers(valid.slice(0, n - 1).join(", ")), config), UNTRUSTED_CLIENT_KEY, `hops ${n} short`);
    assert.equal(trustedClientKey(headers(), config), UNTRUSTED_CLIENT_KEY, `hops ${n} missing`);
  }
});

test("addresses are canonical: mapped IPv4 joins IPv4, IPv6 is keyed by /64", () => {
  assert.equal(normalizeClientAddress("198.51.100.7"), "198.51.100.7");
  assert.equal(normalizeClientAddress("::ffff:198.51.100.7"), "198.51.100.7");
  assert.equal(normalizeClientAddress("::FFFF:c633:6407"), "198.51.100.7");
  assert.equal(normalizeClientAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(normalizeClientAddress("2001:0DB8:0001:0002::1"), "2001:db8:1:2::/64");
  assert.equal(normalizeClientAddress("2001:db8::1"), "2001:db8:0:0::/64");
  for (const bad of ["", "01.2.3.4", "256.1.1.1", "1.2.3", "fe80::1%eth0", "[2001:db8::1]", "1.2.3.4:80", "2001:db8::g"]) {
    assert.equal(normalizeClientAddress(bad), null, bad);
  }
  // Equivalent forms in the trusted position give one key.
  const config = hops("1");
  const keys = ["198.51.100.7", "::ffff:198.51.100.7", "::ffff:c633:6407"].map((a) => trustedClientKey(headers(a), config));
  assert.deepEqual(new Set(keys), new Set(["198.51.100.7"]));
});

test("invalid identity configurations are refused (startup and first use)", () => {
  for (const env of [
    { CLIENT_IP_SOURCE: "PROXY_HOPS" },
    ...["0", "4", "5", "9", "1.5", "", " 1", "1 ", "-1", "01", "+1", "1e0", "0x1"].map((n) => ({ CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: n })),
    { CLIENT_IP_SOURCE: "proxy_hops", TRUSTED_PROXY_HOPS: "1" },
    { CLIENT_IP_SOURCE: "NONE" },
    { CLIENT_IP_SOURCE: "" },
    // CLOUDFLARE needs the origin-auth check, which is not implemented yet (P1-10): refused, never degraded.
    { CLIENT_IP_SOURCE: "CLOUDFLARE" },
    { CLIENT_IP_SOURCE: "LOCAL_DEVELOPMENT", TRUSTED_PROXY_HOPS: "1" },
    // The pre-review name is refused rather than silently ignored.
    { TRUSTED_CLIENT_IP_MODE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1" },
  ]) assert.throws(() => clientIdentityConfig(env), ClientIdentityConfigError, JSON.stringify(env));
});

test("production requires an explicit PROXY_HOPS source (F3)", () => {
  for (const env of [{}, { CLIENT_IP_SOURCE: "LOCAL_DEVELOPMENT" }, { CLIENT_IP_SOURCE: "CLOUDFLARE" }, { CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "4" }]) {
    assert.throws(() => clientIdentityConfig({ NODE_ENV: "production", ...env }), ClientIdentityConfigError, JSON.stringify(env));
  }
  assert.deepEqual(clientIdentityConfig({ NODE_ENV: "production", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "3" }), { source: "PROXY_HOPS", hops: 3 });
});

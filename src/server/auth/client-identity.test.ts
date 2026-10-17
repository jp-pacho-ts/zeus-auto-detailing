// Trusted client key (T-027 F-02 rule, simple helper until P1-10 verifies the topology).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientIdentityConfigError, UNTRUSTED_CLIENT_KEY, clientIdentityConfig, normalizeClientAddress, trustedClientKey } from "./client-identity";

const headers = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

test("default mode ignores forwarding headers: every client shares the untrusted key", () => {
  const config = clientIdentityConfig({});
  assert.deepEqual(config, { mode: "NONE", hops: 0 });
  assert.equal(trustedClientKey(headers("203.0.113.9"), config), UNTRUSTED_CLIENT_KEY);
  assert.equal(trustedClientKey(headers(), config), UNTRUSTED_CLIENT_KEY);
});

test("PROXY_HOPS takes the address the trusted proxy appended, not a spoofed leftmost one", () => {
  const one = clientIdentityConfig({ TRUSTED_CLIENT_IP_MODE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1" });
  assert.equal(trustedClientKey(headers("198.51.100.7"), one), "198.51.100.7");
  // An attacker prepends fake entries; only the rightmost (appended by the proxy) counts.
  assert.equal(trustedClientKey(headers("1.1.1.1, 2.2.2.2, 198.51.100.7"), one), "198.51.100.7");
  const two = clientIdentityConfig({ TRUSTED_CLIENT_IP_MODE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "2" });
  assert.equal(trustedClientKey(headers("9.9.9.9, 198.51.100.7, 10.0.0.2"), two), "198.51.100.7");
  // Shorter than the trusted chain, missing, padded or malformed: the shared untrusted key.
  assert.equal(trustedClientKey(headers("198.51.100.7"), two), UNTRUSTED_CLIENT_KEY);
  assert.equal(trustedClientKey(headers(), one), UNTRUSTED_CLIENT_KEY);
  assert.equal(trustedClientKey(headers("1.1.1.1, "), one), UNTRUSTED_CLIENT_KEY);
  assert.equal(trustedClientKey(headers("not-an-ip"), one), UNTRUSTED_CLIENT_KEY);
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
});

test("invalid configurations are refused", () => {
  for (const env of [
    { TRUSTED_CLIENT_IP_MODE: "CLOUDFLARE" },
    { TRUSTED_CLIENT_IP_MODE: "proxy_hops", TRUSTED_PROXY_HOPS: "1" },
    { TRUSTED_CLIENT_IP_MODE: "PROXY_HOPS" },
    { TRUSTED_CLIENT_IP_MODE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "0" },
    { TRUSTED_CLIENT_IP_MODE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1.5" },
    { TRUSTED_CLIENT_IP_MODE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "6" },
    { TRUSTED_CLIENT_IP_MODE: "NONE", TRUSTED_PROXY_HOPS: "1" },
  ]) assert.throws(() => clientIdentityConfig(env), ClientIdentityConfigError, JSON.stringify(env));
});

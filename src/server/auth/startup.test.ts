// Production startup refusals (T-037 D-01 enforcement; N-02 identity) through src/instrumentation.ts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { checkStaffAuthStartup, StaffAuthStartupError } from "./startup";

const GOOD_URL = "postgresql://u:secret@db.internal:5432/zeus?connection_limit=32&pool_timeout=2";
const GOOD = { NODE_ENV: "production", DATABASE_URL: GOOD_URL, CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1" };
const BAD: Record<string, Record<string, string | undefined>> = {
  "missing connection_limit": { DATABASE_URL: "postgresql://u:secret@db.internal/zeus?pool_timeout=2" },
  "low connection_limit": { DATABASE_URL: "postgresql://u:secret@db.internal/zeus?connection_limit=31&pool_timeout=2" },
  "missing pool_timeout": { DATABASE_URL: "postgresql://u:secret@db.internal/zeus?connection_limit=32" },
  "wrong pool_timeout": { DATABASE_URL: "postgresql://u:secret@db.internal/zeus?connection_limit=32&pool_timeout=10" },
  "missing DATABASE_URL": { DATABASE_URL: undefined },
  "missing identity source": { CLIENT_IP_SOURCE: undefined, TRUSTED_PROXY_HOPS: undefined },
  "LOCAL_DEVELOPMENT in production": { CLIENT_IP_SOURCE: "LOCAL_DEVELOPMENT", TRUSTED_PROXY_HOPS: undefined },
  "four hops": { TRUSTED_PROXY_HOPS: "4" },
  "CLOUDFLARE (not implemented)": { CLIENT_IP_SOURCE: "CLOUDFLARE", TRUSTED_PROXY_HOPS: undefined },
};
const env = (overrides: Record<string, string | undefined>) => {
  const merged: Record<string, string | undefined> = { ...GOOD, ...overrides };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged;
};

test("production startup refuses missing or low pool settings and missing or invalid identity", () => {
  assert.doesNotThrow(() => checkStaffAuthStartup(GOOD));
  for (const [label, overrides] of Object.entries(BAD)) {
    assert.throws(() => checkStaffAuthStartup(env(overrides)), (e: unknown) =>
      e instanceof StaffAuthStartupError && e.problems.length >= 1 && !e.message.includes("secret"), label);
  }
  // Every problem is reported at once.
  const both = (() => { try { checkStaffAuthStartup(env({ ...BAD["missing pool_timeout"], ...BAD["four hops"] })); } catch (e) { return e; } })();
  assert.ok(both instanceof StaffAuthStartupError && both.problems.length === 2, String(both));
  // Outside production the pool settings are not required and identity defaults to LOCAL_DEVELOPMENT.
  assert.doesNotThrow(() => checkStaffAuthStartup({ NODE_ENV: "development", DATABASE_URL: "postgresql://u@localhost/zeus" }));
  // A malformed identity setting is refused in every environment.
  assert.throws(() => checkStaffAuthStartup({ NODE_ENV: "development", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "4" }), StaffAuthStartupError);
});

// The real register() hook in a child process, as `next start` calls it before serving.
const CONFIG_KEYS = ["NODE_ENV", "NEXT_RUNTIME", "DATABASE_URL", "CLIENT_IP_SOURCE", "TRUSTED_PROXY_HOPS", "TRUSTED_CLIENT_IP_MODE"];
const baseEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !CONFIG_KEYS.includes(key)));
// P1-03 startup integration: explicit synthetic booking configuration in this child only.
// No global test-process key: catalog's missing-key regression remains meaningful.
const bookingStartupFixture = () => ({
 NODE_ENV: "production" as const,
 HISTORY_LOOKUP_KEYS:"h:"+randomBytes(48).toString("base64url"), HISTORY_LOOKUP_ACTIVE_KID:"h",
 BOOKING_QUOTE_KEYS:"q:"+randomBytes(48).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID:"q",
 MANAGEMENT_GRANT_KEYS:"g:"+randomBytes(48).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID:"g",
 MANAGEMENT_SESSION_KEYS:"s:"+randomBytes(48).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID:"s",
 APP_ORIGIN:"https://zeus.test.invalid", ONLINE_BOOKING_MODE:"PAUSED",
 TURNSTILE_SECRET_KEY:"synthetic_production_shape_secret_for_startup",
 NEXT_PUBLIC_TURNSTILE_SITE_KEY:"synthetic_public_site_key_for_startup",
 TURNSTILE_ALLOWED_HOSTNAMES:"zeus.test.invalid",
});
function runRegister(childEnv: Record<string, string | undefined>) {
  const root = process.cwd();
  const script = `require(${JSON.stringify(path.join(root, "src", "instrumentation.ts"))}).register()
    .then(() => { console.log("REGISTERED"); }, (e) => { console.error("REFUSED " + e.message); process.exitCode = 1; });`;
  return spawnSync(process.execPath, ["--require", path.join(root, "src/server/__tests__/register.cjs"), "-e", script],
    { cwd: root, env: { ...baseEnv(), ...bookingStartupFixture(), ...childEnv } as NodeJS.ProcessEnv, encoding: "utf8" });
}

test("src/instrumentation.ts register() refuses a bad production configuration and accepts a good one", () => {
  const good = runRegister({ ...env({}), NEXT_RUNTIME: "nodejs" });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /REGISTERED/);
  for (const label of ["missing pool_timeout", "low connection_limit", "missing identity source", "four hops"]) {
    const run = runRegister({ ...env(BAD[label]), NEXT_RUNTIME: "nodejs" });
    assert.notEqual(run.status, 0, `${label} started: ${run.stdout}`);
    assert.doesNotMatch(run.stdout, /REGISTERED/, label);
    assert.doesNotMatch(run.stdout + run.stderr, /secret/, `${label} leaked the URL`);
    assert.match(run.stdout + run.stderr, /auth\.config_invalid/, label);
  }
  // The edge runtime does no database or identity work and skips the check.
  const edge = runRegister({ NODE_ENV: "production", NEXT_RUNTIME: "edge" });
  assert.equal(edge.status, 0, edge.stderr);
  assert.match(edge.stdout, /REGISTERED/);
});


test("D7 real startup refuses a missing or invalid history key ring without leaking its value", () => {
  for (const raw of [undefined, "h:PRIVATE-HISTORY-CANARY"]) {
    const run = runRegister({ ...env({}), NEXT_RUNTIME: "nodejs", HISTORY_LOOKUP_KEYS: raw, HISTORY_LOOKUP_ACTIVE_KID: "h" });
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(run.stdout, /REGISTERED/);
    assert.match(run.stdout + run.stderr, /admin\.config_invalid/);
    assert.doesNotMatch(run.stdout + run.stderr, /PRIVATE-HISTORY-CANARY/);
  }
});

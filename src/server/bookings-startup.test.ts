import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
const good = (): NodeJS.ProcessEnv => ({
    NODE_ENV: "production", NEXT_RUNTIME: "nodejs", DATABASE_URL: "postgresql://synthetic@127.0.0.1/zeus_t007_startup?connection_limit=32&pool_timeout=2", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1", APP_ORIGIN: "https://zeus.test.invalid", ONLINE_BOOKING_MODE: "PAUSED", BOOKING_QUOTE_KEYS: "q:" + randomBytes(48).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID: "q", MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(48).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID: "g", MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(48).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID: "s", HISTORY_LOOKUP_KEYS: "h:" + randomBytes(48).toString("base64url"), HISTORY_LOOKUP_ACTIVE_KID: "h", TURNSTILE_SECRET_KEY: "synthetic_production_secret_for_startup", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic_public_site_key_for_startup", TURNSTILE_ALLOWED_HOSTNAMES: "zeus.test.invalid", SMTP_USER: "", SMTP_APP_PASSWORD: "", SMTP_FROM: "", SMTP_SHOP_NOTIFY_EMAIL: ""
});
test("real Next register refuses bad booking configuration before serving and accepts explicit synthetic configuration", () => {
    const run = (override: Record<string, string | undefined>) => spawnSync(process.execPath, ["--require", "./src/server/__tests__/register.cjs", "-e", 'require("./src/instrumentation.ts").register().then(()=>console.log("REGISTERED"))'], {
        env: {
            ...process.env, ...good(), ...override
        }, encoding: "utf8", timeout: 15000
    });
    const accepted = run({});
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /REGISTERED/);
    for (const override of [
        { MANAGEMENT_GRANT_KEYS: "" }, { MANAGEMENT_SESSION_KEYS: "" }, { BOOKING_QUOTE_KEYS: "" }, { TURNSTILE_SECRET_KEY: "" }, { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" }, { ONLINE_BOOKING_MODE: "unknown" }, { APP_ORIGIN: "http://zeus.test.invalid" }
    ]) {
        const refused = run(override);
        assert.notEqual(refused.status, 0);
        assert.doesNotMatch(refused.stdout, /REGISTERED/);
        assert.match(refused.stderr, /booking.config_invalid/);
    }
});

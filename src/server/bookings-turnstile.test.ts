import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { verifyTurnstile, turnstileRemoteIp } from "./bookings-turnstile";
let server: Server, endpoint = "", response: unknown, status = 200, wait = 0;
const requests: URLSearchParams[] = [];
before(async () => { server = createServer(async (req, res) => { let body = ""; for await (const chunk of req)
    body += chunk; requests.push(new URLSearchParams(body)); const value = response, code = status, delay = wait; setTimeout(() => { res.writeHead(code, { "content-type": typeof value === "string" ? "text/html" : "application/json" }); res.end(typeof value === "string" ? value : JSON.stringify(value)); }, delay); }); await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); endpoint = "http://127.0.0.1:" + (server.address() as {
    port: number;
}).port; });
after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
const call = (timeoutMs = 5000) => verifyTurnstile("test-token", { secret: "synthetic", hostnames: ["localhost"] }, {
    endpoint, timeoutMs, remoteip: "192.0.2.1"
});
test("real HTTP siteverify client sends proof, trusted IP and UUID; validates success/action/hostname", async () => {
    response = {
        success: true, action: "booking_create", hostname: "localhost"
    };
    assert.equal(await call(), "VERIFIED");
    const r = requests.at(-1)!;
    assert.equal(r.get("response"), "test-token");
    assert.equal(r.get("remoteip"), "192.0.2.1");
    assert.match(r.get("idempotency_key")!, /^[a-f0-9-]{36}$/);
    for (const invalid of [{ success: false, "error-codes": ["timeout-or-duplicate"] }, {
            success: true, action: "other", hostname: "localhost"
        }, {
            success: true, action: "booking_create", hostname: "attacker.invalid"
        }]) {
        response = invalid;
        assert.equal(await call(), "INVALID");
    }
});
test("provider 5xx/HTML/internal-error/disconnect and bounded timeout fail closed", async () => {
    response = {
        success: true, action: "booking_create", hostname: "localhost"
    };
    status = 503;
    assert.equal(await call(), "UNAVAILABLE");
    status = 200;
    response = "<html>outage</html>";
    assert.equal(await call(), "UNAVAILABLE");
    response = { success: false, "error-codes": ["internal-error"] };
    assert.equal(await call(), "UNAVAILABLE");
    response = {
        success: true, action: "booking_create", hostname: "localhost"
    };
    wait = 250;
    const start = Date.now();
    assert.equal(await call(30), "UNAVAILABLE");
    assert.ok(Date.now() - start < 2000);
    wait = 0;
    assert.equal(await verifyTurnstile("test", { secret: "synthetic", hostnames: ["localhost"] }, { endpoint: "http://127.0.0.1:1", timeoutMs: 100 }), "UNAVAILABLE");
});
test("optional Siteverify IP uses full trusted addresses only, with anonymized IPv6 sharing its budget key",()=>{
 assert.equal(turnstileRemoteIp("192.0.2.1"),"192.0.2.1");
 for(const key of ["local","untrusted","2001:db8:0:1::/64"])assert.equal(turnstileRemoteIp(key),undefined);
});

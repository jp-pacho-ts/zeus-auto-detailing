import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminRequest } from "./bookings/client";
import { readAdminJson } from "@/server/auth/http";

test("Activate sends JSON accepted by the admin route body guard", async () => {
  const source = readFileSync("src/components/admin/services-tab.tsx", "utf8");
  const activation = source.match(/adminRequest\(`\/api\/admin\/services\/\$\{svc.id\}`, (\{ method: "POST"[^\n]*?\})\);/);
  assert.ok(activation, "service activation request must exist");
  // Exercise the actual button's request options through the client and server JSON guard.
  const options = JSON.parse(activation[1].replace(/(method|body):/g, '"$1":'));
  let calls = 0;
  await adminRequest("/api/admin/services/synthetic-service", options, async (url, init) => {
    calls++;
    const request = new Request(`http://localhost${url}`, init);
    assert.equal(request.method, "POST");
    assert.deepEqual(await readAdminJson(request), {});
    assert.equal(init?.credentials, "same-origin");
    return Response.json({ ok: true, data: { ok: true } });
  });
  assert.equal(calls, 1);
});

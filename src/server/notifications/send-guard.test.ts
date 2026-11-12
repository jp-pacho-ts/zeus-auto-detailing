import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { CUSTOMER_DAILY_CAP, SHOP_DAILY_CAP, allowSend, resetSendGuard, sendSmtpClassified } from "./bookings";

beforeEach(resetSendGuard);

test("a runaway loop of 100 sends reaches a customer at most CUSTOMER_DAILY_CAP times a day", async () => {
  const config = { provider: "brevo" as const, brevoApiKey: "k", host: "api.brevo.com", port: 443, secure: true, user: "brevo", password: "k",
    from: "Shop <shop@example.test>", shopEmail: "shop@example.test", origin: "https://shop.example.test" };
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 201 }); }) as typeof fetch;
  try {
    const results = [];
    for (let i = 0; i < 100; i++) results.push(await sendSmtpClassified(config, i % 2 ? "Loop@Example.test" : "loop@example.test", { subject: "S", text: "T" }, "<x@y>"));
    assert.equal(calls, CUSTOMER_DAILY_CAP, "the provider is called only up to the cap, case-insensitively");
    assert.equal(results.filter((r) => r === "sent").length, CUSTOMER_DAILY_CAP);
    assert.equal(await sendSmtpClassified(config, "other@example.test", { subject: "S", text: "T" }, "<x@y>"), "sent", "other customers are unaffected");
  } finally { globalThis.fetch = real; }
});

test("the cap resets after 24 hours, and the shop inbox has its own larger cap", () => {
  const t0 = Date.UTC(2026, 10, 12);
  for (let i = 0; i < CUSTOMER_DAILY_CAP; i++) assert.ok(allowSend("c@example.test", "shop@example.test", t0));
  assert.equal(allowSend("c@example.test", "shop@example.test", t0 + 3_600_000), false);
  assert.ok(allowSend("c@example.test", "shop@example.test", t0 + 86_400_001));
  for (let i = 0; i < SHOP_DAILY_CAP; i++) assert.ok(allowSend("shop@example.test", "shop@example.test", t0));
  assert.equal(allowSend("shop@example.test", "shop@example.test", t0), false);
});

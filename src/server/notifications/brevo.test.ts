import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationConfiguration, sendSmtpClassified } from "./bookings";

test("Brevo is chosen when its three settings are set, and sends through its API", async () => {
  const config = notificationConfiguration({ BREVO_API_KEY: "k", BREVO_FROM: "Zeus Auto Detailing <mail@example.test>", BREVO_SHOP_NOTIFY_EMAIL: "shop@example.test", RESEND_API_KEY: "r" });
  assert.equal(config?.provider, "brevo");
  assert.equal(notificationConfiguration({ BREVO_API_KEY: "k" }), null, "half-configured Brevo is not used");
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: calls.length === 1 ? 201 : 401 }); }) as typeof fetch;
  try {
    assert.equal(await sendSmtpClassified(config!, "c@example.test", { subject: "S", text: "T", html: "<p>H</p>" }, "<id@x>"), "sent");
    assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual([body.sender, body.to, body.htmlContent], [{ name: "Zeus Auto Detailing", email: "mail@example.test" }, [{ email: "c@example.test" }], "<p>H</p>"]);
    assert.equal(await sendSmtpClassified(config!, "c@example.test", { subject: "S", text: "T" }, "<id@x>"), "auth_rejected");
  } finally { globalThis.fetch = real; }
});

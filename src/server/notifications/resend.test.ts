import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationConfiguration, sendSmtpClassified } from "./bookings";

test("Resend: configuration detects RESEND_API_KEY and sets provider to resend", () => {
  const env = {
    RESEND_API_KEY: "re_1234567890abcdef",
    RESEND_FROM: "Zeus Auto Detailing <bookings@zeusautodetailingtacloban.com>",
    RESEND_SHOP_NOTIFY_EMAIL: "zeuscw.mgmt@gmail.com",
    APP_ORIGIN: "https://zeusautodetailingtacloban.com",
  };
  const config = notificationConfiguration(env);
  assert.ok(config);
  assert.equal(config.provider, "resend");
  assert.equal(config.resendApiKey, "re_1234567890abcdef");
  assert.equal(config.from, "Zeus Auto Detailing <bookings@zeusautodetailingtacloban.com>");
  assert.equal(config.shopEmail, "zeuscw.mgmt@gmail.com");
  assert.equal(config.origin, "https://zeusautodetailingtacloban.com");
});

test("Resend: defaults to onboarding@resend.dev when RESEND_FROM is omitted", () => {
  const env = {
    RESEND_API_KEY: "re_testkey123",
  };
  const config = notificationConfiguration(env);
  assert.ok(config);
  assert.equal(config.provider, "resend");
  assert.equal(config.from, "Zeus Auto Detailing <onboarding@resend.dev>");
  assert.equal(config.shopEmail, "zeuscw.mgmt@gmail.com");
});

test("Resend: returns auth_rejected when Resend API returns 401 Unauthorized", async () => {
  const config = notificationConfiguration({ RESEND_API_KEY: "re_invalid_key_test" })!;
  const result = await sendSmtpClassified(
    config,
    "customer@example.test",
    { subject: "Test", text: "Test body" },
    "<test.message.id@localhost>",
  );
  assert.equal(result, "auth_rejected");
});

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
// The per-address daily email cap counts across tests in one process; each test starts from zero.
beforeEach(async () => (await import("@/server/notifications/bookings")).resetSendGuard());
import { notificationConfiguration, sendSmtpClassified, customerReminderMessage } from "./bookings";
import type { DayBookingView } from "@/types/contracts";

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

test("customerReminderMessage: formats reminder subject and body with appointment details", () => {
  const sampleBooking: DayBookingView = {
    id: "11111111-1111-4111-8111-111111111111",
    referenceCode: "ZEUS-TEST01",
    status: "CONFIRMED",
    revision: 1,
    bookingDate: "2026-11-10",
    timezone: "Asia/Manila",
    vehicleCategoryId: "22222222-2222-4222-8222-222222222222",
    vehicleCategoryName: "Sedan",
    lines: [
      {
        serviceId: "33333333-3333-4333-8333-333333333333",
        name: "Premium Wash",
        quantity: 1,
        priceStatus: "PRICED",
        subtotalCentavos: 50000,
        referenceSubtotalCentavos: 50000,
      },
    ],
    totalPriceCentavos: 50000,
    estimatedTotalCentavos: 50000,
    currency: "PHP",
  };
  const msg = customerReminderMessage(sampleBooking, "https://zeusautodetailingtacloban.com");
  assert.ok(msg.subject.includes("Appointment Reminder"));
  assert.ok(msg.subject.includes("ZEUS-TEST01"));
  assert.ok(msg.text.includes("Drop-off day: Tomorrow, 2026-11-10"));
  assert.ok(msg.text.includes("Premium Wash"));
  assert.ok(msg.text.includes("Sedan"));
  assert.ok(msg.text.includes("https://zeusautodetailingtacloban.com/book/manage"));
});

// P1-78 R1 (Security): an ADMIN can now send a test email on demand, so a provider error must never put the recipient address in a log.
test("Resend: an error that quotes the recipient logs only the status and the error name", async () => {
  const shop = "p178-shop-inbox@example.test";
  const config = notificationConfiguration({ RESEND_API_KEY: "re_p178_stub", RESEND_SHOP_NOTIFY_EMAIL: shop })!;
  const realFetch = globalThis.fetch;
  const lines: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const level of ["log", "info", "warn", "error"] as const) console[level] = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  globalThis.fetch = async () => new Response(JSON.stringify({ name: "validation_error", message: `The address ${shop} is not allowed`, statusCode: 422 }), { status: 422, headers: { "content-type": "application/json" } });
  let result: string;
  try {
    result = await sendSmtpClassified(config, shop, { subject: "Test", text: "Test body" }, "<p178.r1@localhost>");
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, saved);
  }
  assert.equal(result, "refused");
  const logged = lines.find((l) => l.includes("resend.error"));
  assert.ok(logged, "the failure is still logged");
  assert.deepEqual(JSON.parse(logged), { event: "resend.error", status: 422, name: "validation_error" });
  assert.ok(!lines.some((l) => l.includes(shop) || l.includes("p178-shop-inbox")), "no log line carries the recipient address");
});

test("Resend: returns auth_rejected when Resend API returns 401 Unauthorized", async () => {
  const config = notificationConfiguration({ RESEND_API_KEY: "re_invalid_key_test" })!;
  // No outbound call (CEO, P1-78): the provider's 401 answer is stubbed.
  const realFetch = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = async (input) => {
    hosts.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).hostname);
    return new Response(JSON.stringify({ name: "missing_api_key", message: "API key is invalid", statusCode: 401 }), { status: 401, headers: { "content-type": "application/json" } });
  };
  let result: string;
  try {
    result = await sendSmtpClassified(
      config,
      "customer@example.test",
      { subject: "Test", text: "Test body" },
      "<test.message.id@localhost>",
    );
  } finally { globalThis.fetch = realFetch; }
  assert.equal(result, "auth_rejected");
  assert.deepEqual(hosts, ["api.resend.com"], "one stubbed call, nothing reached the network");
});

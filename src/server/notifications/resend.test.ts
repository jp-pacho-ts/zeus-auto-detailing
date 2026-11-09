import assert from "node:assert/strict";
import { test } from "node:test";
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

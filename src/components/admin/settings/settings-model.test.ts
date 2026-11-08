// P1-42 Settings screen: the plain words and what a save sends. No React, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminShopSettings } from "@/types/admin-contracts";
import { bookingLine, CONFIRM_MAINTENANCE, emailCounts, emailStatus, MAINTENANCE_BANNER, messageProblem, savedText, updateBody, websiteLine } from "./settings-model";

const settings = (extra: Partial<AdminShopSettings> = {}): AdminShopSettings => ({
  revision: 3, maintenance: false, maintenanceMessage: null, bookingPaused: false, bookingPausedByServer: false, updatedAt: "2026-11-07T00:00:00.000Z",
  email: { configured: false, failedLast7Days: 0, waitingLast7Days: 0 }, ...extra,
});

test("a save sends every value, with only the changed one different and the revision it was read at", () => {
  const s = settings({ maintenanceMessage: "Back soon.", bookingPaused: true });
  assert.deepEqual(updateBody(s, { maintenance: true }), { expectedRevision: 3, maintenance: true, maintenanceMessage: "Back soon.", bookingPaused: true });
  assert.deepEqual(updateBody(s, { bookingPaused: false }), { expectedRevision: 3, maintenance: false, maintenanceMessage: "Back soon.", bookingPaused: false });
  assert.deepEqual(updateBody(s, { maintenanceMessage: "  " }), { expectedRevision: 3, maintenance: false, maintenanceMessage: null, bookingPaused: true }, "an empty message is none");
  assert.deepEqual(updateBody(s, { maintenanceMessage: "  New " }), { expectedRevision: 3, maintenance: false, maintenanceMessage: "New", bookingPaused: true });
});

test("the message is refused on this screen for the same reasons as the server", () => {
  assert.equal(messageProblem(""), null);
  assert.equal(messageProblem("x".repeat(200)), null);
  assert.equal(messageProblem("x".repeat(201)), "Keep the message to 200 characters.");
  assert.equal(messageProblem("two\nlines"), "The message can only be one line of plain text.");
});

test("the website and booking lines say what is happening, and what the difference is", () => {
  assert.equal(websiteLine(settings()), "Live. Customers can see every page.");
  assert.equal(websiteLine(settings({ maintenance: true })), "Under maintenance. Customers see a maintenance page.");
  assert.equal(bookingLine(settings()), "Open. Customers can book online.");
  assert.equal(bookingLine(settings({ bookingPaused: true })), "Paused. New bookings are refused; customers can still manage the bookings they have.");
  assert.equal(bookingLine(settings({ bookingPausedByServer: true })), "Paused by the server setting. Change ONLINE_BOOKING_MODE in Railway to open it.");
  assert.match(CONFIRM_MAINTENANCE, /Customers will see a maintenance page/);
  assert.match(MAINTENANCE_BANNER, /Turn it off in Settings/);
});

test("email says plainly whether it is set up, and never names an address or password", () => {
  assert.match(emailStatus(settings()), /^Not set up\. Customers do not get an email/);
  assert.match(emailStatus(settings({ email: { configured: true, failedLast7Days: 0, waitingLast7Days: 0 } })), /^Set up\./);
  assert.equal(emailCounts(settings({ email: { configured: true, failedLast7Days: 2, waitingLast7Days: 1 } })), "Shop emails in the last 7 days: 2 failed, 1 waiting.");
});

test("a saved change says what happened, and that customers may take a moment to see it", () => {
  assert.equal(savedText(settings(), settings({ maintenance: true })), "The website is under maintenance. Customers see it within a few seconds.");
  assert.equal(savedText(settings({ maintenance: true }), settings()), "The website is live again. Customers see it within a few seconds.");
  assert.equal(savedText(settings(), settings({ bookingPaused: true })), "Online booking is paused.");
  assert.equal(savedText(settings({ bookingPaused: true }), settings()), "Online booking is open.");
  assert.equal(savedText(settings(), settings({ maintenanceMessage: "x" })), "The message was saved.");
  assert.equal(savedText(settings(), settings()), "Nothing needed changing.");
});

// P1-42 Settings screen: the plain words and what a save sends. No React, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminShopSettings } from "@/types/admin-contracts";
import { bookingLine, CONFIRM_MAINTENANCE, emailCounts, emailStatus, lastChangedLine, MAINTENANCE_BANNER, messageProblem, overviewRows, PREVIEW_KINDS, savedText, sectionFromSearch, SETTINGS_SECTIONS, settingsUrl, TEST_EMAIL_LIMIT_TEXT, testEmailText, updateBody, websiteLine } from "./settings-model";

const settings = (extra: Partial<AdminShopSettings> = {}): AdminShopSettings => ({
  revision: 3, maintenance: false, maintenanceMessage: null, bookingPaused: false, bookingPausedByServer: false, updatedAt: "2026-11-07T00:00:00.000Z",
  email: { configured: false, failedLast7Days: 0, waitingLast7Days: 0 },
  emails: { confirmation: true, reminder: true, car_ready: true, shop_alerts: true },
  lastChanged: { at: "2026-11-07T00:00:00.000Z", by: null }, baysLastChanged: null, ...extra,
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
  // LE 2026-11-25: plain words for the shop; the hosting variable name stays out of the admin (replaces the 11-14 wording).
  assert.equal(bookingLine(settings({ bookingPausedByServer: true })), "Paused by the website host. Ask whoever manages the website to open it.");
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

// Side tabs (2026-11-24): one section at a time, kept in ?section=. An old or wrong link opens Overview.
test("sectionFromSearch: known ids open, anything else is Overview", () => {
  assert.equal(sectionFromSearch("?section=email"), "email");
  assert.equal(sectionFromSearch("?section=danger&x=1"), "danger");
  for (const s of ["", "?section=bays", "?section=", "?section=EMAIL", "?other=1"]) assert.equal(sectionFromSearch(s), "overview", s);
  assert.deepEqual(SETTINGS_SECTIONS.map(([id]) => id), ["overview", "hours", "limits", "email", "danger"], "Danger zone last");
});

test("overviewRows: plain when healthy, coloured only when something needs action", () => {
  assert.deepEqual(overviewRows(settings({ email: { configured: true, failedLast7Days: 0, waitingLast7Days: 0 } })).map((r) => [r.label, r.value, r.tone, r.section]), [
    ["Customer website", "Live", "ok", "danger"],
    ["Email", "Set up", "ok", "email"],
    ["Failed emails, 7 days", "0", "ok", "email"],
  ]);
  const bad = overviewRows(settings({ maintenance: true, email: { configured: false, failedLast7Days: 3, waitingLast7Days: 1 } }));
  assert.deepEqual(bad.map((r) => [r.value, r.tone]), [["Under maintenance", "warn"], ["Not set up", "warn"], ["3", "bad"]]);
});

// Review I2: a section choice keeps the rest of the address, and on /admin it also says the Settings tab, so a refresh or link reopens it.
test("settingsUrl: sets only section, keeps other parameters, names the tab on /admin", () => {
  assert.equal(settingsUrl("/admin/settings", "", "email"), "/admin/settings?section=email");
  assert.equal(settingsUrl("/admin/settings", "?section=email", "overview"), "/admin/settings");
  assert.equal(settingsUrl("/admin/settings", "?x=1&section=hours", "danger"), "/admin/settings?x=1&section=danger");
  assert.equal(settingsUrl("/admin", "?tab=System+Settings", "email"), "/admin?tab=System+Settings&section=email");
  assert.equal(settingsUrl("/admin", "", "limits"), "/admin?tab=System+Settings&section=limits");
  assert.equal(settingsUrl("/admin", "?tab=System+Settings&section=email", "overview"), "/admin?tab=System+Settings");
});

// Ported 2026-11-25 from the P1-78 UI/UX draft (ZEUS-CODEX-UIUX, ../zeus-p1-78-ui, uncommitted) when the LE moved the screens to Claude.
// P1-78 (item 4 v1): who changed it and when, in shop time; nothing when the server does not know.
test("a last-changed line gives the Manila time and the name, or just the time, or nothing", () => {
  assert.equal(lastChangedLine({ at: "2026-11-14T07:05:00.000Z", by: "Ana Reyes" }), "Last changed Nov 14, 2026, 3:05 PM by Ana Reyes");
  assert.equal(lastChangedLine({ at: "2026-11-14T07:05:00.000Z", by: null }), "Last changed Nov 14, 2026, 3:05 PM");
  assert.equal(lastChangedLine({ at: "2026-11-14T16:30:00.000Z", by: null }), "Last changed Nov 15, 2026, 12:30 AM", "Manila is UTC+8, so this is the next day");
  assert.equal(lastChangedLine(null), null);
  assert.equal(lastChangedLine({ at: "2026-11-14T07:05:00.000Z", by: "Ana" }, "Last change to settings"), "Last change to settings: Nov 14, 2026, 3:05 PM by Ana", "PM: the settings row shows once, under the summary bar");
});

// P1-78 (item 1): every result in plain words, in shop time; never an address, a provider message or a code.
test("a test email result says what happened and what to do, for every result", () => {
  const at = "2026-11-14T07:05:00.000Z";
  const results = ["sent", "config_missing", "auth_rejected", "timeout", "unreachable", "tls_failed", "refused", "error"] as const;
  for (const r of results) {
    const t = testEmailText({ result: r, at });
    assert.equal(t.ok, r === "sent", r);
    assert.ok(t.text.length > 10, r);
    assert.doesNotMatch(t.text, /@|smtp|resend|brevo|\b\d{3}\b/i, r + " names no address, provider or code");
  }
  assert.equal(testEmailText({ result: "sent", at }).text, "Test email sent to the shop inbox at 3:05 PM. Check the inbox (and spam).");
  assert.match(testEmailText({ result: "config_missing", at }).text, /not set up/);
  assert.equal(TEST_EMAIL_LIMIT_TEXT, "Three test emails in 10 minutes is the limit. Try again in 10 minutes.");
});

test("the preview offers the four emails, in the order customers get them", () => {
  assert.deepEqual(PREVIEW_KINDS.map(([k]) => k), ["confirmation", "reminder", "turn_notice", "car_ready"]);
  for (const [, label] of PREVIEW_KINDS) assert.match(label, /^[A-Z][a-z ]+$/);
});

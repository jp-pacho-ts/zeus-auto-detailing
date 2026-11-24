/* eslint-disable @typescript-eslint/no-require-imports */
// P1-77: the Settings layout (summary bar, section list, Danger zone last) and the daily limits as sentences.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const settings = (extra: Record<string, unknown> = {}) => ({
  revision: 3, maintenance: false, maintenanceMessage: null, bookingPaused: false, bookingPausedByServer: false, updatedAt: "2026-11-07T00:00:00.000Z",
  email: { configured: false, failedLast7Days: 2, waitingLast7Days: 1 },
  emails: { confirmation: true, reminder: true, car_ready: true, shop_alerts: true }, ...extra,
});

function renderSettings(role: string, data: unknown) {
  const kept = require("../team/use-kept-resource");
  mock.method(kept, "useKeptResource", (url: string | null) => ({ data: url ? data : null, loading: false, error: null, reload: async () => {} }));
  try {
    return renderToStaticMarkup(createElement(require("../settings-tab").SettingsTab, { role, onChanged: () => {} })).replace(/<!-- -->/g, "");
  } finally {
    mock.restoreAll();
  }
}

// 2026-11-24 side tabs: one section at a time from a side list, Overview first, Danger zone last. Bays moved to the Bay board.
test("Settings: side list in order, Danger zone last, Overview shown first", () => {
  const html = renderSettings("ADMIN", settings());
  const list = html.match(/<nav aria-label="Settings sections"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.deepEqual([...list.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].replace("&amp;", "&")),
    ["Overview", "Hours & closed days", "Daily limits", "Email", "Danger zone"]);
  assert.match(list, /aria-current="page"[^>]*>Overview</);
  assert.equal((list.match(/aria-current=/g) ?? []).length, 1, "one section is current");
  assert.match(html, /id="settings-overview"/);
  // Review I3: choosing a section focuses its heading, so the heading must take programmatic focus.
  assert.match(html, /<h2 id="settings-overview-title" tabindex="-1"/);
  for (const gone of ["settings-email\"", "settings-danger\"", "settings-bays", "Settings summary", "Jump to a section", ">System Settings<"]) assert.equal(html.includes(gone), false, gone);
  // Status lives in the Overview only; no repeated badges, no "Railway".
  assert.doesNotMatch(html, /Storefront Live|Public Site Live|Bookings Open|SMTP Configured|Setup in Railway|Railway/);
});

// 2026-11-25 (LE: Vercel reference): the section title heads the page; each setting is its own card ending in a footer strip.
test("Settings: a page heading per section, one card per setting with a footer strip, no icon tiles", () => {
  const html = renderSettings("ADMIN", settings());
  assert.match(html, /<h2 id="settings-overview-title" tabindex="-1"[^>]*>Overview<\/h2>/);
  for (const title of ["Online booking", "Shop status"]) assert.match(html, new RegExp(`<h3[^>]*>${title}</h3>`), title);
  assert.ok((html.match(/data-settings-card-footer/g) ?? []).length >= 2, "each card ends in a footer strip");
  assert.doesNotMatch(html, /h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-raised/, "no decorative icon tiles");
});

test("Settings: Overview shows status rows; a server pause locks the booking switch", () => {
  const html = renderSettings("ADMIN", settings({ maintenance: true, bookingPausedByServer: true, email: { configured: true, failedLast7Days: 0, waitingLast7Days: 0 } }));
  assert.doesNotMatch(html, /Railway|ONLINE_BOOKING_MODE/, "a server pause is explained in plain words");
  assert.match(html, /Paused by the website host/);
  assert.match(html, />Under maintenance</);
  assert.match(html, />Set up</);
  assert.match(html, /aria-label="New bookings"/);
  assert.match(html, /<button type="button" aria-pressed="false" disabled=""[^>]*>Open</, "a server pause cannot be undone here");
  const failed = renderSettings("ADMIN", settings());
  assert.match(failed, />Not set up</);
  assert.match(failed, /Failed emails, 7 days/);
});

test("Settings: anyone but an admin is told plainly and sees no controls", () => {
  const html = renderSettings("DETAILER", settings());
  assert.match(html, /Only an admin can change the settings/);
  assert.doesNotMatch(html, /Settings summary|Danger zone/);
});

test("Daily limits: one sentence per line of work with Edit; the forms open on Edit; the day picker comes last", () => {
  const resources = require("../bookings/use-admin-resource");
  const caps = [
    { code: "WASH", name: "Wash", isActive: true, dailyCap: 50, revision: 1, overrides: [], committed: [{ date: "2026-11-14", count: 1 }] },
    { code: "TINT", name: "Tint + PPF", isActive: true, dailyCap: null, revision: 1, overrides: [{ date: "2026-11-14", dailyCap: 20, revision: 2 }], committed: [] },
  ];
  mock.method(resources, "useAdminResource", () => ({ data: caps, loading: false, error: null, reload: async () => {}, setData: () => {} }));
  try {
    const html = renderToStaticMarkup(createElement(require("../bookings/cap-settings").CapSettings, { date: "2026-11-14", onChanged: () => {}, onDateChange: () => {} }));
    const text = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "\n").split("\n").map((t) => t.trim()).filter(Boolean);
    assert.ok(text.includes("Up to 50 cars a day · 1 booked"), text.join(" | "));
    assert.ok(text.includes("No daily limit · 0 booked · this day: up to 20"), text.join(" | "));
    assert.equal((html.match(/aria-expanded="false"[^>]*>Edit</g) ?? []).length, 2);
    assert.doesNotMatch(html, /Save default limit|Save date limit/, "the forms stay closed until Edit");
    assert.ok(html.indexOf('type="date"') > html.lastIndexOf("booked"), "the day picker comes after the lines of work");
  } finally {
    mock.restoreAll();
  }
});

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

test("Settings: one summary bar, a section list, and the Danger zone last", () => {
  const html = renderSettings("ADMIN", settings());
  const summary = html.match(/<nav aria-label="Settings summary"[\s\S]*?<\/nav>/)?.[0] ?? "";
  const items = [...summary.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<!-- -->/g, ""));
  assert.deepEqual(items, ["Site: Live", "Online booking: Open", "Email: Not set up", "Failed emails, 7 days: 2"]);
  const list = html.match(/<nav aria-label="Settings sections"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.deepEqual([...list.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].replace("&amp;", "&")),
    ["General", "Hours &amp; closed days".replace("&amp;", "&"), "Daily limits", "Email", "Bays", "Danger zone"]);
  const order = ["settings-general", "settings-hours", "settings-limits", "settings-email", "settings-bays", "settings-danger"].map((id) => html.indexOf(`id="${id}"`));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), "sections in order: " + order);
  const danger = html.slice(order[5]);
  assert.match(danger, /aria-label="Customer website"/, "the maintenance switch sits in the Danger zone");
  assert.match(danger, /id="maintenance-message-input"/, "and its message with it");
  assert.equal(html.slice(0, order[5]).includes('aria-label="Customer website"'), false, "not before the Danger zone");
  // Status lives only in the summary bar; no repeated badges, no "Railway".
  assert.doesNotMatch(html, /Storefront Live|Public Site Live|Bookings Open|SMTP Configured|Setup in Railway|Railway/);
  assert.match(html, />Which emails go out</);
  assert.match(html, />2 failed</);
});

test("Settings: maintenance on and paused show in the summary bar; a server pause keeps the switch locked", () => {
  const html = renderSettings("ADMIN", settings({ maintenance: true, bookingPausedByServer: true, email: { configured: true, failedLast7Days: 0, waitingLast7Days: 0 } }));
  assert.match(html, />Site: Under maintenance</);
  assert.match(html, />Online booking: Paused</);
  assert.match(html, />Email: Set up</);
  const general = html.slice(html.indexOf('id="settings-general"'), html.indexOf('id="settings-hours"'));
  assert.match(general, /<button type="button" aria-pressed="false" disabled=""[^>]*>Open</, "a server pause cannot be undone here");
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

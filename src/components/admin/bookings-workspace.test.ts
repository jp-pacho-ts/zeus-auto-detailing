/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mock, test } from "node:test";

function render(component: string, props: Record<string, unknown> = {}) {
  const resources = require("./bookings/use-admin-resource");
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url === "/api/admin/auth/session" ? {
      id: "synthetic-staff", displayName: "Synthetic admin", loginId: "synthetic-admin",
      role: props.role ?? "ADMIN", expiresAt: "2099-01-01T00:00:00Z",
    } : null,
    loading: false, error: null, reload: () => {}, setData: () => {},
  }));
  try {
    const Component = component === "portal" ? require("./admin-portal").AdminPortal
      : component === "calendar" ? require("./calendar-tab").CalendarTab : require("./bookings-tab").BookingsTab;
    return renderToStaticMarkup(createElement(Component, { role: "ADMIN", ...props }));
  } finally {
    mock.restoreAll();
  }
}

test("Bookings owns customer bookings/calendar/history; the Bay board is separate", () => {
  const html = render("portal", { initialTab: "Bookings" });
  const nav = html.match(/<nav[^>]*aria-label="Shop Operations Navigation"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  assert.match(nav, />Bookings<\/span>/);
  assert.doesNotMatch(nav, /Bay Calendar/);
  assert.match(nav, />Bay board<\/span>/);
  assert.match(html, /id="bookings-view-BOOKINGS"[^>]*aria-pressed="true"/);
  assert.match(html, /id="bookings-view-CALENDAR"/);
  assert.match(html, />History<\/button>/);
  assert.match(html, /Search bookings/);
  assert.doesNotMatch(html, />Kanban<\/button>|Customer booking history/);
});

test("Calendar view opens the month calendar and does not duplicate the day list", () => {
  const html = render("bookings", { initialView: "CALENDAR" });
  assert.match(html, /id="bookings-view-CALENDAR"[^>]*aria-pressed="true"/);
  assert.match(html, /aria-label="Calendar view"/);
  assert.match(html, /aria-label="Previous month"/);
  assert.doesNotMatch(html, />Day list<\/button>/);
  assert.doesNotMatch(html, />Bays<\/button>|>Opening hours<\/button>/);
});

test("legacy Bay Calendar bookmarks open Calendar within Bookings", () => {
  const html = render("portal", { initialTab: "Bay Calendar" });
  assert.match(html, /<h1[^>]*>Bookings<\/h1>/);
  assert.match(html, /id="bookings-view-CALENDAR"[^>]*aria-pressed="true"/);
  assert.match(html, /aria-label="Previous month"/);
});

test("customer history and bay setup stay ADMIN-only for non-admin roles", () => {
  for (const role of ["STAFF", "DETAILER"]) {
    const html = render("bookings", { role, initialView: "CALENDAR" });
    assert.match(html, /aria-label="Calendar view"/);
    assert.doesNotMatch(html, />Bays<\/button>|>Opening hours<\/button>/);
    assert.doesNotMatch(html, />History<\/button>/);
    const board = render("portal", { role, initialTab: "Bay board" });
    assert.match(board, /Board day/);
    assert.doesNotMatch(board, />Bays<\/button>|>Opening hours<\/button>/);
  }
});

test("the calendar component starts at overview; history is a separate customer lookup", () => {
  assert.match(render("calendar"), /aria-label="Previous month"/);
  const html = render("bookings", { initialView: "HISTORY" });
  assert.match(html, /id="bookings-view-HISTORY"[^>]*aria-pressed="true"/);
  assert.match(html, /Customer booking history/);
  assert.doesNotMatch(html, /Queue day|Search bookings/);
  assert.doesNotMatch(html, /aria-label="Calendar view"/);
});

test("Bay board opens Kanban and retains bay/hour setup without customer booking tabs", () => {
  const html = render("portal", { initialTab: "Bay board" });
  assert.match(html, /<h1[^>]*>Bay board<\/h1>/);
  assert.match(html, /Board day/);
  assert.match(html, />Bays<\/button>/);
  assert.match(html, />Opening hours<\/button>/);
  assert.doesNotMatch(html, /aria-label="Bookings view"|Customer booking history/);
});

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
  assert.match(html, />Search<\/button>/);
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
  assert.doesNotMatch(html, /Queue day|aria-label="Bookings mode"/);
  assert.doesNotMatch(html, /aria-label="Calendar view"/);
});

test("Bay board renders directly without customer booking tabs or redundant section buttons", () => {
  const html = render("portal", { initialTab: "Bay board" });
  assert.match(html, /<h1[^>]*>Bay board<\/h1>/);
  assert.match(html, /Board day/);
  assert.doesNotMatch(html, />Bays<\/button>/);
  assert.doesNotMatch(html, />Opening hours<\/button>/);
  assert.doesNotMatch(html, /aria-label="Bookings view"|Customer booking history/);
});

test("the Bookings page has one mode switch, one day control and one Status filter", () => {
  const html = render("bookings", {});
  assert.match(html, /role="group" aria-label="Bookings mode"/);
  assert.match(html, /id="bookings-view-BOOKINGS"[^>]*aria-pressed="true"[^>]*>Day</);
  assert.match(html, /Queue day/);
  assert.match(html, /aria-label="Previous day"/);
  assert.match(html, /aria-label="Next day"/);
  assert.equal((html.match(/>Today</g) ?? []).length, 1, "one Today button");
  assert.doesNotMatch(html, /Yesterday|Tomorrow|Last week|Find bookings|Day(&#x27;|')s Bookings/, "the old duplicate controls are gone");
  assert.doesNotMatch(html, /Booking status|Search status|Refresh queues/);
  assert.equal((html.match(/<select/g) ?? []).length, 1, "one Status filter on the day view");
  assert.match(html, /<label[^>]*>Status<select/);
  assert.doesNotMatch(html, /<h1/, "the portal owns the page title");
});

test("STAFF gets Day and Search only; History stays ADMIN-only", () => {
  const staff = render("bookings", { role: "STAFF" });
  assert.match(staff, />Search<\/button>/);
  assert.doesNotMatch(staff, />History<\/button>/);
  assert.doesNotMatch(render("bookings", { initialView: "HISTORY" }), /aria-label="Bookings mode"/);
});

test("date range presets: weeks run Monday to Sunday, months end on their last day", () => {
  const { presetRange } = require("./bookings-tab") as typeof import("./bookings-tab");
  assert.deepEqual(presetRange("TODAY", "2026-11-12"), { from: "2026-11-12", to: "2026-11-12" });
  assert.deepEqual(presetRange("THIS_WEEK", "2026-11-12"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(presetRange("THIS_WEEK", "2026-11-15"), { from: "2026-11-09", to: "2026-11-15" }, "Sunday ends the week");
  assert.deepEqual(presetRange("LAST_WEEK", "2026-11-09"), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(presetRange("THIS_MONTH", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" }, "leap February");
});

/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function render(role = "ADMIN", cap: number | null = null, bayState = "ready") {
  const resources = require("./use-admin-resource"),
    urls: (string | null)[] = [];
  const bays = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    name: `Bay ${i + 1}`,
    isActive: i < 8,
  }));
  mock.method(resources, "useAdminResource", (url: string | null) => {
    urls.push(url);
    const data =
      url === "/api/admin/bays"
        ? bayState === "ready"
          ? bays
          : null
        : url?.startsWith("/api/admin/queues?")
          ? {
              date: "2026-10-20",
              closed: null,
              legacy: [],
              queues: [
                {
                  code: "WASH",
                  name: "Wash",
                  isActive: true,
                  committed: 2,
                  effectiveCap: cap,
                  bookings: [],
                },
              ],
            }
          : url?.startsWith("/api/admin/schedule/caps?")
            ? [
                {
                  code: "WASH",
                  name: "Wash",
                  dailyCap: cap,
                  revision: 1,
                  overrides: [],
                  committed: [],
                },
              ]
            : null;
    return {
      data,
      loading: url === "/api/admin/bays" && bayState === "loading",
      error:
        url === "/api/admin/bays" && bayState === "error"
          ? "Bay request failed"
          : null,
      reload: () => {},
      setData: () => {},
    };
  });
  try {
    return {
      html: renderToStaticMarkup(
        createElement(require("../bay-workspace").BayWorkspace, { role }),
      ),
      list: renderToStaticMarkup(
        createElement(require("../bookings-tab").BookingsTab, { role, listView: true }),
      ),
      urls,
    };
  } finally {
    mock.restoreAll();
  }
}
test("calendar derives eight operating bays from live active flags, without a brand fallback", () => {
  const { html, urls } = render();
  assert.ok(urls.includes("/api/admin/bays"));
  assert.ok(html.includes("8 Bays Operating"));
  assert.ok(html.includes("Refresh bays"));
  for (const state of ["loading", "error"]) {
    const result = render("ADMIN", null, state).html;
    assert.equal(result.includes("8 Bays Operating"), false);
    assert.ok(
      result.includes(state === "loading" ? "Loading" : "Bay request failed"),
    );
  }
});
test("queue headers distinguish no limit, zero and set limits", () => {
  const off = render().list;
  assert.ok(off.includes("2 committed · no limit"));
  assert.equal(off.includes("unconfigured (full)"), false);
  assert.equal(off.includes("fully booked"), false);
  assert.ok(render("ADMIN", 0).list.includes("2 committed · Limit 0"));
  assert.ok(render("ADMIN", 8).list.includes("2 committed · Limit 8"));
  const staff = render("STAFF").list;
  assert.ok(staff.includes("no limit"));
  assert.equal(staff.includes("Save default limit"), false);
});
// P1-20 item 6 (LE 2026-10-28): the Optional limits panel is hidden for every role and no longer
// reads the caps. The cap routes, data and API tests stay (admin.integration W12-W14).
test("the Optional limits panel is not rendered and does not load the caps", () => {
  for (const [role, cap] of [["ADMIN", null], ["ADMIN", 8], ["STAFF", null]] as const) {
    const result = render(role, cap), html = result.html + result.list, urls = result.urls;
    assert.equal(html.includes("Optional limits"), false, role);
    assert.equal(html.includes("Save default limit"), false, role);
    assert.equal(html.includes('placeholder="Off (no limit)"'), false, role);
    assert.equal(urls.some((u) => u?.startsWith("/api/admin/schedule/caps")), false, role);
  }
});

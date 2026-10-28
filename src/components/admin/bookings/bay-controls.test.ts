/* eslint-disable @typescript-eslint/no-require-imports */
// P1-20 item 4 (LE 2026-10-28): bays are added, renamed and removed inline on the board rows,
// through the existing audited bay routes. ADMIN only; remove = deactivate; a busy bay stays.
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addBayRequest, bayNameError, removeBayBlocked, removeBayRequest, renameBayRequest } from "./bay-controls";

const bay = (id: string, name: string, bayType: "WASH" | "DETAILING" | "PAINT", cards: { id: string }[] = []) => ({
  id, name, bayType, sortOrder: Number(id.slice(-1)), isActive: true, updatedAt: "2026-10-20T00:00:00.000Z", cards,
});
const bays = [bay("b1", "Wash bay 1", "WASH", [{ id: "car" }]), bay("b2", "Detail bay 1", "DETAILING"), bay("b3", "Paint bay 1", "PAINT")];

test("add, rename and remove send the existing bay routes their exact bodies", () => {
  assert.deepEqual(addBayRequest("PAINT", "  Paint bay 2 ", bays), {
    url: "/api/admin/bays", method: "POST", body: { name: "Paint bay 2", bayType: "PAINT", sortOrder: 4 },
  });
  assert.deepEqual(renameBayRequest(bays[1], " Detail bay A "), {
    url: "/api/admin/bays/b2", method: "PATCH", body: { expectedUpdatedAt: "2026-10-20T00:00:00.000Z", name: "Detail bay A" },
  });
  assert.deepEqual(removeBayRequest(bays[2]), {
    url: "/api/admin/bays/b3", method: "PATCH", body: { expectedUpdatedAt: "2026-10-20T00:00:00.000Z", isActive: false },
  });
});

test("bay names: required, at most 40 characters, not already used (any case), the same name is no change", () => {
  assert.equal(bayNameError("", bays), "Enter a bay name.");
  assert.equal(bayNameError("   ", bays), "Enter a bay name.");
  assert.equal(bayNameError("x".repeat(41), bays), "Use at most 40 characters.");
  assert.equal(bayNameError(" wash BAY 1 ", bays), "A bay with this name already exists.");
  assert.equal(bayNameError("Wash bay 1", bays, "b1"), "That is already this bay's name.");
  assert.equal(bayNameError("Wash bay 2", bays), null);
});

test("a bay with a car in it cannot be removed; the reason is plain", () => {
  assert.equal(removeBayBlocked(bays[0]), "Move the car out of Wash bay 1 before removing it.");
  assert.equal(removeBayBlocked(bays[1]), null);
});

const board = {
  date: "2026-10-20", closed: null, workers: [],
  queues: [
    { code: "WASH", name: "Wash", bayType: "WASH", waiting: [] },
    { code: "DETAILING_COATING", name: "Detailing + Coating", bayType: "DETAILING", waiting: [] },
    { code: "REPAINT", name: "Repaint", bayType: "PAINT", waiting: [] },
  ],
  bays: bays.map((b) => ({ ...b, cards: [] })),
};
function render(role: "ADMIN" | "STAFF") {
  const resources = require("./use-admin-resource");
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url?.startsWith("/api/admin/board?") ? board : null, loading: false, error: null, reload: async () => {}, setData: () => {},
  }));
  try {
    return renderToStaticMarkup(createElement(require("./bay-board").BayBoard, { role }));
  } finally {
    mock.restoreAll();
  }
}

test("ADMIN gets Add bay at the end of every row and a keyboard menu on every bay; STAFF gets neither", () => {
  const admin = render("ADMIN");
  for (const row of ["Wash", "Detailing", "Paint"]) {
    const start = admin.indexOf(`aria-label="${row} row"`), add = admin.indexOf(`Add a ${row.toLowerCase()} bay`, start);
    assert.ok(start > 0 && add > start, row);
  }
  assert.ok(admin.indexOf("Add a wash bay") < admin.indexOf('aria-label="Detailing row"'), "Add bay ends its own row");
  for (const b of bays) {
    assert.ok(admin.includes(`aria-label="Options for ${b.name}"`), b.name);
  }
  assert.match(admin, /aria-haspopup="menu"/);
  assert.match(admin, /aria-expanded="false"/);
  const staff = render("STAFF");
  for (const hidden of ["Add a wash bay", "Options for", "aria-haspopup"]) assert.equal(staff.includes(hidden), false, hidden);
});

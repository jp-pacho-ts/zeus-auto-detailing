/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const card = {
  id: "car",
  referenceCode: "ZEUS-TEST17",
  revision: 3,
  bookingDate: "2026-10-19",
  queueCode: "WASH",
  queuePosition: 1,
  vehicleModel: "Synthetic Toyota Vios",
  vehiclePlate: null,
  sizeCode: "S",
  status: "IN_PROGRESS",
  assignedBayId: null,
  lines: [{ id: "line", name: "Basic Wash", workStatus: "WAITING" }],
  assignedWorkers: [
    { staffId: "staff", name: "Synthetic Technician", isActive: true },
  ],
  progress: { done: 0, total: 1 },
};
const board = {
  date: "2026-10-20",
  closed: null,
  workers: [],
  queues: ["WASH", "DETAILING_COATING", "TINT_PPF", "REPAINT"].map(
    (code, i) => ({
      code,
      name: code,
      bayType: i === 0 ? "WASH" : i < 3 ? "DETAILING" : "PAINT",
      waiting: i === 0 ? [card] : [],
    }),
  ),
  bays: Array.from({ length: 8 }, (_, i) => ({
    id: "bay" + i,
    name: "Bay " + i,
    bayType: i < 3 ? "WASH" : i < 6 ? "DETAILING" : "PAINT",
    sortOrder: i,
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    cards: [],
  })),
};
function render(role: "ADMIN" | "STAFF") {
  const resources = require("./use-admin-resource");
  mock.method(resources, "useAdminResource", () => ({
    data: board,
    loading: false,
    error: null,
    reload: async () => {},
    setData: () => {},
  }));
  try {
    return renderToStaticMarkup(
      createElement(require("../bookings-tab").BookingsTab, { role }),
    );
  } finally {
    mock.restoreAll();
  }
}
test("Bookings defaults to board with four Waiting queues, eight bays, captured car/services/staff/progress and a column selector", () => {
  const html = render("ADMIN");
  assert.ok(html.includes('aria-pressed="true">Board'));
  for (const q of board.queues)
    assert.ok(html.includes("Waiting \u00b7 " + q.name));
  for (const bay of board.bays) assert.ok(html.includes(bay.name));
  for (const value of [
    "List / history",
    "Board column",
    "Synthetic Toyota Vios",
    "No plate",
    "Basic Wash",
    "Synthetic Technician",
    "0/1 done",
    "Carry-over",
  ])
    assert.ok(html.includes(value), value);
  assert.ok(html.includes('aria-label="Move ZEUS-TEST17 to bay"'));
  assert.ok(html.includes("Drag to bay"));
});
test("STAFF board retains card/checklist entry but has no bay-move or worker-write controls", () => {
  const html = render("STAFF");
  assert.ok(html.includes("ZEUS-TEST17"));
  assert.ok(html.includes("Synthetic Technician"));
  for (const value of [
    "Drag to bay",
    "Move car",
    "Assign worker",
    "Remove Synthetic Technician",
  ])
    assert.equal(html.includes(value), false, value);
});

test("board groups Waiting queues beside compatible bays", () => {
  const html = render("ADMIN");
  assert.ok(
    html.indexOf("Bay 0") < html.indexOf("Waiting \u00b7 DETAILING_COATING"),
  );
});

// P1-22 (LE 2026-10-29): Board day and Refresh board share the view switch's row, on its right
// from lg up and on the next line below lg. The browser check measures the actual positions.
test("Board day and Refresh board sit in one toolbar with the view switch, before the helper text", () => {
  const html = render("ADMIN");
  const toolbar = html.search(
    /<div class="[^"]*\blg:flex-row\b[^"]*\blg:justify-between\b[^"]*"><div role="group" aria-label="Bookings view"/,
  );
  assert.ok(toolbar >= 0, "the view switch opens a wrapping toolbar row");
  const day = html.indexOf('aria-label="Board day"', toolbar),
    refresh = html.indexOf("Refresh board", toolbar),
    helper = html.indexOf("One car per bay");
  assert.ok(day > toolbar && refresh > day, "Board day, then Refresh board, follow the switch");
  assert.ok(helper > refresh, "the helper sentence stays under the toolbar");
  assert.equal(html.split('aria-label="Board day"').length, 2, "one Board day field");
});

// P1-22: columns in a row stretch to one height. An empty column's slot is at least one card tall
// from lg up (LE: "full one-card height"; ADMIN cards carry move controls, so they are taller than
// STAFF cards), so an empty row is as tall as a row holding one car. At md the sidebar leaves room
// for one column per line, so the slot stays short there (UI/UX check a4326df).
test("board columns stretch to equal height and an empty slot keeps one card's height", () => {
  for (const [role, min] of [["ADMIN", "lg:min-h-[26rem]"], ["STAFF", "lg:min-h-[14rem]"]] as const) {
    const html = render(role);
    const grids = html.match(/<div class="[^"]*\bgrid\b[^"]*auto-fill[^"]*"/g) ?? [];
    assert.equal(grids.length, 3, role + ": one column grid per row");
    for (const grid of grids) {
      assert.doesNotMatch(grid, /items-start/, role + ": columns are not top-aligned at their own height");
      assert.match(grid, /items-stretch/, role);
    }
    const columns = html.match(/<section aria-label="(Waiting \u00b7 |Bay |Done \u00b7 )[^"]*" class="[^"]*"/g) ?? [];
    assert.equal(columns.length, 4 + 8 + 3, role + ": every column");
    for (const column of columns) assert.match(column, /\bflex-col\b/, role + ": " + column);
    const slots = html.match(/<p class="[^"]*">(Bay empty|No waiting cars|No cars finished yet|Loading\.\.\.)<\/p>/g) ?? [];
    assert.ok(slots.length >= 3 + 8, role + ": every empty column shows a slot");
    for (const slot of slots) {
      assert.ok(slot.includes(min) && /\bmin-h-24\b/.test(slot) && /\bflex-1\b/.test(slot), role + " slot fills the column with a minimum: " + slot);
      assert.doesNotMatch(slot, /\bmd:min-h-/, role + ": no card-height minimum below lg");
      if (/Bay empty|No waiting cars/.test(slot)) assert.match(slot, /border-dashed/, role + ": drop targets show a dashed slot");
      else assert.doesNotMatch(slot, /border-dashed/, role + ": Done is not a drop target");
    }
  }
});

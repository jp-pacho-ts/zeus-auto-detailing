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

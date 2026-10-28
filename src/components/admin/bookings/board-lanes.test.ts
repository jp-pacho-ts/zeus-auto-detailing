/* eslint-disable @typescript-eslint/no-require-imports */
// P1-20 item 2 (LE 2026-10-28): the board is one row per bay type (Wash, Detailing, Paint).
// Each row runs Waiting -> its bays -> Done, with counts in the row heading. Done is read-only.
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardLanes } from "./board-model";

const card = (id: string, queueCode: string, assignedBayId: string | null = null) => ({
  id, referenceCode: "ZEUS-" + id.toUpperCase(), revision: 1, bookingDate: "2026-10-20", queueCode, queuePosition: 1,
  vehicleModel: "Synthetic " + id, vehiclePlate: null, sizeCode: "S", status: "CONFIRMED", assignedBayId,
  lines: [{ id: id + "-l", name: "Basic Wash", workStatus: "WAITING" }], assignedWorkers: [], progress: { done: 0, total: 1 }, depositStatus: "NONE",
});
const types = { WASH: "WASH", DETAILING_COATING: "DETAILING", TINT_PPF: "DETAILING", REPAINT: "PAINT" } as const;
const board = {
  date: "2026-10-20",
  closed: null,
  workers: [],
  queues: (Object.keys(types) as (keyof typeof types)[]).map((code) => ({
    code, name: code === "WASH" ? "Wash" : code, bayType: types[code],
    waiting: code === "WASH" ? [card("w1", "WASH")] : code === "TINT_PPF" ? [card("t1", "TINT_PPF")] : [],
  })),
  bays: [
    { id: "wb1", name: "Wash bay 1", bayType: "WASH" },
    { id: "db1", name: "Detail bay 1", bayType: "DETAILING" },
    { id: "pb1", name: "Paint bay 1", bayType: "PAINT" },
  ].map((b, i) => ({ ...b, sortOrder: i, isActive: true, updatedAt: "2026-10-20T00:00:00.000Z", cards: b.id === "wb1" ? [card("w2", "WASH", "wb1")] : [] })),
};
const done = (id: string, queueCode: string, status = "COMPLETED") => ({
  id, referenceCode: "ZEUS-" + id.toUpperCase(), status, queueCode, customerName: "Customer " + id, vehicleModel: "Synthetic " + id,
  vehiclePlate: null, bookingDate: "2026-10-20", lines: [{ id: id + "-l", name: "Basic Wash", removed: false }], serviceName: "Basic Wash",
});
const day = {
  date: "2026-10-20",
  closed: null,
  legacy: [],
  queues: (Object.keys(types) as (keyof typeof types)[]).map((code) => ({
    code, name: code, isActive: true, committed: 0, effectiveCap: null,
    bookings: code === "WASH" ? [done("d1", "WASH"), done("d2", "WASH"), done("x1", "WASH", "IN_PROGRESS")] : code === "REPAINT" ? [done("d3", "REPAINT", "CANCELLED")] : [],
  })),
};

test("lanes: Wash, Detailing, Paint; each with its own Waiting queues, bays and today's finished cars", () => {
  const lanes = boardLanes(board as never, day as never);
  assert.deepEqual(lanes.map((l) => l.label), ["Wash", "Detailing", "Paint"]);
  const [wash, detailing, paint] = lanes;
  assert.deepEqual(wash.waiting.map((w) => w.code), ["WASH"]);
  assert.deepEqual(detailing.waiting.map((w) => w.code), ["DETAILING_COATING", "TINT_PPF"]);
  assert.deepEqual(paint.bays.map((b) => b.id), ["pb1"]);
  assert.deepEqual(wash.done.map((b) => b.id), ["d1", "d2"], "only COMPLETED cars of the lane's queues");
  assert.deepEqual(paint.done, [], "a cancelled visit is not done");
  assert.deepEqual(wash.counts, { waiting: 1, inBay: 1, done: 2 });
  assert.deepEqual(detailing.counts, { waiting: 1, inBay: 0, done: 0 });
  assert.deepEqual(boardLanes(board as never, null)[0].counts, { waiting: 1, inBay: 1, done: 0 }, "Done waits for its read");
});

function render(role: "ADMIN" | "STAFF") {
  const resources = require("./use-admin-resource");
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url?.startsWith("/api/admin/board?") ? board : url?.startsWith("/api/admin/queues?") ? day : null,
    loading: false, error: null, reload: async () => {}, setData: () => {},
  }));
  try {
    return renderToStaticMarkup(createElement(require("./bay-board").BayBoard, { role }));
  } finally {
    mock.restoreAll();
  }
}

test("each row reads Waiting, then its bays, then Done, under a heading with the counts", () => {
  const html = render("ADMIN");
  const at = (s: string) => html.indexOf(s);
  for (const label of ["Wash row", "Detailing row", "Paint row"]) assert.ok(at(`aria-label="${label}"`) > 0, label);
  assert.ok(at('aria-label="Wash row"') < at('aria-label="Detailing row"') && at('aria-label="Detailing row"') < at('aria-label="Paint row"'));
  assert.ok(html.includes("1 waiting · 1 in bay · 2 done"));
  // Column sections (the phone picker lists the same names earlier in the row).
  const col = (name: string) => at(`aria-label="${name}"`);
  assert.ok(col("Waiting · Wash") < col("Wash bay 1") && col("Wash bay 1") < col("Done · Wash"));
  assert.ok(col("Done · Wash") < at('aria-label="Detailing row"'), "Done closes its own row");
  assert.ok(col("Waiting · TINT_PPF") < col("Detail bay 1") && col("Detail bay 1") < col("Done · Detailing"));
  assert.ok(html.includes("No cars finished yet"));
});

test("Done cards open the booking but have no move controls; open cars keep their move form", () => {
  const html = render("ADMIN");
  const doneStart = html.indexOf('aria-label="Done · Wash"'), doneEnd = html.indexOf('aria-label="Detailing row"');
  assert.ok(doneStart > 0 && doneEnd > doneStart);
  const doneHtml = html.slice(doneStart, doneEnd);
  assert.ok(doneHtml.includes("ZEUS-D1") && doneHtml.includes("ZEUS-D2"));
  assert.equal(doneHtml.includes("ZEUS-X1"), false);
  assert.equal(doneHtml.includes("Move car"), false);
  assert.ok(html.includes('aria-label="Move ZEUS-W1 to bay"'));
  assert.equal(render("STAFF").includes("Move car"), false);
});

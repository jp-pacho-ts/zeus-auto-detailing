/* eslint-disable @typescript-eslint/no-require-imports */
// P1-62 A2 (LE 2026-11-07): the board is one fixed Waiting lane, the containers in the middle, one fixed Done lane. The three-row (Wash,
// Detailing, Paint) structure, its sideways-scrolling rows and the edge fades are gone, so the tests of those were replaced by tests of the
// new structure (below). The pure edge-scroll helpers are still exported and keep their tests.
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
  queueName: "Wash",
  queuePosition: 1,
  vehicleModel: "Synthetic Toyota Vios",
  vehiclePlate: null,
  sizeCode: "S",
  status: "IN_PROGRESS",
  assignedBayId: null,
  lines: [{ id: "line", name: "Basic Wash", workStatus: "WAITING", queueCode: "WASH" }],
  assignedWorkers: [{ staffId: "staff", name: "Synthetic Technician", isActive: true }],
  progress: { done: 0, total: 1 },
};
// A card already in a bay has no queueName (only Waiting cards carry it); the board looks it up by queue code.
const { queueName: _unused, ...cardInBay } = card;
void _unused;
const inBay = { ...cardInBay, id: "car2", referenceCode: "ZEUS-TEST18", queueCode: "REPAINT", assignedBayId: "bay0", lines: [{ id: "l2", name: "Repaint", workStatus: "IN_PROGRESS" }] };
const doneCard = {
  id: "car3", referenceCode: "ZEUS-TEST19", revision: 2, bookingDate: "2026-10-20", queueCode: "WASH", queueName: "Wash", vehicleModel: "Synthetic Honda City",
  vehiclePlate: "SYN 123", sizeCode: "S", lines: [{ id: "l3", name: "Basic Wash" }, { id: "l4", name: "Tint" }],
  workers: [{ staffId: "s1", name: "Ana Synthetic", isActive: true }, { staffId: "s2", name: "Ben Synthetic", isActive: true }], finishedAt: "2026-10-20T02:40:00.000Z",
};
const bay = (i: number, containerId: string, cards: unknown[] = []) => ({
  id: "bay" + i, name: "Bay " + i, bayType: "WASH", containerId, sortOrder: i, isActive: true, updatedAt: "2026-10-20T00:00:00.000Z", cards,
});
const containers = [
  { id: "k1", name: "Wash", sortOrder: 1, usualQueues: ["WASH"], updatedAt: "2026-10-20T00:00:00.000Z", bays: [bay(0, "k1", [inBay]), bay(1, "k1"), bay(2, "k1")] },
  { id: "k2", name: "Detailing", sortOrder: 2, usualQueues: [], updatedAt: "2026-10-20T00:00:00.000Z", bays: [bay(3, "k2"), bay(4, "k2")] },
  { id: "k3", name: "Express wash", sortOrder: 3, usualQueues: ["WASH", "TINT_PPF"], updatedAt: "2026-10-20T00:00:00.000Z", bays: [bay(5, "k3")] },
];
const board = {
  date: "2026-10-20",
  closed: null,
  workers: [],
  containers,
  waiting: [card],
  done: [doneCard],
  queues: ["WASH", "DETAILING_COATING", "TINT_PPF", "REPAINT"].map((code, i) => ({ code, name: code === "WASH" ? "Wash" : code === "REPAINT" ? "Repaint" : code, bayType: i === 0 ? "WASH" : i < 3 ? "DETAILING" : "PAINT", waiting: [] })),
  bays: containers.flatMap((c) => c.bays),
};
function render(role: "ADMIN" | "STAFF") {
  const resources = require("./use-admin-resource");
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url === "/api/admin/bays" ? board.bays : url?.startsWith("/api/admin/board?") ? board : null,
    loading: false,
    error: null,
    reload: async () => {},
    setData: () => {},
  }));
  try {
    return renderToStaticMarkup(createElement(require("../bay-workspace").BayWorkspace, { role }));
  } finally {
    mock.restoreAll();
  }
}
const at = (html: string, s: string) => html.indexOf(s);

test("Bay board defaults to Kanban: one Waiting lane, the containers, one Done lane, in that order", () => {
  const html = render("ADMIN");
  assert.ok(html.includes('aria-pressed="true">Kanban'));
  for (const value of ["Bays", "Opening hours", "Synthetic Toyota Vios", "No plate", "Basic Wash", "Synthetic Technician", "Carry-over", "Wash", "Detailing", "Express wash"])
    assert.ok(html.includes(value), value);
  const waiting = at(html, 'aria-label="Waiting"'), wash = at(html, 'aria-label="Wash"'), done = at(html, 'aria-label="Done"');
  assert.ok(waiting > 0 && waiting < wash && wash < at(html, 'aria-label="Detailing"') && at(html, 'aria-label="Express wash"') < done, "Waiting, containers, Done");
  for (const bayName of ["Bay 0", "Bay 5"]) assert.ok(html.includes(`aria-label="${bayName}"`), bayName);
  assert.equal(html.split('data-board-zone="WAITING"').length, 2, "exactly one Waiting lane");
  assert.equal(html.split('data-board-zone="DONE"').length, 2, "exactly one Done lane");
  assert.equal(html.includes("Waiting ·"), false, "no per-kind Waiting columns");
  assert.equal(html.includes("row\""), false, "no per-kind rows");
});

test("every card carries ONE grey outline service tag; a mixed booking reads 'Wash + 2 more'; no per-kind colours", () => {
  const mixed = { ...card, lines: [...card.lines, { id: "x", name: "Tint", workStatus: "WAITING", queueCode: "TINT_PPF" }, { id: "y", name: "Detail", workStatus: "WAITING", queueCode: "DETAILING_COATING" }] };
  const resources = require("./use-admin-resource");
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url?.startsWith("/api/admin/board?") ? { ...board, waiting: [mixed] } : null, loading: false, error: null, reload: async () => {}, setData: () => {},
  }));
  try {
    const html = renderToStaticMarkup(createElement(require("./bay-board").BayBoard, { role: "ADMIN" }));
    const tags = html.match(/<span data-service-tag="true" class="[^"]*">[^<]*<\/span>/g) ?? [];
    assert.equal(tags.length, 3, "waiting, in-bay and done card each carry one tag");
    assert.ok(tags.some((t) => t.includes(">Wash + 2 more<")), "mixed tag");
    assert.ok(tags.some((t) => t.includes(">Repaint<")), "in-bay card tag");
    assert.equal(new Set(tags.map((t) => t.match(/class="([^"]*)"/)![1])).size, 1, "one pill style for every tag");
    assert.doesNotMatch(tags.join(""), /(?:bg|text|border)-(?:red|blue|green|amber|yellow|emerald|sky|violet|rose|orange|purple|pink|teal|cyan|indigo|lime)/, "no per-kind colours");
  } finally {
    mock.restoreAll();
  }
});

test("Done card shows the finish time (Manila) and the workers, opens the booking, and has no move controls", () => {
  const html = render("ADMIN");
  const done = html.slice(at(html, 'aria-label="Done"'));
  assert.ok(done.includes("ZEUS-TEST19") && done.includes("Finished 10:40") && done.includes("Ana Synthetic, Ben Synthetic"), "finish time and workers");
  assert.ok(done.includes("Wash + 1 more"), "tag");
  assert.equal(done.includes("Move car"), false);
});

test("containers: ADMIN gets Add container, a menu on every container, Add bay and a menu on every bay; STAFF gets none", () => {
  const admin = render("ADMIN");
  assert.ok(admin.includes('id="add-container-name"') && admin.includes("Add container"));
  for (const c of containers) {
    assert.ok(admin.includes(`aria-label="Options for ${c.name}"`), c.name);
    assert.ok(admin.includes(`aria-label="Add bay to ${c.name}"`), c.name);
  }
  assert.ok(admin.includes("Usually for Wash") && admin.includes("No usual service") && admin.includes("Usually for Wash and Tint and PPF"), "the label line under each name");
  assert.equal(admin.includes("sr-only"), false, "nothing on the board is an absolutely positioned sr-only span");
  assert.equal(admin.includes("<dialog"), false, "no dialog is open until asked");
  const staff = render("STAFF");
  for (const hidden of ["Add bay", "Add container", "Options for", "aria-haspopup", "Move car"]) assert.equal(staff.includes(hidden), false, hidden);
  assert.ok(staff.includes("ZEUS-TEST17") && staff.includes("ZEUS-TEST19"), "STAFF still sees and opens cards");
});

test("phone: Waiting, Bays and Done tabs with 44px targets; no daily-limits panel", () => {
  const html = render("ADMIN");
  const group = html.match(/<div role="group" aria-label="Board area"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(group.includes("Waiting 1") && group.includes("Bays 1") && group.includes("Done 1"), group);
  assert.equal((group.match(/min-h-\[44px\]/g) ?? []).length, 3);
  assert.doesNotMatch(html, /daily limit|Daily limit|dailyCap/i);
});

test("keyboard move lists every empty bay grouped by container, then Done (finish) only for a car that can finish", () => {
  const html = render("ADMIN");
  const form = html.slice(at(html, 'aria-label="Move ZEUS-TEST17 to bay"'), at(html, 'id="board-move-car"'));
  for (const c of containers) assert.ok(form.includes(`<optgroup label="${c.name}">`), c.name);
  assert.ok(form.includes("Bay 0 · Busy") && /<option value="bay0" disabled/.test(form), "a busy bay is listed but disabled");
  assert.ok(/<option value="bay1"(?![^>]*disabled)/.test(form), "an empty bay is selectable whatever the car is");
  assert.ok(form.includes("Done (finish)"), "this car is IN_PROGRESS, so it can finish");
});

test("a multi-service waiting card shows the first service, +N more and progress on one line with 44px targets and whole-card drag", () => {
  const resources = require("./use-admin-resource");
  const multiCard = {
    ...card,
    id: "car",
    lines: [
      { id: "l1", name: "Basic Wash", workStatus: "WAITING", queueCode: "WASH" },
      { id: "l2", name: "Engine Bay Clean", workStatus: "IN_PROGRESS", queueCode: "WASH" },
      { id: "l3", name: "Underchassis Wash", workStatus: "DONE", queueCode: "WASH" },
    ],
    progress: { done: 1, total: 3 },
  };
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url?.startsWith("/api/admin/board?") ? { ...board, waiting: [multiCard] } : null, loading: false, error: null, reload: async () => {}, setData: () => {},
  }));
  try {
    const html = renderToStaticMarkup(createElement(require("./bay-board").BayBoard, { role: "ADMIN" }));
    assert.ok(html.includes("Basic Wash"), "shows first service");
    assert.ok(html.includes("+2 more"), "summarizes remaining services on the same line");
    assert.ok(html.includes("1/3 done"), "shows inline progress");
    assert.equal(html.includes("<ul"), false, "services do not expand into a multi-line ul");
    const labelIdx = html.indexOf('aria-label="ZEUS-TEST17"');
    const articleHtml = html.slice(html.lastIndexOf("<article", labelIdx), html.indexOf("</article>", labelIdx));
    assert.match(articleHtml, /draggable="true"/);
    assert.match(articleHtml, /cursor-grab/);
    assert.match(articleHtml.match(/<button[^>]*id="board-card-car"[^>]*>/)?.[0] ?? "", /\bmin-h-\[44px\]/);
    assert.match(articleHtml.match(/<select[^>]*aria-label="Move ZEUS-TEST17 to bay"[^>]*>/)?.[0] ?? "", /\bmin-h-\[44px\]/);
    assert.match(articleHtml.match(/<button[^>]*id="board-move-car"[^>]*>/)?.[0] ?? "", /\bmin-h-\[44px\]/);
  } finally {
    mock.restoreAll();
  }
});

test("only an ADMIN card that is not mid-write or blocked can be dragged", () => {
  const { cardDraggable } = require("./bay-board");
  assert.equal(cardDraggable("ADMIN", false, false), true);
  assert.equal(cardDraggable("ADMIN", true, false), false, "busy");
  assert.equal(cardDraggable("ADMIN", false, true), false, "blocked");
  for (const role of ["STAFF", "DETAILER", "MANAGER"]) assert.equal(cardDraggable(role, false, false), false, role);
});

// P1-22 (LE 2026-10-29): Board day and Refresh board share the view switch's row, on its right from lg up and below it under lg.
test("Board day and Refresh board sit in one toolbar with the view switch, before the helper text", () => {
  const html = render("ADMIN");
  const toolbar = html.search(/<div class="[^"]*\blg:flex-row\b[^"]*\blg:justify-between\b[^"]*"><div role="group" aria-label="Bay board sections"/);
  assert.ok(toolbar >= 0, "the view switch opens a wrapping toolbar row");
  const day = html.indexOf('aria-label="Board day"', toolbar), refresh = html.indexOf("Refresh board", toolbar), helper = html.indexOf("One car per bay");
  assert.ok(day > toolbar && refresh > day && helper > refresh);
  assert.equal(html.split('aria-label="Board day"').length, 2, "one Board day field");
});

test("P1-25: edgeScrollStep and revealColumnScrollLeft follow the UI/UX speed curve and sideways-only reveal rules", () => {
  const { edgeScrollStep, revealColumnScrollLeft } = require("./bay-board");
  const rect = { left: 100, right: 900, top: 200, bottom: 700, width: 800 };
  const midScroll = { scrollLeft: 300, clientWidth: 800, scrollWidth: 2000 };
  // Outside vertical span -> no scroll
  assert.deepEqual(edgeScrollStep(895, 150, rect, midScroll, 16), { dir: 0, speed: 0, delta: 0 });
  // Center of row -> no scroll
  assert.deepEqual(edgeScrollStep(500, 400, rect, midScroll, 16), { dir: 0, speed: 0, delta: 0 });
  // Inner edge of right 80px zone (x = 820 -> depth = 0) -> 0
  assert.deepEqual(edgeScrollStep(820, 400, rect, midScroll, 20), { dir: 0, speed: 0, delta: 0 });
  // Halfway into right 80px zone (x = 860 -> depth = 0.5) -> speed = 150 + 850 * 0.25 = 362.5 px/s
  const halfRight = edgeScrollStep(860, 400, rect, midScroll, 20);
  assert.equal(halfRight.dir, 1);
  assert.equal(halfRight.speed, 362.5);
  assert.ok(Math.abs(halfRight.delta - 362.5 * 0.02) < 1e-6);
  // At right edge or up to 40px outside (x = 920 -> depth clamped to 1) and dt capped at 50ms -> speed = 1000 px/s, delta = 50px
  const fullRight = edgeScrollStep(920, 400, rect, midScroll, 120);
  assert.deepEqual(fullRight, { dir: 1, speed: 1000, delta: 50 });
  // Beyond 40px outside -> no scroll
  assert.deepEqual(edgeScrollStep(945, 400, rect, midScroll, 20), { dir: 0, speed: 0, delta: 0 });
  // Left edge zone at start of row (scrollLeft = 0) -> cannot scroll left further
  assert.deepEqual(edgeScrollStep(110, 400, rect, { ...midScroll, scrollLeft: 0 }, 20), { dir: 0, speed: 0, delta: 0 });
  // Left edge zone when scrolled right -> negative delta
  const leftStep = edgeScrollStep(100, 400, rect, midScroll, 20);
  assert.deepEqual(leftStep, { dir: -1, speed: 1000, delta: -20 });

  // Sideways column reveal (Section 9B):
  // Left edge under 48px fade -> scrollLeft = col.offsetLeft - 48
  assert.equal(revealColumnScrollLeft({ offsetLeft: 200, offsetWidth: 240 }, { scrollLeft: 180, clientWidth: 800, scrollWidth: 2000 }), 152);
  // Right edge under 48px fade -> scrollLeft = col.offsetLeft + col.offsetWidth - clientWidth + 48
  assert.equal(revealColumnScrollLeft({ offsetLeft: 750, offsetWidth: 240 }, { scrollLeft: 100, clientWidth: 800, scrollWidth: 2000 }), 238);
  // Already visible between fades -> unchanged
  assert.equal(revealColumnScrollLeft({ offsetLeft: 300, offsetWidth: 240 }, { scrollLeft: 100, clientWidth: 800, scrollWidth: 2000 }), 100);
});

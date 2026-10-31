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
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url === "/api/admin/bays" ? board.bays : url?.startsWith("/api/admin/board?") ? board : {
      date: board.date, closed: null, legacy: [],
      queues: board.queues.map(q => ({ ...q, bookings: [], committed: q.waiting.length, effectiveCap: null })),
    },
    loading: false,
    error: null,
    reload: async () => {},
    setData: () => {},
  }));
  try {
    return renderToStaticMarkup(
      createElement(require("../bay-workspace").BayWorkspace, { role }),
    );
  } finally {
    mock.restoreAll();
  }
}
test("Bay board defaults to Kanban with four Waiting queues, eight bays, captured car/services/staff/progress and a column selector", () => {
  const html = render("ADMIN");
  assert.ok(html.includes('aria-pressed="true">Kanban'));
  for (const q of board.queues)
    assert.ok(html.includes("Waiting \u00b7 " + q.name));
  for (const bay of board.bays) assert.ok(html.includes(bay.name));
  for (const value of [
    "Bays",
    "Opening hours",
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
  // P1-23 (LE 2026-10-29): the whole card is the drag source, shown by a grab cursor and a hint.
  const card = html.match(/<article[^>]*aria-label="ZEUS-TEST17"[^>]*>/)?.[0] ?? "";
  assert.match(card, /draggable="true"/, "the ADMIN card itself can be dragged");
  assert.match(card, /cursor-grab/, "the ADMIN card shows a grab cursor");
  assert.ok(html.includes("Drag this card to a bay"), "a short drag hint");
  assert.equal(html.includes(">Drag to bay<"), false, "no separate drag-only control");
});
test("STAFF board retains card/checklist entry but has no bay-move or worker-write controls", () => {
  const html = render("STAFF");
  assert.ok(html.includes("ZEUS-TEST17"));
  assert.ok(html.includes("Synthetic Technician"));
  for (const value of [
    "Drag to bay",
    "Drag this card",
    "Move car",
    "Assign worker",
    "Remove Synthetic Technician",
    'draggable="true"',
    "cursor-grab",
  ])
    assert.equal(html.includes(value), false, value);
});

test("only an ADMIN card that is not mid-write or blocked can be dragged", () => {
  const { cardDraggable } = require("./bay-board");
  assert.equal(cardDraggable("ADMIN", false, false), true);
  assert.equal(cardDraggable("ADMIN", true, false), false, "busy");
  assert.equal(cardDraggable("ADMIN", false, true), false, "blocked");
  for (const role of ["STAFF", "DETAILER", "MANAGER"]) assert.equal(cardDraggable(role, false, false), false, role);
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
    /<div class="[^"]*\blg:flex-row\b[^"]*\blg:justify-between\b[^"]*"><div role="group" aria-label="Bay board sections"/,
  );
  assert.ok(toolbar >= 0, "the view switch opens a wrapping toolbar row");
  const day = html.indexOf('aria-label="Board day"', toolbar),
    refresh = html.indexOf("Refresh board", toolbar),
    helper = html.indexOf("One car per bay");
  assert.ok(day > toolbar && refresh > day, "Board day, then Refresh board, follow the switch");
  assert.ok(helper > refresh, "the helper sentence stays under the toolbar");
  assert.equal(html.split('aria-label="Board day"').length, 2, "one Board day field");
});

// P1-22 / P1-25: columns in a row sit on one horizontal scrolling line from md up and stretch to
// one height. An empty column's slot keeps min-h-24 below lg and lg:min-h-[26rem] (ADMIN) /
// lg:min-h-[14rem] (STAFF) from lg up.
test("board columns sit on one sideways-scrolling row from md, stretch to equal height and keep empty-slot minimums", () => {
  for (const [role, min] of [["ADMIN", "lg:min-h-[26rem]"], ["STAFF", "lg:min-h-[14rem]"]] as const) {
    const html = render(role);
    const scrollers = html.match(/<div[^>]*data-board-row-scroll="[^"]*"[^>]*>/g) ?? [];
    assert.equal(scrollers.length, 3, role + ": one horizontal row scroller per row");
    for (const scroller of scrollers) {
      assert.doesNotMatch(scroller, /items-start|auto-fill/, role + ": rows do not top-align or wrap with auto-fill");
      for (const token of [
        "relative",
        "min-w-0",
        "grid",
        "grid-cols-1",
        "items-stretch",
        "gap-3",
        "md:flex",
        "md:overflow-x-auto",
        "md:overscroll-x-contain",
        "md:pb-2",
        "md:scroll-px-12",
        "[scrollbar-width:thin]",
        "[scrollbar-color:#3f3f46_transparent]",
        "hover:[scrollbar-color:#52525b_transparent]",
      ])
        assert.ok(scroller.includes(token), role + " scroller includes " + token + ": " + scroller);
    }
    const columns = html.match(/<section[^>]*aria-label="(Waiting \u00b7 |Bay |Done \u00b7 )[^"]*"[^>]*>/g) ?? [];
    assert.equal(columns.length, 4 + 8 + 3, role + ": every column");
    for (const column of columns) {
      assert.match(column, /\bflex-col\b/, role + ": " + column);
      assert.match(column, /\bmd:w-60\b/, role + " fixed column width from md: " + column);
      assert.match(column, /\bmd:shrink-0\b/, role + " columns do not shrink on md+: " + column);
      assert.match(column, /data-board-column="[^"]+"/, role + " column carries data-board-column: " + column);
    }
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

test("P1-25: each row has a relative fade wrapper, left/right w-12 edge fades, header scroll arrows before Add bay, and no sr-only elements", () => {
  const html = render("ADMIN");
  assert.equal(html.includes("sr-only"), false, "no sr-only spans inside the board");
  const wraps = html.match(/<div[^>]*data-board-row-wrap="[^"]*"[^>]*>/g) ?? [];
  assert.equal(wraps.length, 3, "three relative row wrappers");
  for (const wrap of wraps) assert.match(wrap, /\brelative\b/, wrap);
  const leftFades = html.match(/<div[^>]*data-board-fade="left"[^>]*>/g) ?? [];
  const rightFades = html.match(/<div[^>]*data-board-fade="right"[^>]*>/g) ?? [];
  assert.equal(leftFades.length, 3, "three left edge fades");
  assert.equal(rightFades.length, 3, "three right edge fades");
  for (const fade of [...leftFades, ...rightFades]) {
    assert.match(fade, /aria-hidden="true"/, fade);
    assert.match(fade, /\bw-12\b/, fade);
    assert.match(fade, /from-\[#0f0f11\]/, fade);
    assert.match(fade, /to-transparent/, fade);
  }
  for (const lane of ["Wash", "Detailing", "Paint"]) {
    const earlier = html.indexOf(`aria-label="Show earlier ${lane} columns"`);
    const more = html.indexOf(`aria-label="Show more ${lane} columns"`);
    const add = html.indexOf(`aria-label="Add bay to ${lane}"`);
    assert.ok(earlier > 0 && more > earlier && add > more, `${lane}: header scroll arrows sit before Add bay`);
  }
});

test("P1-25: multi-service cards render services on one line with +N more and inline progress while keeping 44px targets and whole-card drag", () => {
  const resources = require("./use-admin-resource");
  const multiCard = {
    ...card,
    lines: [
      { id: "l1", name: "Basic Wash", workStatus: "WAITING" },
      { id: "l2", name: "Engine Bay Clean", workStatus: "IN_PROGRESS" },
      { id: "l3", name: "Underchassis Wash", workStatus: "DONE" },
    ],
    progress: { done: 1, total: 3 },
  };
  const multiBoard = {
    ...board,
    queues: board.queues.map((q, i) => (i === 0 ? { ...q, waiting: [multiCard] } : q)),
  };
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url === "/api/admin/bays" ? multiBoard.bays : url?.startsWith("/api/admin/board?") ? multiBoard : null,
    loading: false,
    error: null,
    reload: async () => {},
    setData: () => {},
  }));
  try {
    const html = renderToStaticMarkup(createElement(require("./bay-board").BayBoard, { role: "ADMIN" }));
    assert.ok(html.includes("Basic Wash"), "shows first service");
    assert.ok(html.includes("+2 more"), "summarizes remaining services on the same line");
    assert.ok(html.includes("1/3 done"), "shows inline progress");
    assert.equal(html.includes("<ul"), false, "services do not expand into a multi-line ul");
    const labelIdx = html.indexOf('aria-label="ZEUS-TEST17"');
    const articleStart = html.lastIndexOf("<article", labelIdx);
    const articleEnd = html.indexOf("</article>", labelIdx);
    const articleHtml = html.slice(articleStart, articleEnd);
    assert.match(articleHtml, /draggable="true"/);
    assert.match(articleHtml, /cursor-grab/);
    const refBtn = articleHtml.match(/<button[^>]*id="board-card-car"[^>]*>/)?.[0] ?? "";
    const selectEl = articleHtml.match(/<select[^>]*aria-label="Move ZEUS-TEST17 to bay"[^>]*>/)?.[0] ?? "";
    const moveBtn = articleHtml.match(/<button[^>]*id="board-move-car"[^>]*>/)?.[0] ?? "";
    assert.match(refBtn, /\bmin-h-\[44px\]/);
    assert.match(selectEl, /\bmin-h-\[44px\]/);
    assert.match(moveBtn, /\bmin-h-\[44px\]/);
  } finally {
    mock.restoreAll();
  }
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

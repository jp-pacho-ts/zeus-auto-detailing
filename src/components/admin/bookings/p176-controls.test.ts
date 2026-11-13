/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const html = (type: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(type as never, props));

// P1-76: one select style (own chevron 12 px in, text stops before it) and one 44 px date style.
test("shared Select: native select, appearance-none, pr-9, 44 px, chevron 12 px in", () => {
  const { Select, dateClass } = require("./use-admin-resource");
  const out = html(Select, { "aria-label": "Status", children: createElement("option", { value: "A" }, "A") });
  assert.match(out, /^<span class="relative mt-1 block[^"]*"><select aria-label="Status" class="w-full appearance-none pr-9 min-h-\[44px\]/);
  const chevron = out.match(/<svg[^>]*>/)?.[0] ?? "";
  assert.match(chevron, /aria-hidden="true"/);
  assert.match(chevron, /class="[^"]*pointer-events-none absolute right-3 top-1\/2/);
  assert.match(dateClass, /min-h-\[44px\]/);
  assert.match(dateClass, /min-w-\[10\.5rem\]/);
  assert.doesNotMatch(dateClass, /w-full/, "a date field sizes to its content");
});

test("DayStepper: previous, date, next and Today, all 44 px; Today reads as selected on today", () => {
  const { DayStepper } = require("./use-admin-resource");
  const onToday = html(DayStepper, { label: "Board day", inputId: "board-day-input", inputLabel: "Board day", value: "2026-11-13", today: "2026-11-13", onChange: () => {} });
  assert.match(onToday, /aria-label="Previous day" class="[^"]*h-11 w-11/);
  assert.match(onToday, /aria-label="Next day" class="[^"]*h-11 w-11/);
  assert.match(onToday, /id="board-day-input" aria-label="Board day" type="date"/);
  assert.match(onToday, /aria-pressed="true"[^>]*>Today</);
  assert.doesNotMatch(onToday, /disabled=""[^>]*>Today</, "Today is not shown as a disabled button");
  const otherDay = html(DayStepper, { label: "Queue day", value: "2026-11-14", today: "2026-11-13", onChange: () => {} });
  assert.match(otherDay, /aria-pressed="false"[^>]*>Today</);
});

const containers = [
  { id: "c1", name: "Wash", bays: [
    { id: "b1", name: "Wash 1", isActive: true, cards: [{}] },
    { id: "b2", name: "Wash 2", isActive: true, cards: [] },
    { id: "b3", name: "Old bay", isActive: false, cards: [] },
  ] },
];

// CEO 2026-11-13: the Move button stays; it reads "Move car" until a place is chosen, then "Move to <place>".
test("MoveForm: a 'Move to…' placeholder, Waiting only for a seated car, Done only when finishable", () => {
  const { MoveForm } = require("./bay-board");
  const waiting = html(MoveForm, { card: { id: "k1", referenceCode: "ZEUS-1", assignedBayId: null }, containers, role: "ADMIN", disabled: false, canFinish: false, onMove: () => {} });
  assert.match(waiting, /<option value="" disabled="" selected="">Move to…<\/option>/);
  assert.doesNotMatch(waiting, />Waiting</, "a waiting car is not offered Waiting");
  assert.doesNotMatch(waiting, /Done \(finish\)/);
  assert.doesNotMatch(waiting, /Old bay/, "inactive bays are not offered");
  assert.match(waiting, /aria-label="Move ZEUS-1 to bay"/);
  assert.match(waiting, /id="board-move-k1"[^>]*>Move car</);
  const seated = html(MoveForm, { card: { id: "k2", referenceCode: "ZEUS-2", assignedBayId: "b2" }, containers, role: "ADMIN", disabled: false, canFinish: true, onMove: () => {} });
  assert.match(seated, /<option value="WAITING">Waiting<\/option>/);
  assert.match(seated, /<option value="DONE">Done \(finish\)<\/option>/);
  assert.match(seated, /<option value="b2" disabled="">Wash 2<\/option>/, "its own bay is not a target");
});

const booking = (over: Record<string, unknown> = {}) => ({
  id: "b1", referenceCode: "ZEUS-Q00001", status: "PENDING", bookingDate: "2026-11-13", queueCode: "WASH", queuePosition: 2,
  customerName: "Synthetic Customer", vehicleModel: "Toyota Vios", vehiclePlate: "QA 101", serviceName: "Basic Wash", bay: null,
  lines: [{ id: "l1", name: "Basic Wash", removed: false }],
  totals: { currentTotalCentavos: 18000, forQuoteCount: 1 },
  ...over,
});

// P1-76: one booking per row; the whole row opens it; reorder buttons stay separate controls.
test("BookingRows: the whole row is one button; reorder sits beside it for ADMIN in one queue", () => {
  const { BookingRows } = require("../bookings-tab");
  const props = { bookings: [booking(), booking({ id: "b2", referenceCode: "ZEUS-Q00002", queuePosition: 3 })], queueNames: { WASH: "Wash" }, emptyText: "No bookings on this day.", filter: "ALL", busy: false, onSelect: () => {}, onReorder: async () => {} };
  const admin = html(BookingRows, { ...props, role: "ADMIN", queueCode: "WASH" });
  assert.equal((admin.match(/id="booking-row-/g) ?? []).length, 2);
  assert.match(admin, /<li class="flex items-stretch"><button type="button" id="booking-row-b1"/);
  assert.match(admin, /aria-label="Move ZEUS-Q00001 down"/);
  const text = admin.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "\n").split("\n").map((t) => t.trim()).filter(Boolean);
  assert.deepEqual(text.slice(0, 7), ["Wash #2", "Booked", "ZEUS-Q00001", "Synthetic Customer · Toyota Vios · QA 101", "Basic Wash · Unassigned bay", "₱180.00", "+1 for quote"]);
  const staff = html(BookingRows, { ...props, role: "STAFF", queueCode: "WASH" });
  assert.doesNotMatch(staff, /aria-label="Move ZEUS/, "reorder is ADMIN only");
  const search = html(BookingRows, { ...props, role: "ADMIN", showDate: true });
  assert.match(search, /Fri, Nov 13, 2026/, "search results show the day");
  assert.doesNotMatch(search, /aria-label="Move ZEUS/, "no reorder outside one queue");
  assert.match(html(BookingRows, { ...props, bookings: [], role: "ADMIN" }), />No bookings on this day\.</);
  assert.match(html(BookingRows, { ...props, filter: "CONFIRMED", role: "ADMIN" }), />No bookings on this day\.</, "the Status filter applies");
});

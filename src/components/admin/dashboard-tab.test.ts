/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const booking = (over: Record<string, unknown> = {}) => ({
  id: "b1", referenceCode: "ZEUS-Q00001", snapshot: "QUEUE_V3", status: "PENDING", revision: 1, bookingDate: "2026-11-13",
  queueCode: "WASH", queuePosition: 3, customerName: "Synthetic Customer", vehicleModel: "Toyota Vios", vehiclePlate: "QA 101",
  sizeCode: "S", serviceName: "Basic Wash", depositStatus: "NONE", bay: null,
  lines: [
    { id: "l1", name: "Basic Wash", removed: false },
    { id: "l2", name: "Old Tint", removed: true },
  ],
  totals: { receiptTotalCentavos: 18000, receiptEstimatedCentavos: 18000, currentTotalCentavos: 18000, currentEstimateCentavos: 18000, forQuoteCount: 0 },
  ...over,
});

const row = (b: unknown, queue: string | null) =>
  renderToStaticMarkup(createElement(require("./dashboard-tab").QueueRow, { booking: b, queue, onOpen: () => {} }));

// P1-75: the whole row is one control that opens the booking; no link nested inside it.
test("Today's Queue row: one button with queue and position, status, customer, vehicle, services and bay", () => {
  const html = row(booking(), "Wash");
  assert.equal((html.match(/<button/g) ?? []).length, 1, "one control per row");
  assert.match(html, /^<button type="button" id="dash-booking-b1"/);
  assert.match(html, /min-h-\[44px\]/, "44 px tap target");
  const text = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(text.slice(0, 5), ["Wash #3", "Booked", "ZEUS-Q00001", "Synthetic Customer · Toyota Vios", "Basic Wash · Unassigned bay"]);
  assert.doesNotMatch(html, /Old Tint/, "removed services are not listed");
  assert.ok(text.includes("₱180.00"), "the current total, formatted from centavos");
  assert.ok(!text.some((t) => /for quote/.test(t)), "no quote note when nothing is for quote");
  const quoted = row(booking({ totals: { receiptTotalCentavos: 18000, receiptEstimatedCentavos: 618000, currentTotalCentavos: 18000, currentEstimateCentavos: 618000, forQuoteCount: 2 } }), "Wash");
  assert.match(quoted, />\+2 for quote</);
});

test("Today's Queue row: an older booking without a queue says so; the status uses the shared pill", () => {
  const { statusPill } = require("./bookings/detail/shared");
  const html = row(booking({ queueCode: null, queuePosition: null, status: "IN_PROGRESS", bay: { id: "x", name: "Wash 1" } }), null);
  assert.match(html, />Older booking</);
  assert.ok(html.includes(`class="${statusPill("IN_PROGRESS")}"`), "same status colours as Booking details");
  assert.match(html, /Basic Wash · Wash 1/);
});

// The list shows every booking today (no cap) and scrolls inside the card, not the page.
test("Today's Queue lists every booking and scrolls inside its card", () => {
  const src = readFileSync(join(__dirname, "dashboard-tab.tsx"), "utf8");
  assert.doesNotMatch(src, /activeBookings\.slice\(/, "no cap on the list");
  assert.match(src, /activeBookings\.map\(\(b\) => \(\s*<QueueRow/);
  assert.match(src, /lg:absolute lg:inset-0 lg:overflow-y-auto/);
  assert.match(src, /No bookings today/);
});

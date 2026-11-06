// P1-52 (LE 2026-11-06): "Booking received" is a boarding-pass ticket, like the Manage booking lookup. Reference and
// status on one side, the booking's details on the other, a dashed tear-off edge between them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingTicket, type TicketBooking } from "./booking-ticket";

const booking: TicketBooking = {
  referenceCode: "ZEUS-K7M4QX",
  statusWords: "Waiting for confirmation",
  confirmed: false,
  dayLabel: "Tuesday, November 10, 2026",
  arrival: "Bring your car any time during opening hours, 8 AM–6 PM, on your chosen day.",
  multiDay: false,
  lines: [
    { id: "a", name: "Basic Wash", quantity: 1, amount: "₱400.00" },
    { id: "b", name: "Engine Bay Wash", quantity: 1, amount: "₱450.00" },
  ],
  vehicle: "Small · Toyota Vios 2020",
  contact: "Juan dela Cruz · 0917 123 4567",
  total: { label: "Total", amount: "₱850.00", note: null },
};
const render = (over: Partial<{ copied: boolean }> = {}) =>
  renderToStaticMarkup(createElement(BookingTicket, { booking, copied: over.copied ?? false, onCopy: () => {}, onPrint: () => {} }));
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

test("the ticket shows the reference big in mono with the status, then Copy reference and Print receipt", () => {
  const m = render();
  assert.match(m, /<h2[^>]*id="reference-title"[^>]*class="[^"]*font-mono[^"]*"[^>]*>ZEUS-K7M4QX</);
  assert.match(text(m), /Waiting for confirmation/);
  assert.match(m, /<button[^>]*aria-label="Copy booking reference"/);
  assert.match(text(m), /Copy reference/);
  assert.match(text(m), /Print receipt/);
  assert.match(text(m), /Your request is sent\. The shop will text or call you to confirm\./);
  assert.match(text(render({ copied: true })), /Copied/);
});

test("the other side lists the day, services with amounts, vehicle, contact and total as before", () => {
  const t = text(render());
  assert.match(t, /Tuesday, November 10, 2026\./);
  assert.match(t, /Bring your car any time during opening hours/);
  assert.match(t, /Basic Wash.*₱400\.00/);
  assert.match(t, /Engine Bay Wash.*₱450\.00/);
  assert.match(t, /Small · Toyota Vios 2020/);
  assert.match(t, /Juan dela Cruz · 0917 123 4567/);
  assert.match(t, /Total ₱850\.00/);
});

test("a multi-day job says the day is the drop-off day", () => {
  const m = renderToStaticMarkup(createElement(BookingTicket, { booking: { ...booking, multiDay: true }, copied: false, onCopy: () => {}, onPrint: () => {} }));
  assert.match(text(m), /This job takes more than one day: this is your drop-off day/);
});

test("a confirmed booking says so", () => {
  const m = renderToStaticMarkup(createElement(BookingTicket, { booking: { ...booking, confirmed: true, statusWords: "Confirmed" }, copied: false, onCopy: () => {}, onPrint: () => {} }));
  assert.match(text(m), /Your booking is confirmed\./);
  assert.doesNotMatch(text(m), /Your request is sent/);
});

test("the ticket has the Manage booking look: rounded card, a stub with the dashed edge and its two notches, no sharp corners", () => {
  const m = render();
  assert.match(m, /<section[^>]*class="[^"]*rounded-2xl[^"]*print-receipt-card|<section[^>]*class="[^"]*print-receipt-card[^"]*rounded-2xl/);
  assert.match(m, /data-part="stub"[^>]*class="[^"]*border-dashed/);
  assert.match(m, /data-part="stub"[^>]*class="[^"]*before:rounded-full[^"]*after:rounded-full/);
  for (const [, c] of m.matchAll(/class="([^"]*)"/g)) assert.doesNotMatch(c, /(^| )rounded( |$)/, "no 4 px corner: " + c);
  const buttons = [...m.matchAll(/<button[^>]*class="([^"]*)"/g)].map((x) => x[1]);
  assert.equal(buttons.length, 2);
  for (const c of buttons) assert.match(c, /rounded-xl/);
});

test("print: the receipt keeps the print-receipt-card class and the buttons stay out of the print", () => {
  const m = render();
  assert.match(m, /class="[^"]*print-receipt-card/);
  assert.match(m, /class="[^"]*no-print[^"]*"[^>]*>\s*<button/);
});

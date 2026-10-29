import assert from "node:assert/strict";
import { test } from "node:test";
import type { DayBookingView } from "@/types/contracts";
import { customerConfirmationMessage } from "./bookings";

const booking: DayBookingView = {
  id: "11111111-1111-4111-8111-111111111111", referenceCode: "ZEUS-TEST01", status: "PENDING", revision: 1,
  bookingDate: "2027-03-01", timezone: "Asia/Manila", vehicleCategoryId: "22222222-2222-4222-8222-222222222222",
  vehicleCategoryName: "Small", currency: "PHP", totalPriceCentavos: 23000, estimatedTotalCentavos: 23000,
  lines: [{ serviceId: "33333333-3333-4333-8333-333333333333", name: "Synthetic wash", quantity: 1, priceStatus: "PRICED", subtotalCentavos: 23000, referenceSubtotalCentavos: null }],
};

test("P1-24: an unknown quote is not shown as a zero or a guaranteed final estimate", () => {
  const message = customerConfirmationMessage({ ...booking, totalPriceCentavos: 0, estimatedTotalCentavos: null,
    lines: [{ ...booking.lines[0], name: "Synthetic quote service", priceStatus: "FOR_QUOTE", subtotalCentavos: null }]
  }, "https://synthetic.example.invalid");
  assert.match(message.text, /Estimated total: To be quoted by the shop/);
  assert.match(message.text, /Synthetic quote service.*for quote/i);
  assert.match(message.text, /shop will confirm the final price/i);
  assert.doesNotMatch(message.text, /PHP 0\.00/);
  assert.ok(message.text.includes("https://synthetic.example.invalid/book/manage"));
});

test("P1-24: receipt uses committed date and content allowlist, never unexpected private properties", () => {
  const privateBooking = { ...booking, customerEmail: "private@example.test", customerName: "PRIVATE CUSTOMER", notes: "PRIVATE NOTES", bayName: "PRIVATE BAY", capacity: 123,
    lines: booking.lines.map(line => ({ ...line, staffNote: "PRIVATE STAFF NOTE" })) };
  const message = customerConfirmationMessage(privateBooking, "https://synthetic.example.invalid");
  assert.equal(message.subject, "Booking received ZEUS-TEST01");
  assert.ok(message.text.includes("2027-03-01 (Asia/Manila)"));
  assert.ok(message.text.includes("Estimated total: PHP 230.00"));
  for (const canary of ["private@example.test", "PRIVATE CUSTOMER", "PRIVATE NOTES", "PRIVATE BAY", "PRIVATE STAFF NOTE", booking.id]) {
    assert.equal(message.text.includes(canary), false);
    assert.equal(message.subject.includes(canary), false);
  }
});
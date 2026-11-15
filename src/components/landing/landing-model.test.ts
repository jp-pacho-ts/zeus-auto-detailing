import test from "node:test";
import assert from "node:assert/strict";
import { money, servicePrice, bookingHref, pruneSelection, estimateLabels, selectionKey, quoteFailure, bookingAction, serviceArrow } from "./landing-model";
import type { BookingCatalog, ServicePackage, VehicleCategory } from "@/types/catalog-contracts";
const size = { id: "size", code: "S", name: "Small" } as VehicleCategory;
const service = { id: "wash", slug: "wash", name: "Wash", type: "BASE", unit: "VEHICLE", offers: [{ vehicleCategoryId: "size", onlineBooking: "PRICED", state: "OFFERED", unitPriceCentavos: 123450, pickupPriceCentavos: 150000, duration: { kind: "TIMED", minutes: 30 } }] } as ServicePackage;
const catalog = { services: [service, { ...service, id: "extra", type: "ADD_ON" }], addOnCompatibility: [{ baseServiceId: "wash", addOnServiceId: "extra" }] } as BookingCatalog;
test("money retains centavos, unknown prices never become zero", () => {
  assert.equal(money(123450), "₱1,234.50"); assert.equal(money(123400), "₱1,234");
  assert.equal(servicePrice(service, size, undefined), "₱1,234.50");
  assert.equal(servicePrice({ ...service, offers: [] }, size), "Not offered for this size");
  assert.equal(servicePrice({ ...service, offers: [{ ...service.offers[0], onlineBooking: "FOR_QUOTE", state: "UNCONFIRMED", unitPriceCentavos: null }] } as ServicePackage, size), "Ask for a price");
});
test("deep links require precisely one priced BASE VEHICLE line, quantity one and small size", () => {
  const lines = [{ serviceId: "wash", quantity: 1 }];
  assert.equal(bookingHref(catalog, size, lines), "/book?service=wash&vehicle=S");
  for (const changed of [[], [...lines, { serviceId: "extra", quantity: 1 }], [{ serviceId: "wash", quantity: 2 }]]) assert.equal(bookingHref(catalog, size, changed), "/book");
  assert.equal(bookingHref(catalog, { ...size, code: "L" }, lines), "/book");
  assert.equal(bookingHref({ ...catalog, services: [{ ...service, unit: "PANEL" }] }, size, lines), "/book");
});
test("orphan add-ons are removed; compatible add-ons stay; selection identity changes on every value", () => {
  assert.deepEqual(pruneSelection(catalog, [{ serviceId: "extra", quantity: 1 }]), []);
  assert.equal(pruneSelection(catalog, [{ serviceId: "wash", quantity: 1 }, { serviceId: "extra", quantity: 1 }]).length, 2);
  assert.notEqual(selectionKey("size", undefined, [{ serviceId: "wash", quantity: 1 }]), selectionKey("size", "PICKUP", [{ serviceId: "wash", quantity: 1 }]));
});
test("mixed quotes label known subtotal and null estimate explicitly", () => {
  assert.deepEqual(estimateLabels(false, null), { subtotal: "Total", estimate: null });
  assert.deepEqual(estimateLabels(true, null), { subtotal: "Known-price subtotal", estimate: "Unknown until inspection" });
  assert.equal(estimateLabels(true, 123450).estimate, "₱1,234.50");
});
test("quote failures map to fixed public messages; a non-JSON body never shows parser text", () => {
  assert.deepEqual(quoteFailure(429, { error: { retryAfterSeconds: 7 } }, null), { message: "Too many estimates right now. Try again in 7 seconds.", seconds: 7 });
  assert.equal(quoteFailure(429, null, "30").seconds, 30);
  assert.equal(quoteFailure(409, { error: { code: "CATALOG_UPDATED" } }, null).message, "Prices just changed. Get a new estimate.");
  for (const [status, answer] of [[503, { error: { code: "ONLINE_BOOKING_UNAVAILABLE", message: "x" } }], [502, null], [200, null]] as const) assert.deepEqual(quoteFailure(status, answer, null), { message: "Prices are unavailable right now." });
  assert.equal(quoteFailure(400, { error: { message: "Choose a size." } }, null).message, "Choose a size.");
  assert.equal(quoteFailure(400, { error: {} }, null).message, "Could not get an estimate. Try again later.");
  for (const status of [400, 409, 429, 500, 502, 503]) assert.doesNotMatch(quoteFailure(status, null, null).message, /call the shop|unexpected token|json/i);
});
test("every booking state gives one label and target, on pills and per-service arrows", () => {
  assert.deepEqual(bookingAction("OPEN", "+630"), { label: "Book an appointment", href: "/book" });
  assert.deepEqual(bookingAction("PAUSED", "+630"), { label: "Call to book", href: "tel:+630" });
  assert.deepEqual(bookingAction("UNKNOWN", "+630"), { label: "Check online booking", href: "/book" });
  assert.deepEqual(serviceArrow(catalog, size, service, "OPEN", "+630"), { label: "Book Wash", href: "/book?service=wash&vehicle=S" });
  assert.deepEqual(serviceArrow(catalog, undefined, service, "OPEN", "+630"), { label: "Book Wash", href: "/book" });
  assert.deepEqual(serviceArrow(catalog, { ...size, code: "XL" }, service, "OPEN", "+630"), { label: "Book Wash", href: "/book" });
  assert.deepEqual(serviceArrow(catalog, size, service, "PAUSED", "+630"), { label: "Call to book Wash", href: "tel:+630" });
  assert.deepEqual(serviceArrow(catalog, size, service, "UNKNOWN", "+630"), { label: "Book Wash", href: "/book?service=wash&vehicle=S" });
});

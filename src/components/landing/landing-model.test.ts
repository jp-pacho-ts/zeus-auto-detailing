import test from "node:test";
import assert from "node:assert/strict";
import { money, servicePrice, bookingHref, pruneSelection, estimateLabels, selectionKey } from "./landing-model";
import type { BookingCatalog, ServicePackage, VehicleCategory } from "@/types/catalog-contracts";
const size = { id: "size", code: "S", name: "Small" } as VehicleCategory;
const service = { id: "wash", slug: "wash", name: "Wash", type: "BASE", unit: "VEHICLE", offers: [{ vehicleCategoryId: "size", onlineBooking: "PRICED", state: "OFFERED", unitPriceCentavos: 123450, pickupPriceCentavos: 150000, duration: { kind: "TIMED", minutes: 30 } }] } as ServicePackage;
const catalog = { services: [service, { ...service, id: "extra", type: "ADD_ON" }], addOnCompatibility: [{ baseServiceId: "wash", addOnServiceId: "extra" }] } as BookingCatalog;
test("money retains centavos, unknown prices never become zero", () => {
  assert.equal(money(123450), "₱1,234.50"); assert.equal(money(123400), "₱1,234");
  assert.equal(servicePrice(service, size, undefined), "₱1,234.50");
  assert.equal(servicePrice({ ...service, offers: [] }, size), "Not offered for this vehicle");
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

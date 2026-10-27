// P1-05 demo slice: the queue-model booking wizard's pure rules (ADR-005, P1-03 create v4).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookingCatalog, BookingQuote, ServicePackage } from "@/types/catalog-contracts";
import type { LifecycleError } from "@/types/catalog-contracts";
import {
  availableAddOns,
  createDayRequest,
  dayStateLabel,
  isMultiDay,
  offerLabel,
  publicCreateError,
  quoteTotal,
  resolveDeepLink,
  selectionLines,
} from "./day-booking";

const S = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
const offer = (sizeId: string, o: Record<string, unknown>) => ({ id: id(900 + Math.floor(Math.random() * 99)), vehicleCategoryId: sizeId, duration: { kind: "UNKNOWN" }, ...o });
const priced = (sizeId: string, centavos: number) => offer(sizeId, { state: "OFFERED", bookingMode: "FIXED_ONLINE", onlineBooking: "PRICED", unitPriceCentavos: centavos, compareAtCentavos: null });
const forQuote = (sizeId: string, centavos: number | null) => offer(sizeId, { state: "UNCONFIRMED", bookingMode: "QUOTE_REQUIRED", onlineBooking: "FOR_QUOTE", unitPriceCentavos: centavos, compareAtCentavos: null });
const notOffered = (sizeId: string) => offer(sizeId, { state: "NOT_OFFERED", bookingMode: "QUOTE_REQUIRED", onlineBooking: "UNAVAILABLE", unitPriceCentavos: null, compareAtCentavos: null });
const service = (n: number, slug: string, o: Partial<ServicePackage>): ServicePackage => ({
  id: id(n), slug, name: slug, description: null, category: "WASH", type: "BASE", unit: "VEHICLE", inclusions: [], productName: null, hardness: null,
  warrantyMonths: null, referenceUnitPriceCentavos: null, offers: [], ...o,
} as ServicePackage);
const wash = service(1, "basic-wash", { offers: [priced(S, 18000), priced(M, 22000)] as never });
const glass = service(2, "glass-acid-rain-removal", { type: "ADD_ON", offers: [forQuote(S, 50000), notOffered(M)] as never });
const tint = service(3, "regular-tint", { category: "TINT", offers: [forQuote(S, 250000), forQuote(M, null)] as never });
const ppf = service(4, "ppf-8-0-mil", { category: "PPF", offers: [forQuote(S, null), forQuote(M, null)] as never });
const panel = service(5, "panel-repaint", { category: "REPAINT", unit: "PANEL", referenceUnitPriceCentavos: 350000, offers: [forQuote(S, null), forQuote(M, null)] as never });
const coating = service(6, "eclipse-graphene", { category: "GRAPHENE", offers: [forQuote(S, 1500000), notOffered(M)] as never });
const catalog = {
  catalogReleaseId: id(99), catalogVersion: "v2-queues",
  vehicleCategories: [
    { id: S, code: "S", name: "Small · Compact / Sedan", description: null, sortOrder: 1 },
    { id: M, code: "M", name: "Medium · Compact SUV / Crossover", description: null, sortOrder: 2 },
    { id: id(7), code: "MOTOR", name: "Motor / Motorcycle", description: null, sortOrder: 0 },
  ],
  services: [wash, glass, tint, ppf, panel, coating],
  addOnCompatibility: [{ baseServiceId: wash.id, addOnServiceId: glass.id }],
} as BookingCatalog;

test("day states read Available, Fully booked and Closed; no counts", () => {
  assert.equal(dayStateLabel("AVAILABLE"), "Available");
  assert.equal(dayStateLabel("FULLY_BOOKED"), "Fully booked");
  assert.equal(dayStateLabel("CLOSED"), "Closed");
});

test("an offer reads as its price, 'For quote' with the reference estimate, or not offered for the size", () => {
  assert.deepEqual(offerLabel(wash, S), { bookable: true, forQuote: false, text: "₱180.00" });
  assert.deepEqual(offerLabel(tint, S), { bookable: true, forQuote: true, text: "For quote · est. ₱2,500.00" });
  assert.deepEqual(offerLabel(tint, M), { bookable: true, forQuote: true, text: "For quote" });
  assert.deepEqual(offerLabel(glass, M), { bookable: false, forQuote: false, text: "Not offered for this size" });
  // Panel repaint: the per-panel reference (A2: 3,500 per panel) times the panel count.
  assert.deepEqual(offerLabel(panel, S, 3), { bookable: true, forQuote: true, text: "For quote · est. ₱10,500.00" });
});

test("add-ons appear only for a chosen compatible base", () => {
  assert.deepEqual(availableAddOns(catalog, []).map((s) => s.slug), []);
  assert.deepEqual(availableAddOns(catalog, [tint.id]).map((s) => s.slug), []);
  assert.deepEqual(availableAddOns(catalog, [wash.id]).map((s) => s.slug), ["glass-acid-rain-removal"]);
});

test("selection lines keep chosen bases first, then add-ons; orphaned add-ons and unbookable picks drop out", () => {
  const picks = [{ serviceId: glass.id, quantity: 1 }, { serviceId: tint.id, quantity: 1 }, { serviceId: wash.id, quantity: 1 }, { serviceId: panel.id, quantity: 4 }];
  assert.deepEqual(selectionLines(catalog, S, picks), [
    { serviceId: tint.id, quantity: 1 }, { serviceId: wash.id, quantity: 1 }, { serviceId: panel.id, quantity: 4 }, { serviceId: glass.id, quantity: 1 },
  ]);
  assert.deepEqual(selectionLines(catalog, S, [{ serviceId: glass.id, quantity: 1 }, { serviceId: tint.id, quantity: 1 }]), [{ serviceId: tint.id, quantity: 1 }]);
  // Glass is not offered for M; coating is not offered for M.
  assert.deepEqual(selectionLines(catalog, M, [{ serviceId: wash.id, quantity: 1 }, { serviceId: glass.id, quantity: 1 }, { serviceId: coating.id, quantity: 1 }]), [{ serviceId: wash.id, quantity: 1 }]);
  // Per-vehicle lines are always one.
  assert.deepEqual(selectionLines(catalog, S, [{ serviceId: wash.id, quantity: 3 }]), [{ serviceId: wash.id, quantity: 1 }]);
});

const quote = (lines: { priceStatus: "PRICED" | "FOR_QUOTE"; subtotalCentavos: number | null; referenceSubtotalCentavos: number | null }[], total: number, estimate: number | null) =>
  ({ lines, totalPriceCentavos: total, estimatedTotalCentavos: estimate }) as unknown as BookingQuote;

test("the total is final when every line is priced, an estimate while any line is for quote", () => {
  assert.deepEqual(quoteTotal(quote([{ priceStatus: "PRICED", subtotalCentavos: 18000, referenceSubtotalCentavos: null }], 18000, 18000)),
    { label: "Total", amount: "₱180.00", note: null });
  assert.deepEqual(quoteTotal(quote([{ priceStatus: "PRICED", subtotalCentavos: 18000, referenceSubtotalCentavos: null }, { priceStatus: "FOR_QUOTE", subtotalCentavos: null, referenceSubtotalCentavos: 250000 }], 18000, 268000)),
    { label: "Estimated total", amount: "₱2,680.00", note: "1 service is for quote. The shop confirms its final price." });
  assert.deepEqual(quoteTotal(quote([{ priceStatus: "FOR_QUOTE", subtotalCentavos: null, referenceSubtotalCentavos: null }, { priceStatus: "FOR_QUOTE", subtotalCentavos: null, referenceSubtotalCentavos: null }], 0, null)),
    { label: "Estimated total", amount: "To be quoted", note: "2 services are for quote. The shop confirms their final price." });
});

test("PPF, repaint and coating make the chosen day a drop-off day; washes and tint do not", () => {
  assert.equal(isMultiDay(catalog, [wash.id, tint.id]), false);
  for (const s of [ppf, panel, coating]) assert.equal(isMultiDay(catalog, [wash.id, s.id]), true, s.slug);
  const multiDayByDuration = { ...catalog, services: [service(8, "long-wash", { offers: [offer(S, { state: "OFFERED", bookingMode: "FIXED_ONLINE", onlineBooking: "PRICED", unitPriceCentavos: 1, compareAtCentavos: null, duration: { kind: "MULTI_DAY", elapsedDays: 2 } })] as never })] } as BookingCatalog;
  assert.equal(isMultiDay(multiDayByDuration, [id(8)]), true);
});

test("deep links resolve a size by code, name or the home page's 'sedan', and a service by slug", () => {
  assert.deepEqual(resolveDeepLink(catalog, "sedan", "basic-wash"), { vehicleId: S, serviceId: wash.id, unknown: false });
  assert.deepEqual(resolveDeepLink(catalog, "M", undefined), { vehicleId: M, serviceId: null, unknown: false });
  assert.deepEqual(resolveDeepLink(catalog, "motorcycle", undefined), { vehicleId: id(7), serviceId: null, unknown: false });
  assert.deepEqual(resolveDeepLink(catalog, "spaceship", "basic-wash"), { vehicleId: null, serviceId: null, unknown: true });
  assert.deepEqual(resolveDeepLink(catalog, undefined, undefined), { vehicleId: null, serviceId: null, unknown: false });
});

const fullQuote = {
  version: 3, catalogReleaseId: id(99), catalogFingerprint: "a".repeat(64), pricingAlgorithm: "php-service-size-v3", vehicleCategoryId: S, primaryServiceId: wash.id, queueId: "WASH",
  lines: [{ serviceId: wash.id, offerId: id(50), kind: "BASE", name: "Basic Wash", unit: "VEHICLE", quantity: 1, priceStatus: "PRICED", unitPriceCentavos: 18000, subtotalCentavos: 18000, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null }],
  totalPriceCentavos: 18000, estimatedTotalCentavos: 18000, currency: "PHP", issuedAt: "2026-10-20T00:00:00.000Z", expiresAt: "2026-10-20T00:15:00.000Z", quoteToken: "signed",
} as BookingQuote;
const form = { customerName: " Juan dela Cruz ", customerPhone: "0917 123 4567", customerEmail: "", vehicleModel: "Toyota Vios", vehiclePlate: "abc 1234", specialRequests: "" };

test("the v4 create body uses the quote's own lines, a v4 UUID key and the normalized phone", () => {
  const r = createDayRequest({ form, quote: fullQuote, bookingDate: "2026-10-21", turnstileToken: "token", idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.data.lines, [{ serviceId: wash.id, quantity: 1 }]);
  assert.equal(r.data.contractVersion, 4);
  assert.equal(r.data.customerPhone, "+639171234567");
  assert.equal(r.data.customerName, "Juan dela Cruz");
  assert.equal(r.data.vehiclePlate, "ABC 1234");
  assert.equal(r.data.customerEmail, undefined);
  assert.equal(r.data.specialRequests, undefined);
});

test("the car make/model is required; the plate is optional", () => {
  const missing = createDayRequest({ form: { ...form, vehicleModel: " " }, quote: fullQuote, bookingDate: "2026-10-21", turnstileToken: "token", idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(missing.fieldErrors.vehicleModel, ["Enter your car's make and model (for example Toyota Vios)."]);
  const noPlate = createDayRequest({ form: { ...form, vehiclePlate: "" }, quote: fullQuote, bookingDate: "2026-10-21", turnstileToken: "token", idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  assert.equal(noPlate.ok, true);
  if (noPlate.ok) assert.equal(noPlate.data.vehiclePlate, undefined);
  const noChallenge = createDayRequest({ form, quote: fullQuote, bookingDate: "2026-10-21", turnstileToken: "", idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  assert.equal(noChallenge.ok, false);
  if (!noChallenge.ok) assert.ok(noChallenge.fieldErrors.turnstileToken?.length);
});

const err = (code: string, o: Partial<LifecycleError> = {}) => ({ code, message: "Server message for " + code, fieldErrors: {}, retryable: false, commitState: "NOT_COMMITTED", currentQuote: null, currentBooking: null, retryAfterSeconds: null, ...o }) as LifecycleError;

test("create errors route the customer to the right step and never echo unknown field text", () => {
  assert.deepEqual(publicCreateError(err("FULLY_BOOKED")), { message: "Server message for FULLY_BOOKED", fieldErrors: {}, step: "DAY", refreshDays: true, refreshQuote: false, newChallenge: true, uncertain: false });
  assert.equal(publicCreateError(err("DAY_CLOSED")).step, "DAY");
  assert.equal(publicCreateError(err("QUOTE_EXPIRED")).refreshQuote, true);
  assert.equal(publicCreateError(err("CATALOG_UPDATED")).step, "SERVICES");
  assert.equal(publicCreateError(err("SERVICE_NOT_OFFERED")).step, "SERVICES");
  const challenge = publicCreateError(err("CHALLENGE_FAILED", { fieldErrors: { turnstileToken: ["Complete the security check again."] } }));
  assert.deepEqual([challenge.step, challenge.newChallenge, challenge.fieldErrors], ["DETAILS", true, { turnstileToken: ["Complete the security check again."] }]);
  // P1-19 W4: the customer's own fields read in the shop's plain words, whatever the server said.
  const validation = publicCreateError(err("VALIDATION_ERROR", { fieldErrors: { customerPhone: ["Use a Philippine mobile number"], customerName: ["Too small: expected string to have >=2 characters"], staffNote: ["PRIVATE CANARY"] } }));
  assert.deepEqual(validation.fieldErrors, { customerPhone: ["Enter a Philippine mobile number, like 0917 000 0000."], customerName: ["Enter your name (at least 2 letters)."] });
  assert.equal(publicCreateError(err("RATE_LIMITED", { retryable: true, retryAfterSeconds: 3600 })).uncertain, false);
});

// P1-03's bookingError() defaults commitState to UNKNOWN, so refusals that happen before any commit
// (challenge, budgets, pause, validation) arrive as UNKNOWN. Only RETRYABLE_ERROR means "we could not
// confirm the outcome". Regression: a refused challenge was treated as uncertain and retried forever.
test("only an unconfirmed outcome keeps the attempt; every server answer needs a fresh challenge", () => {
  for (const code of ["CHALLENGE_FAILED", "RATE_LIMITED", "ONLINE_BOOKING_UNAVAILABLE", "VALIDATION_ERROR", "IDEMPOTENCY_CONFLICT", "FORBIDDEN"]) {
    const shown = publicCreateError(err(code, { commitState: "UNKNOWN", retryable: true }));
    assert.deepEqual([shown.uncertain, shown.newChallenge], [false, true], code);
  }
  const unconfirmed = publicCreateError(err("RETRYABLE_ERROR", { commitState: "UNKNOWN", retryable: true, retryAfterSeconds: 10 }));
  assert.deepEqual([unconfirmed.uncertain, unconfirmed.newChallenge, unconfirmed.step], [true, true, "DETAILS"]);
});

test("P1-19 W3/W11: wizard categories use the home page's group names, in its order", async () => {
  const { CATEGORY_ORDER, CATEGORY_NAMES } = await import("./day-booking");
  const { SERVICE_MENU } = await import("@/components/home/service-menu");
  assert.deepEqual(CATEGORY_ORDER.map((c) => CATEGORY_NAMES[c]), SERVICE_MENU.map((g) => g.name));
});

test("P1-19 W8 (LE 2026-10-28): the arrival line comes from the shop's own hours", async () => {
  const { arrivalWords, serviceDetail } = await import("./day-booking");
  assert.equal(arrivalWords(), "Bring your car any time during opening hours, 8\u00a0AM–6\u00a0PM, on your chosen day.");
  assert.equal(serviceDetail(coating), null);
  assert.equal(serviceDetail({ ...coating, productName: "IGC Eclipse Graphene", hardness: "9H", warrantyMonths: 36 }), "IGC Eclipse Graphene · 9H · 3-year warranty");
});

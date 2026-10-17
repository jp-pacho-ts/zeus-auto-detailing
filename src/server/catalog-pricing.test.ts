// ADR-004 pricing and the fixed/quote-first split (T-043 T-046 cases 1, 2 and 8), against the
// reviewed manifest. No database: the DB suite proves the loaded release equals this fixture.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CatalogSelectionSchema, type CatalogSelection } from "@/types/catalog-contracts";
import { catalogFingerprint, priceSelection, type PricingResult, type ReleaseSnapshot } from "./catalog-pricing";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "./catalog.fixture";

const release = releaseFromManifest();
const select = (slug: string, size: string, extra: Partial<CatalogSelection> = {}): CatalogSelection =>
  ({ serviceId: bySlug(release, slug).id, vehicleCategoryId: sizeId(release, size), quantity: 1, addOnServiceIds: [], ...extra });
const addOns = (...slugs: string[]) => slugs.map((s) => bySlug(release, s).id).sort();
const rejected = (r: PricingResult, code: string) => { assert.equal(r.kind, "REJECTED", JSON.stringify(r)); assert.equal(r.kind === "REJECTED" && r.error.code, code, JSON.stringify(r)); };
function clone(mutate: (r: ReleaseSnapshot) => void): ReleaseSnapshot {
  const copy = structuredClone(release);
  mutate(copy);
  return copy;
}

test("worked examples from the contract", () => {
  // Basic Wash / MOTOR: one VEHICLE base line, 10000 centavos, 30 minutes.
  const basic = priceSelection(release, select("basic-wash", "MOTOR"));
  assert.equal(basic.kind, "BOOKABLE");
  if (basic.kind !== "BOOKABLE") return;
  assert.equal(basic.quote.lines.length, 1);
  assert.deepEqual({ ...basic.quote.lines[0], offerId: "x" }, { kind: "BASE", serviceId: bySlug(release, "basic-wash").id, offerId: "x", name: "Basic Wash",
    unit: "VEHICLE", quantity: 1, unitPriceCentavos: 10000, subtotalCentavos: 10000, addedMinutes: 30 });
  assert.equal(basic.quote.totalPriceCentavos, 10000);
  assert.equal(basic.quote.durationMinutes, 30);
  assert.equal(basic.quote.version, 2);
  assert.equal(basic.quote.pricingAlgorithm, "php-service-size-v2");
  assert.equal(basic.quote.currency, "PHP");
  // Basic Wash / S + Bac to Zero: known sum 68000 but quote-first (added duration unknown).
  const composite = priceSelection(release, select("basic-wash", "S", { addOnServiceIds: addOns("bac-to-zero") }));
  assert.equal(composite.kind, "QUOTE_REQUIRED");
  if (composite.kind !== "QUOTE_REQUIRED") return;
  assert.equal(composite.estimate.totalPriceCentavos, 68000);
  assert.deepEqual(composite.estimate.duration, { kind: "UNKNOWN" });
  assert.ok(composite.reasons.includes("ADD_ON_DURATION_UNKNOWN"));
  // Panel repaint x2: reference 350000 per panel, total null until fitment is confirmed.
  const panel = priceSelection(release, select("panel-repaint", "M", { quantity: 2 }));
  assert.equal(panel.kind, "QUOTE_REQUIRED");
  if (panel.kind !== "QUOTE_REQUIRED") return;
  assert.deepEqual(panel.estimate.lines, [{ serviceId: bySlug(release, "panel-repaint").id, name: "Panel repaint", unit: "PANEL", quantity: 2,
    unitPriceCentavos: 350000, subtotalCentavos: 700000 }]);
  assert.equal(panel.estimate.totalPriceCentavos, null);
  assert.ok(panel.reasons.includes("ELIGIBILITY_UNCONFIRMED"));
  // Premium Wash / MOTOR is not offered: never a zero price.
  rejected(priceSelection(release, select("premium-wash", "MOTOR")), "SERVICE_NOT_OFFERED");
  // Headlight / M: unconfirmed, no price, quote-first.
  const headlight = priceSelection(release, select("headlight-restoration", "M"));
  assert.equal(headlight.kind, "QUOTE_REQUIRED");
  if (headlight.kind !== "QUOTE_REQUIRED") return;
  assert.equal(headlight.estimate.totalPriceCentavos, null);
  assert.equal(headlight.estimate.lines[0].unitPriceCentavos, null);
  assert.ok(headlight.reasons.includes("PRICE_UNCONFIRMED") && headlight.reasons.includes("ELIGIBILITY_UNCONFIRMED"));
});

test("every one of the 105 pairs prices exactly as the reviewed manifest says", () => {
  const manifest = readManifest();
  let bookable = 0;
  for (const service of manifest.services) {
    for (const offer of service.offers) {
      const result = priceSelection(release, { serviceId: service.id, vehicleCategoryId: offer.vehicleCategoryId, quantity: 1, addOnServiceIds: [] });
      const label = `${service.slug}/${offer.sizeCode}`;
      if (service.type === "ADD_ON") { rejected(result, "VALIDATION_ERROR"); continue; } // never sold alone
      if (offer.state === "NOT_OFFERED") { rejected(result, "SERVICE_NOT_OFFERED"); continue; }
      if (offer.bookingMode === "FIXED_ONLINE") {
        assert.equal(result.kind, "BOOKABLE", label);
        if (result.kind !== "BOOKABLE") continue;
        bookable++;
        assert.equal(result.quote.totalPriceCentavos, offer.unitPriceCentavos, label);
        assert.equal(result.quote.durationMinutes, offer.durationMinutes, label);
        assert.equal(result.quote.lines[0].offerId, offer.id, label);
        continue;
      }
      assert.equal(result.kind, "QUOTE_REQUIRED", label);
      if (result.kind !== "QUOTE_REQUIRED") continue;
      assert.ok(result.reasons.length >= 1, label);
      const line = result.estimate.lines[0];
      const expectedUnit = offer.unitPriceCentavos ?? (offer.state === "UNCONFIRMED" ? service.referenceUnitPriceCentavos : null);
      assert.equal(line.unitPriceCentavos, expectedUnit, label);
      assert.equal(result.estimate.totalPriceCentavos, offer.state === "OFFERED" ? offer.unitPriceCentavos : null, label);
      assert.deepEqual(result.estimate.duration, { kind: "UNKNOWN" }, label);
    }
  }
  // Only the three plain washes on their offered sizes sign quotes: 5 + 5 + 4.
  assert.equal(bookable, 14);
});

test("quantity, unit and selection shape are enforced; client price fields never parse", () => {
  rejected(priceSelection(release, select("basic-wash", "S", { quantity: 2 })), "VALIDATION_ERROR"); // VEHICLE is one
  rejected(priceSelection(release, select("full-detailing", "L", { quantity: 3 })), "VALIDATION_ERROR");
  const panel20 = priceSelection(release, select("panel-repaint", "S", { quantity: 20 }));
  assert.equal(panel20.kind === "QUOTE_REQUIRED" && panel20.estimate.lines[0].subtotalCentavos, 7_000_000);
  const base = select("panel-repaint", "S");
  for (const bad of [0, 21, 1.5, -1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 2, "2", "1", null]) {
    assert.equal(CatalogSelectionSchema.safeParse({ ...base, quantity: bad }).success, false, String(bad));
  }
  for (const extra of [{ price: 1 }, { totalPriceCentavos: 1 }, { unitPriceCentavos: 1 }, { discount: 1 }, { lines: [] }, { durationMinutes: 30 }, { unit: "PANEL" }]) {
    assert.equal(CatalogSelectionSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra));
  }
  for (const missing of ["serviceId", "vehicleCategoryId", "quantity", "addOnServiceIds"] as const) {
    const copy: Record<string, unknown> = { ...base };
    delete copy[missing];
    assert.equal(CatalogSelectionSchema.safeParse(copy).success, false, missing);
  }
});

test("add-ons: duplicate, unsorted, too many, alone, self, base-as-add-on, incompatible, wrong size and unknown all reject", () => {
  const ids = addOns("glass-acid-rain-removal", "bac-to-zero");
  assert.equal(CatalogSelectionSchema.safeParse(select("basic-wash", "S", { addOnServiceIds: [ids[0], ids[0]] })).success, false);
  assert.equal(CatalogSelectionSchema.safeParse(select("basic-wash", "S", { addOnServiceIds: [ids[1], ids[0]] })).success, false);
  assert.equal(CatalogSelectionSchema.safeParse(select("basic-wash", "S", { addOnServiceIds: [...ids, bySlug(release, "interior-detailing").id].sort() })).success, false);
  // Both compatible add-ons together are a valid (quote-first) composition.
  const both = priceSelection(release, select("signature-wash", "L", { addOnServiceIds: ids }));
  assert.equal(both.kind === "QUOTE_REQUIRED" && both.estimate.totalPriceCentavos, 50000 + 75000 + 60000);
  assert.deepEqual(both.kind === "QUOTE_REQUIRED" && both.estimate.lines.map((l) => l.serviceId), [bySlug(release, "signature-wash").id, ...ids]);
  // Add-on sold alone.
  rejected(priceSelection(release, select("bac-to-zero", "S")), "VALIDATION_ERROR");
  // An add-on that is the base, or a BASE service used as an add-on.
  const basic = bySlug(release, "basic-wash").id;
  rejected(priceSelection(release, select("basic-wash", "S", { addOnServiceIds: [basic] })), "VALIDATION_ERROR");
  rejected(priceSelection(release, select("basic-wash", "S", { addOnServiceIds: addOns("signature-wash") })), "VALIDATION_ERROR");
  // Incompatible base: detailing takes no wash add-on.
  rejected(priceSelection(release, select("interior-detailing", "S", { addOnServiceIds: addOns("bac-to-zero") })), "VALIDATION_ERROR");
  // Wrong size: the add-on is not offered on MOTOR and compatibility excludes MOTOR.
  rejected(priceSelection(release, select("basic-wash", "MOTOR", { addOnServiceIds: addOns("bac-to-zero") })), "SERVICE_NOT_OFFERED");
  const motorCompatible = clone((r) => { for (const c of r.compatibility) c.sizeCodes = ["S", "M", "L", "XL"]; for (const o of bySlug(r, "bac-to-zero").offers) if (o.sizeCode === "MOTOR") Object.assign(o, { state: "OFFERED", unitPriceCentavos: 1000 }); });
  rejected(priceSelection(motorCompatible, select("basic-wash", "MOTOR", { addOnServiceIds: addOns("bac-to-zero") })), "VALIDATION_ERROR");
  // Unknown IDs, and IDs of the wrong kind (a size used as a service, and the reverse).
  const unknown = "11111111-1111-4111-8111-111111111111";
  rejected(priceSelection(release, { ...select("basic-wash", "S"), serviceId: unknown }), "NOT_FOUND");
  rejected(priceSelection(release, { ...select("basic-wash", "S"), vehicleCategoryId: unknown }), "NOT_FOUND");
  rejected(priceSelection(release, { ...select("basic-wash", "S"), vehicleCategoryId: basic }), "NOT_FOUND");
  rejected(priceSelection(release, { ...select("basic-wash", "S"), serviceId: sizeId(release, "S") }), "NOT_FOUND");
  rejected(priceSelection(release, select("basic-wash", "S", { addOnServiceIds: [unknown] })), "NOT_FOUND");
});

test("a row flag cannot enable fixed add-ons, panels, unknown or multi-day bookings", () => {
  // Add-on rows marked FIXED with known minutes: the composition stays quote-first.
  const fixedAddOn = clone((r) => { for (const o of bySlug(r, "bac-to-zero").offers) if (o.state === "OFFERED") Object.assign(o, { bookingMode: "FIXED_ONLINE", durationKind: "TIMED", durationMinutes: 15 }); });
  const composite = priceSelection(fixedAddOn, select("basic-wash", "S", { addOnServiceIds: addOns("bac-to-zero") }));
  assert.equal(composite.kind, "QUOTE_REQUIRED");
  assert.deepEqual(composite.kind === "QUOTE_REQUIRED" && composite.estimate.duration, { kind: "TIMED", minutes: 45 });
  // A FIXED row on a PANEL service, on an UNKNOWN or MULTI_DAY plan, or not OFFERED, never signs.
  const forced = (mutate: (o: ReleaseSnapshot["services"][number]["offers"][number], s: ReleaseSnapshot["services"][number]) => void, slug = "panel-repaint") =>
    clone((r) => { const s = bySlug(r, slug); for (const o of s.offers) if (o.sizeCode === "M") mutate(o, s); });
  const panel = forced((o) => Object.assign(o, { state: "OFFERED", bookingMode: "FIXED_ONLINE", unitPriceCentavos: 350000, durationKind: "TIMED", durationMinutes: 60 }));
  assert.equal(priceSelection(panel, select("panel-repaint", "M")).kind, "QUOTE_REQUIRED");
  const unknown = forced((o) => Object.assign(o, { bookingMode: "FIXED_ONLINE", durationKind: "UNKNOWN", durationMinutes: null }), "full-detailing");
  const unknownResult = priceSelection(unknown, select("full-detailing", "M"));
  assert.ok(unknownResult.kind === "QUOTE_REQUIRED" && unknownResult.reasons.includes("DURATION_UNKNOWN"));
  const multi = forced((o) => Object.assign(o, { bookingMode: "FIXED_ONLINE", durationKind: "MULTI_DAY", durationMinutes: null, elapsedDays: 3 }), "full-detailing");
  const multiResult = priceSelection(multi, select("full-detailing", "M"));
  assert.ok(multiResult.kind === "QUOTE_REQUIRED" && multiResult.reasons.includes("MULTI_DAY"));
  assert.deepEqual(multiResult.kind === "QUOTE_REQUIRED" && multiResult.estimate.duration, { kind: "MULTI_DAY", elapsedDays: 3 });
  const unconfirmed = forced((o) => Object.assign(o, { state: "UNCONFIRMED", bookingMode: "FIXED_ONLINE", unitPriceCentavos: 20000, durationKind: "TIMED", durationMinutes: 30 }), "basic-wash");
  assert.equal(priceSelection(unconfirmed, select("basic-wash", "M")).kind, "QUOTE_REQUIRED");
  // A TIMED panel never multiplies its minutes by the panel count.
  const timedPanel = forced((o) => Object.assign(o, { state: "OFFERED", unitPriceCentavos: 350000, durationKind: "TIMED", durationMinutes: 60 }));
  const timed = priceSelection(timedPanel, select("panel-repaint", "M", { quantity: 3 }));
  assert.deepEqual(timed.kind === "QUOTE_REQUIRED" && timed.estimate.duration, { kind: "UNKNOWN" });
  assert.equal(timed.kind === "QUOTE_REQUIRED" && timed.estimate.totalPriceCentavos, 1_050_000);
});

test("totals stay safe integers within 100,000,000 centavos", () => {
  const huge = clone((r) => {
    for (const o of bySlug(r, "basic-wash").offers) if (o.sizeCode === "S") o.unitPriceCentavos = 100_000_000;
    for (const o of bySlug(r, "bac-to-zero").offers) if (o.sizeCode === "S") o.unitPriceCentavos = 1;
  });
  rejected(priceSelection(huge, select("basic-wash", "S", { addOnServiceIds: addOns("bac-to-zero") })), "VALIDATION_ERROR");
  const max = priceSelection(huge, select("basic-wash", "S"));
  assert.equal(max.kind === "BOOKABLE" && max.quote.totalPriceCentavos, 100_000_000);
});

test("the fingerprint is the specified SHA-256 and binds release, manifest, selection and every line field", () => {
  const result = priceSelection(release, select("signature-wash", "XL"));
  assert.equal(result.kind, "BOOKABLE");
  if (result.kind !== "BOOKABLE") return;
  const q = result.quote;
  const selection = [q.serviceId, q.vehicleCategoryId, q.quantity, q.addOnServiceIds];
  const lines = q.lines.map((l) => [l.kind, l.serviceId, l.offerId, l.name, l.unit, l.quantity, l.unitPriceCentavos, l.subtotalCentavos, l.addedMinutes]);
  const expected = createHash("sha256").update(JSON.stringify(["php-service-size-v2", release.releaseId, release.manifestSha256, selection, lines,
    q.totalPriceCentavos, q.durationMinutes, "PHP"]), "utf8").digest("hex");
  assert.equal(q.catalogFingerprint, expected);
  const line = q.lines[0];
  const variants = [
    catalogFingerprint({ ...release, releaseId: "2e5d1c7e-3b0a-4c8e-9d61-0a8f1b2c3d4e" }, q, q.lines, q.totalPriceCentavos, q.durationMinutes),
    catalogFingerprint({ ...release, manifestSha256: "0".repeat(64) }, q, q.lines, q.totalPriceCentavos, q.durationMinutes),
    catalogFingerprint(release, { ...q, quantity: 2 }, q.lines, q.totalPriceCentavos, q.durationMinutes),
    ...(["offerId", "name", "unitPriceCentavos", "subtotalCentavos", "addedMinutes"] as const).map((field) =>
      catalogFingerprint(release, q, [{ ...line, [field]: typeof line[field] === "number" ? (line[field] as number) + 1 : line[field] + "x" }], q.totalPriceCentavos, q.durationMinutes)),
    catalogFingerprint(release, q, q.lines, q.totalPriceCentavos + 1, q.durationMinutes),
    catalogFingerprint(release, q, q.lines, q.totalPriceCentavos, q.durationMinutes + 1),
  ];
  assert.equal(new Set([q.catalogFingerprint, ...variants]).size, variants.length + 1);
});

test("estimates never charge comparison prices and QUOTE_REQUIRED always carries a reason", () => {
  for (const service of release.services) {
    if (service.type === "ADD_ON") continue;
    for (const size of release.sizes) {
      for (const quantity of service.unit === "PANEL" ? [1, 7] : [1]) {
        const r = priceSelection(release, { serviceId: service.id, vehicleCategoryId: size.id, quantity, addOnServiceIds: [] });
        if (r.kind === "QUOTE_REQUIRED") assert.ok(r.reasons.length >= 1 && new Set(r.reasons).size === r.reasons.length, `${service.slug}/${size.code}`);
      }
    }
  }
  // The internal model has no compare-at field: pricing cannot read one.
  assert.equal(JSON.stringify(release).includes("compareAt"), false);
});

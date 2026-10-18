// ADR-005 multi-line pricing over the ADR-004 release (T-043 T-046 cases 1, 2 and 8 re-expressed
// for line items), against the reviewed manifest. No database: the DB suite proves the loaded
// release equals this fixture.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BookingQuoteSchema, CatalogSelectionSchema, selectionOfQuote, type CatalogSelection } from "@/types/catalog-contracts";
import { catalogFingerprint, offerBooking, priceSelection, type PricingResult, type ReleaseSnapshot } from "./catalog-pricing";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "./catalog.fixture";

const release = releaseFromManifest();
const select = (size: string, ...lines: (string | [string, number])[]): CatalogSelection => ({
  vehicleCategoryId: sizeId(release, size),
  lines: lines.map((l) => (typeof l === "string" ? { serviceId: bySlug(release, l).id, quantity: 1 } : { serviceId: bySlug(release, l[0]).id, quantity: l[1] })),
});
const quoted = (r: PricingResult) => { assert.equal(r.kind, "QUOTED", JSON.stringify(r)); return r.kind === "QUOTED" ? r.quote : (null as never); };
const rejected = (r: PricingResult, code: string, field?: string) => {
  assert.equal(r.kind, "REJECTED", JSON.stringify(r));
  if (r.kind !== "REJECTED") return;
  assert.equal(r.error.code, code, JSON.stringify(r));
  if (field) assert.ok(field in r.error.fieldErrors, JSON.stringify(r.error.fieldErrors));
};
const amounts = (r: PricingResult) => quoted(r).lines.map((l) => [l.priceStatus, l.unitPriceCentavos, l.subtotalCentavos, l.referenceUnitPriceCentavos, l.referenceSubtotalCentavos]);
function clone(mutate: (r: ReleaseSnapshot) => void): ReleaseSnapshot {
  const copy = structuredClone(release);
  mutate(copy);
  return copy;
}

test("worked examples: priced washes, for-quote lines with reference estimates, server totals", () => {
  // Basic Wash / MOTOR: one priced line.
  const basic = quoted(priceSelection(release, select("MOTOR", "basic-wash")));
  assert.deepEqual({ ...basic.lines[0], offerId: "x" }, { serviceId: bySlug(release, "basic-wash").id, offerId: "x", kind: "BASE", name: "Basic Wash", unit: "VEHICLE",
    quantity: 1, priceStatus: "PRICED", unitPriceCentavos: 10000, subtotalCentavos: 10000, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null });
  assert.deepEqual([basic.totalPriceCentavos, basic.estimatedTotalCentavos, basic.version, basic.pricingAlgorithm, basic.currency], [10000, 10000, 3, "php-service-size-v3", "PHP"]);
  // Basic Wash / S + Bac to Zero: the add-on is bookable for quote, with its source price as the estimate.
  const composite = priceSelection(release, select("S", "basic-wash", "bac-to-zero"));
  assert.deepEqual(amounts(composite), [["PRICED", 18000, 18000, null, null], ["FOR_QUOTE", null, null, 50000, 50000]]);
  assert.deepEqual([quoted(composite).totalPriceCentavos, quoted(composite).estimatedTotalCentavos], [18000, 68000]);
  // A detailing visit with a wash: several base services in one booking, in the customer's order.
  const visit = quoted(priceSelection(release, select("S", "interior-detailing", "basic-wash")));
  assert.deepEqual(visit.lines.map((l) => [l.name, l.priceStatus]), [["Interior Detailing", "FOR_QUOTE"], ["Basic Wash", "PRICED"]]);
  assert.deepEqual([visit.totalPriceCentavos, visit.estimatedTotalCentavos], [18000, 368000]);
  // Panel repaint x2: for quote with the per-panel reference as the estimate (LE 2026-10-18).
  const panel = priceSelection(release, select("M", ["panel-repaint", 2]));
  assert.deepEqual(amounts(panel), [["FOR_QUOTE", null, null, 350000, 700000]]);
  assert.deepEqual([quoted(panel).totalPriceCentavos, quoted(panel).estimatedTotalCentavos], [0, 700000]);
  // Coatings stay for quote: the source price is a reference, never a charged amount (LE 2026-10-18).
  assert.deepEqual(amounts(priceSelection(release, select("S", "eclipse-graphene"))), [["FOR_QUOTE", null, null, 1170000, 1170000]]);
  assert.deepEqual(amounts(priceSelection(release, select("S", "headlight-restoration"))), [["FOR_QUOTE", null, null, 160000, 160000]]);
  // Not offered, and unconfirmed (other than panel repaint), cannot be booked.
  rejected(priceSelection(release, select("MOTOR", "premium-wash")), "SERVICE_NOT_OFFERED", "lines.0.serviceId");
  rejected(priceSelection(release, select("M", "headlight-restoration")), "SERVICE_NOT_OFFERED", "lines.0.serviceId");
  rejected(priceSelection(release, select("S", "motorcycle-graphene")), "SERVICE_NOT_OFFERED");
  // Quotes carry no duration or time.
  const keys = JSON.stringify(basic);
  for (const word of ["duration", "Minutes", "startTime", "slot", "bookingDate"]) assert.equal(keys.includes(word), false, word);
});

test("every one of the 105 cells books exactly as the reviewed manifest and the LE decisions say", () => {
  const manifest = readManifest();
  const counts = { PRICED: 0, FOR_QUOTE: 0, UNAVAILABLE: 0, ADD_ON_ALONE: 0 };
  for (const service of manifest.services) {
    for (const offer of service.offers) {
      const label = `${service.slug}/${offer.sizeCode}`;
      const result = priceSelection(release, { vehicleCategoryId: offer.vehicleCategoryId, lines: [{ serviceId: service.id, quantity: 1 }] });
      const panelReference = service.unit === "PANEL" && offer.state === "UNCONFIRMED" && service.referenceUnitPriceCentavos !== null;
      const expected = offer.state === "OFFERED" ? (offer.bookingMode === "FIXED_ONLINE" ? "PRICED" : "FOR_QUOTE") : panelReference ? "FOR_QUOTE" : "UNAVAILABLE";
      const s = release.services.find((x) => x.id === service.id)!;
      assert.equal(offerBooking(s, s.offers.find((o) => o.id === offer.id)!), expected, label);
      if (service.type === "ADD_ON" && expected !== "UNAVAILABLE") { rejected(result, "VALIDATION_ERROR"); counts.ADD_ON_ALONE++; continue; }
      counts[expected]++;
      if (expected === "UNAVAILABLE") { rejected(result, "SERVICE_NOT_OFFERED"); continue; }
      const line = quoted(result).lines[0];
      assert.equal(line.offerId, offer.id, label);
      if (expected === "PRICED") assert.deepEqual([line.unitPriceCentavos, line.referenceUnitPriceCentavos], [offer.unitPriceCentavos, null], label);
      else assert.deepEqual([line.unitPriceCentavos, line.referenceUnitPriceCentavos], [null, offer.unitPriceCentavos ?? service.referenceUnitPriceCentavos], label);
    }
  }
  // 14 priced wash cells; for-quote cells everywhere else that is offered, plus panel repaint on five sizes.
  assert.deepEqual(counts, { PRICED: 14, FOR_QUOTE: 59, UNAVAILABLE: 24, ADD_ON_ALONE: 8 });
});

test("selection shape: distinct services, at most ten lines, numeric quantities, no client price fields", () => {
  const base = select("S", "basic-wash");
  assert.equal(CatalogSelectionSchema.safeParse({ ...base, lines: [...base.lines, ...base.lines] }).success, false);
  assert.equal(CatalogSelectionSchema.safeParse({ ...base, lines: [] }).success, false);
  const eleven = release.services.slice(0, 11).map((s) => ({ serviceId: s.id, quantity: 1 }));
  assert.equal(CatalogSelectionSchema.safeParse({ ...base, lines: eleven }).success, false);
  for (const bad of [0, 21, 1.5, -1, Number.NaN, Infinity, "1", null]) {
    assert.equal(CatalogSelectionSchema.safeParse({ ...base, lines: [{ ...base.lines[0], quantity: bad }] }).success, false, String(bad));
  }
  for (const extra of [{ price: 1 }, { totalPriceCentavos: 1 }, { unitPriceCentavos: 1 }, { discount: 1 }, { durationMinutes: 30 }, { bookingDate: "2026-10-20" }]) {
    assert.equal(CatalogSelectionSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra));
    assert.equal(CatalogSelectionSchema.safeParse({ ...base, lines: [{ ...base.lines[0], ...extra }] }).success, false, JSON.stringify(extra));
  }
  // Quantity follows the unit: per vehicle is one, panels are 1..20.
  rejected(priceSelection(release, select("S", ["basic-wash", 2])), "VALIDATION_ERROR", "lines.0.quantity");
  rejected(priceSelection(release, select("S", "basic-wash", ["bac-to-zero", 2])), "VALIDATION_ERROR", "lines.1.quantity");
  assert.equal(quoted(priceSelection(release, select("S", ["panel-repaint", 20]))).estimatedTotalCentavos, 7_000_000);
});

test("add-ons: never alone, only with a compatible base on that size; unknown IDs are not found", () => {
  rejected(priceSelection(release, select("S", "bac-to-zero")), "VALIDATION_ERROR", "lines.0.serviceId");
  rejected(priceSelection(release, select("S", "bac-to-zero", "glass-acid-rain-removal")), "VALIDATION_ERROR");
  // Interior detailing takes no wash add-on; with a wash in the same visit, it does.
  rejected(priceSelection(release, select("S", "interior-detailing", "bac-to-zero")), "VALIDATION_ERROR", "lines.1.serviceId");
  const withWash = quoted(priceSelection(release, select("S", "interior-detailing", "bac-to-zero", "basic-wash")));
  assert.deepEqual(withWash.lines.map((l) => l.kind), ["BASE", "BASE", "ADD_ON"]);
  // Both add-ons on one wash (no fixed limit beyond distinct services).
  assert.equal(quoted(priceSelection(release, select("L", "signature-wash", "glass-acid-rain-removal", "bac-to-zero"))).estimatedTotalCentavos, 50000 + 75000 + 60000);
  // Wrong size: add-ons are not offered on MOTOR; a compatibility row that excludes the size also refuses.
  rejected(priceSelection(release, select("MOTOR", "basic-wash", "bac-to-zero")), "SERVICE_NOT_OFFERED", "lines.1.serviceId");
  const motor = clone((r) => { for (const o of bySlug(r, "bac-to-zero").offers) if (o.sizeCode === "MOTOR") Object.assign(o, { state: "OFFERED", unitPriceCentavos: 1000 }); });
  rejected(priceSelection(motor, select("MOTOR", "basic-wash", "bac-to-zero")), "VALIDATION_ERROR", "lines.1.serviceId");
  const unknown = "11111111-1111-4111-8111-111111111111";
  rejected(priceSelection(release, { ...select("S", "basic-wash"), vehicleCategoryId: unknown }), "NOT_FOUND", "vehicleCategoryId");
  rejected(priceSelection(release, { ...select("S", "basic-wash"), vehicleCategoryId: bySlug(release, "basic-wash").id }), "NOT_FOUND");
  rejected(priceSelection(release, { vehicleCategoryId: sizeId(release, "S"), lines: [{ serviceId: bySlug(release, "basic-wash").id, quantity: 1 }, { serviceId: unknown, quantity: 1 }] }), "NOT_FOUND", "lines.1.serviceId");
  rejected(priceSelection(release, { vehicleCategoryId: sizeId(release, "S"), lines: [{ serviceId: sizeId(release, "S"), quantity: 1 }] }), "NOT_FOUND");
});

test("pricing never depends on durations, and only fixed offered cells are charged", () => {
  // Durations are informational (ADR-005): changing every work plan changes no quote.
  const timed = clone((r) => { for (const s of r.services) for (const o of s.offers) Object.assign(o, { durationKind: "MULTI_DAY", durationMinutes: null, elapsedDays: 3 }); });
  for (const sel of [select("S", "basic-wash", "bac-to-zero"), select("XL", "ppf-8-0-mil"), select("M", ["panel-repaint", 4])]) {
    assert.deepEqual(priceSelection(timed, sel), priceSelection(release, sel));
  }
  // An unconfirmed cell with a sourced price is still not bookable, except the panel reference rule.
  const pricedUnconfirmed = clone((r) => { for (const o of bySlug(r, "headlight-restoration").offers) if (o.sizeCode === "M") o.unitPriceCentavos = 160000; });
  rejected(priceSelection(pricedUnconfirmed, select("M", "headlight-restoration")), "SERVICE_NOT_OFFERED");
  // A panel service without a reference has nothing to estimate and is not bookable.
  const noReference = clone((r) => { bySlug(r, "panel-repaint").referenceUnitPriceCentavos = null; });
  rejected(priceSelection(noReference, select("M", "panel-repaint")), "SERVICE_NOT_OFFERED");
  assert.equal(JSON.stringify(release).includes("compareAt"), false); // no comparison price can reach a charge
});

test("totals stay safe integers within 100,000,000 centavos", () => {
  const huge = clone((r) => {
    for (const o of bySlug(r, "basic-wash").offers) if (o.sizeCode === "S") o.unitPriceCentavos = 100_000_000;
    for (const o of bySlug(r, "signature-wash").offers) if (o.sizeCode === "S") o.unitPriceCentavos = 1;
  });
  assert.equal(quoted(priceSelection(huge, select("S", "basic-wash"))).totalPriceCentavos, 100_000_000);
  rejected(priceSelection(huge, select("S", "basic-wash", "signature-wash")), "VALIDATION_ERROR");
  // The estimate is bounded too.
  rejected(priceSelection(huge, select("S", "basic-wash", "bac-to-zero")), "VALIDATION_ERROR");
});

test("the fingerprint is the specified SHA-256 and binds release, manifest, size, primary, queue and every line field", () => {
  const q = quoted(priceSelection(release, select("XL", "signature-wash", "bac-to-zero")));
  const lineArrays = q.lines.map((l) => [l.serviceId, l.offerId, l.kind, l.name, l.unit, l.quantity, l.priceStatus, l.unitPriceCentavos,
    l.subtotalCentavos, l.referenceUnitPriceCentavos, l.referenceSubtotalCentavos]);
  const expected = createHash("sha256").update(JSON.stringify(["php-service-size-v3", release.releaseId, release.manifestSha256, q.vehicleCategoryId,
    q.primaryServiceId, q.queueId, lineArrays, q.totalPriceCentavos, q.estimatedTotalCentavos, "PHP"]), "utf8").digest("hex");
  assert.equal(q.catalogFingerprint, expected);
  const fp = (r: Pick<ReleaseSnapshot, "releaseId" | "manifestSha256">, over: Partial<typeof q> = {}) => catalogFingerprint(r, { ...q, ...over });
  const line = q.lines[1];
  const variants = [
    fp({ ...release, releaseId: "2e5d1c7e-3b0a-4c8e-9d61-0a8f1b2c3d4e" }), fp({ ...release, manifestSha256: "0".repeat(64) }),
    fp(release, { vehicleCategoryId: sizeId(release, "L") }), fp(release, { lines: [...q.lines].reverse() }),
    fp(release, { primaryServiceId: bySlug(release, "basic-wash").id }), fp(release, { queueId: "DETAILING_COATING" }),
    fp(release, { totalPriceCentavos: q.totalPriceCentavos + 1 }), fp(release, { estimatedTotalCentavos: null }),
    ...(["offerId", "name", "kind", "priceStatus", "referenceUnitPriceCentavos", "referenceSubtotalCentavos", "quantity"] as const).map((field) =>
      fp(release, { lines: [q.lines[0], { ...line, [field]: typeof line[field] === "number" ? (line[field] as number) + 1 : String(line[field]) + "x" }] })),
  ];
  assert.equal(new Set([q.catalogFingerprint, ...variants]).size, variants.length + 1);
});

test("A6: lines are canonical (primary first, other bases, then add-ons, each by service ID); the quote binds the primary and its queue", () => {
  const id = (slug: string) => bySlug(release, slug).id;
  // The customer picks an add-on first, then three bases: the first base is the primary.
  const q = quoted(priceSelection(release, select("S", "bac-to-zero", "interior-detailing", "glass-acid-rain-removal", "exterior-detailing", "basic-wash")));
  assert.deepEqual(q.lines.map((l) => l.serviceId), [id("interior-detailing"), ...[id("exterior-detailing"), id("basic-wash")].sort(),
    ...[id("bac-to-zero"), id("glass-acid-rain-removal")].sort()]);
  assert.deepEqual([q.primaryServiceId, q.queueId], [id("interior-detailing"), "DETAILING_COATING"]);
  assert.ok(BookingQuoteSchema.safeParse({ ...q, issuedAt: "2026-10-18T02:00:00.000Z", expiresAt: "2026-10-18T02:15:00.000Z", quoteToken: "x" }).success);
  // Reordering anything after the first base changes nothing.
  assert.deepEqual(quoted(priceSelection(release, select("S", "interior-detailing", "glass-acid-rain-removal", "basic-wash", "bac-to-zero", "exterior-detailing"))), q);
  // The same services with another first base: another primary, queue and fingerprint.
  const wash = quoted(priceSelection(release, select("S", "basic-wash", "interior-detailing", "bac-to-zero", "exterior-detailing", "glass-acid-rain-removal")));
  assert.deepEqual([wash.primaryServiceId, wash.queueId, wash.lines[0].serviceId], [id("basic-wash"), "WASH", id("basic-wash")]);
  assert.notEqual(wash.catalogFingerprint, q.catalogFingerprint);
  assert.deepEqual([...wash.lines].map((l) => l.serviceId).sort(), [...q.lines].map((l) => l.serviceId).sort());
  // Pricing a quote's own lines again is a fixed point: create recomputes it this way.
  assert.deepEqual(quoted(priceSelection(release, selectionOfQuote(q))), q);
  assert.deepEqual(quoted(priceSelection(release, selectionOfQuote(wash))), wash);
  // Each queue is reachable through its own primary service.
  assert.deepEqual(["basic-wash", "full-detailing", "eclipse-graphene", "regular-tint", "ppf-7-5-mil", ["panel-repaint", 3], "washover-repaint"].map((l) =>
    quoted(priceSelection(release, select("M", l as string))).queueId), ["WASH", "DETAILING_COATING", "DETAILING_COATING", "TINT_PPF", "TINT_PPF", "REPAINT", "REPAINT"]);
  // A quote whose primary is not its first line, or whose lines are out of canonical order, fails the contract shape.
  const signed = { ...q, issuedAt: "2026-10-18T02:00:00.000Z", expiresAt: "2026-10-18T02:15:00.000Z", quoteToken: "x" };
  for (const bad of [{ ...signed, primaryServiceId: q.lines[1].serviceId }, { ...signed, lines: [q.lines[0], q.lines[2], q.lines[1], q.lines[3], q.lines[4]] },
    { ...signed, lines: [q.lines[0], q.lines[1], q.lines[2], q.lines[4], q.lines[3]] }, { ...signed, lines: [q.lines[3], ...q.lines.filter((_, i) => i !== 3)] },
    { ...signed, queueId: "wash" }, { ...signed, queueId: "" }]) {
    assert.equal(BookingQuoteSchema.safeParse(bad).success, false, JSON.stringify([bad.primaryServiceId, bad.queueId, bad.lines.map((l) => l.serviceId)]));
  }
});

test("A1: an offered quote-first cell without a source price is a for-quote line with no reference", () => {
  const noSource = clone((r) => { for (const o of bySlug(r, "interior-detailing").offers) if (o.sizeCode === "S") o.unitPriceCentavos = null; });
  const q = priceSelection(noSource, select("S", "interior-detailing", "basic-wash"));
  assert.deepEqual(amounts(q), [["FOR_QUOTE", null, null, null, null], ["PRICED", 18000, 18000, null, null]]);
  // The charged total is the priced lines; no estimate is shown while a for-quote line has no reference.
  assert.deepEqual([quoted(q).totalPriceCentavos, quoted(q).estimatedTotalCentavos], [18000, null]);
  // A fixed online cell is never booked without a price (the P1-01 offer check forbids it; fail closed).
  const fixedNoPrice = clone((r) => { for (const o of bySlug(r, "basic-wash").offers) if (o.sizeCode === "S") o.unitPriceCentavos = null; });
  rejected(priceSelection(fixedNoPrice, select("S", "basic-wash")), "SERVICE_NOT_OFFERED", "lines.0.serviceId");
});

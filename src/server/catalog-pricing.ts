import "server-only";
import { createHash } from "node:crypto";
import type {
  BookingQuote, CatalogSelection, CatalogServiceKind, PriceEstimate, PriceUnit, PublicDuration,
  QuoteRequiredReason, QuotedLine, VehicleCategoryCode,
} from "@/types/catalog-contracts";

// Server-authoritative ADR-004 pricing over one immutable published release. Pure: the read
// seam (catalog-read.ts) loads the release; nothing here touches the database or a client price.

export interface ReleaseSize { id: string; code: VehicleCategoryCode; name: string; description: string | null; sortOrder: number }
export interface ReleaseOffer {
  id: string; vehicleCategoryId: string; sizeCode: string;
  state: "OFFERED" | "NOT_OFFERED" | "UNCONFIRMED"; bookingMode: "FIXED_ONLINE" | "QUOTE_REQUIRED";
  unitPriceCentavos: number | null;
  durationKind: "UNKNOWN" | "TIMED" | "MULTI_DAY"; durationMinutes: number | null; elapsedDays: number | null;
} // no comparison price: it can never reach a charged amount
export interface ReleaseService {
  id: string; slug: string; name: string; description: string | null; group: CatalogServiceKind;
  type: "BASE" | "ADD_ON"; unit: PriceUnit; inclusions: string[]; productName: string | null; hardness: string | null;
  warrantyMonths: number | null; referenceUnitPriceCentavos: number | null; sortOrder: number; offers: ReleaseOffer[];
}
export interface ReleaseSnapshot {
  releaseId: string; version: string; manifestSha256: string;
  sizes: ReleaseSize[]; services: ReleaseService[];
  compatibility: { baseServiceId: string; addOnServiceId: string; sizeCodes: string[] }[];
}

export const PRICING_ALGORITHM = "php-service-size-v2" as const;
export const MAX_CENTAVOS = 100_000_000;
const MAX_MINUTES = 540;

export type UnsignedQuote = Omit<BookingQuote, "issuedAt" | "expiresAt" | "quoteToken">;
export interface PricingRejection {
  code: "NOT_FOUND" | "VALIDATION_ERROR" | "SERVICE_NOT_OFFERED";
  message: string;
  fieldErrors: Record<string, string[]>;
}
export type PricingResult =
  | { kind: "BOOKABLE"; quote: UnsignedQuote }
  | { kind: "QUOTE_REQUIRED"; estimate: PriceEstimate; reasons: QuoteRequiredReason[] }
  | { kind: "REJECTED"; error: PricingRejection };

export class CatalogIntegrityError extends Error {}

const reject = (code: PricingRejection["code"], field: string, message: string): PricingResult =>
  ({ kind: "REJECTED", error: { code, message, fieldErrors: { [field]: [message] } } });

function offerFor(service: ReleaseService, size: ReleaseSize): ReleaseOffer {
  const offer = service.offers.find((o) => o.vehicleCategoryId === size.id);
  if (!offer) throw new CatalogIntegrityError("missing size offer"); // the release has five per service
  return offer;
}

interface PricedLine { service: ReleaseService; offer: ReleaseOffer; quantity: number }

// Exact (service, size) lookup, add-on rules and quantity bounds; then either a signable fixed
// quote (plain fixed wash only) or a quote-first estimate.
export function priceSelection(release: ReleaseSnapshot, selection: CatalogSelection): PricingResult {
  const size = release.sizes.find((s) => s.id === selection.vehicleCategoryId);
  if (!size) return reject("NOT_FOUND", "vehicleCategoryId", "Choose one of the listed vehicle sizes.");
  const base = release.services.find((s) => s.id === selection.serviceId);
  if (!base) return reject("NOT_FOUND", "serviceId", "Choose one of the listed services.");
  if (base.type !== "BASE") return reject("VALIDATION_ERROR", "serviceId", "Add-ons are added to a wash; choose a wash first.");
  const baseOffer = offerFor(base, size);
  if (baseOffer.state === "NOT_OFFERED") return reject("SERVICE_NOT_OFFERED", "serviceId", "This service isn't offered for that vehicle size.");
  if (!Number.isSafeInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 20
      || (base.unit === "VEHICLE" && selection.quantity !== 1)) {
    return reject("VALIDATION_ERROR", "quantity", base.unit === "VEHICLE" ? "This service is priced per vehicle." : "Choose 1 to 20 panels.");
  }

  const addOnLines: PricedLine[] = [];
  for (const id of selection.addOnServiceIds) {
    const addOn = release.services.find((s) => s.id === id);
    if (!addOn) return reject("NOT_FOUND", "addOnServiceIds", "Choose one of the listed add-ons.");
    if (addOn.type !== "ADD_ON" || addOn.id === base.id) return reject("VALIDATION_ERROR", "addOnServiceIds", "Only listed add-ons can be added to a service.");
    const offer = offerFor(addOn, size);
    if (offer.state === "NOT_OFFERED") return reject("SERVICE_NOT_OFFERED", "addOnServiceIds", "This add-on isn't offered for that vehicle size.");
    const compatible = release.compatibility.some((c) => c.baseServiceId === base.id && c.addOnServiceId === addOn.id && c.sizeCodes.includes(size.code));
    if (!compatible) return reject("VALIDATION_ERROR", "addOnServiceIds", "This add-on can't be added to that service.");
    addOnLines.push({ service: addOn, offer, quantity: 1 });
  }
  // BASE first, then add-ons by lowercase service UUID.
  addOnLines.sort((a, b) => (a.service.id < b.service.id ? -1 : 1));
  const lines: PricedLine[] = [{ service: base, offer: baseOffer, quantity: selection.quantity }, ...addOnLines];

  // Integer money only, every product and sum checked against the contract maximum.
  const amounts = lines.map(({ service, offer, quantity }) => {
    const unit = offer.unitPriceCentavos ?? (offer.state === "UNCONFIRMED" ? service.referenceUnitPriceCentavos : null);
    return { unit, subtotal: unit === null ? null : unit * quantity };
  });
  if (amounts.some((a) => a.subtotal !== null && !(Number.isSafeInteger(a.subtotal) && a.subtotal <= MAX_CENTAVOS))) {
    return reject("VALIDATION_ERROR", "quantity", "Contact the shop to price this selection.");
  }
  const confirmed = lines.every((l) => l.offer.state === "OFFERED" && l.offer.unitPriceCentavos !== null);
  const total = confirmed ? amounts.reduce((sum, a) => sum + (a.subtotal as number), 0) : null;
  if (total !== null && total > MAX_CENTAVOS) return reject("VALIDATION_ERROR", "addOnServiceIds", "Contact the shop to price this selection.");

  const bookable = lines.length === 1 && base.unit === "VEHICLE" && selection.quantity === 1 && total !== null
    && baseOffer.state === "OFFERED" && baseOffer.bookingMode === "FIXED_ONLINE" && baseOffer.durationKind === "TIMED"
    && Number.isSafeInteger(baseOffer.durationMinutes) && baseOffer.durationMinutes! >= 1 && baseOffer.durationMinutes! <= MAX_MINUTES;
  if (bookable) {
    const quoteLines: QuotedLine[] = [{
      kind: "BASE", serviceId: base.id, offerId: baseOffer.id, name: base.name, unit: base.unit, quantity: 1,
      unitPriceCentavos: total, subtotalCentavos: total, addedMinutes: baseOffer.durationMinutes!,
    }];
    const durationMinutes = baseOffer.durationMinutes!;
    return {
      kind: "BOOKABLE",
      quote: {
        serviceId: selection.serviceId, vehicleCategoryId: selection.vehicleCategoryId, quantity: 1, addOnServiceIds: [],
        version: 2, catalogReleaseId: release.releaseId,
        catalogFingerprint: catalogFingerprint(release, selection, quoteLines, total, durationMinutes),
        pricingAlgorithm: PRICING_ALGORITHM, lines: quoteLines, totalPriceCentavos: total, durationMinutes, currency: "PHP",
      },
    };
  }

  const durationOf = ({ service, offer, quantity }: PricedLine): PublicDuration => {
    if (offer.durationKind === "MULTI_DAY") return { kind: "MULTI_DAY", elapsedDays: offer.elapsedDays };
    // A per-panel time multiplied by the panel count would be an invented duration.
    if (offer.durationKind !== "TIMED" || offer.durationMinutes === null || (service.unit === "PANEL" && quantity !== 1)) return { kind: "UNKNOWN" };
    return { kind: "TIMED", minutes: offer.durationMinutes };
  };
  const durations = lines.map(durationOf);
  let duration: PublicDuration;
  if (durations.some((d) => d.kind === "UNKNOWN")) duration = { kind: "UNKNOWN" };
  else if (durations.some((d) => d.kind === "MULTI_DAY")) duration = { kind: "MULTI_DAY", elapsedDays: durations[0].kind === "MULTI_DAY" ? durations[0].elapsedDays : null };
  else {
    const minutes = durations.reduce((sum, d) => sum + (d.kind === "TIMED" ? d.minutes : 0), 0);
    duration = minutes <= MAX_MINUTES ? { kind: "TIMED", minutes } : { kind: "UNKNOWN" };
  }

  const reasons = new Set<QuoteRequiredReason>();
  if (lines.some((l) => l.offer.unitPriceCentavos === null)) reasons.add("PRICE_UNCONFIRMED");
  if (lines.some((l) => l.offer.state === "UNCONFIRMED")) reasons.add("ELIGIBILITY_UNCONFIRMED");
  if (durations[0].kind === "UNKNOWN") reasons.add("DURATION_UNKNOWN");
  if (durations.some((d) => d.kind === "MULTI_DAY")) reasons.add("MULTI_DAY");
  if (durations.slice(1).some((d) => d.kind !== "TIMED")) reasons.add("ADD_ON_DURATION_UNKNOWN");
  // Offered but quote-first, or a composition with no composite availability contract yet.
  if (baseOffer.bookingMode === "QUOTE_REQUIRED" || reasons.size === 0) reasons.add("INSPECTION_REQUIRED");
  const order: QuoteRequiredReason[] = ["PRICE_UNCONFIRMED", "ELIGIBILITY_UNCONFIRMED", "DURATION_UNKNOWN", "MULTI_DAY", "INSPECTION_REQUIRED", "ADD_ON_DURATION_UNKNOWN"];
  return {
    kind: "QUOTE_REQUIRED",
    reasons: order.filter((r) => reasons.has(r)),
    estimate: {
      catalogReleaseId: release.releaseId,
      selection: { serviceId: selection.serviceId, vehicleCategoryId: selection.vehicleCategoryId, quantity: selection.quantity, addOnServiceIds: [...selection.addOnServiceIds] },
      lines: lines.map((l, i) => ({ serviceId: l.service.id, name: l.service.name, unit: l.service.unit, quantity: l.quantity,
        unitPriceCentavos: amounts[i].unit, subtotalCentavos: amounts[i].subtotal })),
      totalPriceCentavos: total,
      currency: "PHP",
      duration,
    },
  };
}

// Lowercase SHA-256 of the fixed-order array; the manifest hash is server-resolved.
export function catalogFingerprint(
  release: Pick<ReleaseSnapshot, "releaseId" | "manifestSha256">, selection: CatalogSelection,
  lines: QuotedLine[], totalPriceCentavos: number, durationMinutes: number,
): string {
  const selectionArray = [selection.serviceId, selection.vehicleCategoryId, selection.quantity, [...selection.addOnServiceIds]];
  const lineArrays = lines.map((l) => [l.kind, l.serviceId, l.offerId, l.name, l.unit, l.quantity, l.unitPriceCentavos, l.subtotalCentavos, l.addedMinutes]);
  const value = [PRICING_ALGORITHM, release.releaseId, release.manifestSha256, selectionArray, lineArrays, totalPriceCentavos, durationMinutes, "PHP"];
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

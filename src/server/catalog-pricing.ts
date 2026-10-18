import "server-only";
import { createHash } from "node:crypto";
import type {
  BookingQuote, CatalogSelection, CatalogServiceKind, OnlineBooking, PriceUnit, QuotedLine, VehicleCategoryCode,
} from "@/types/catalog-contracts";
import { CatalogIntegrityError } from "./catalog-errors";
import { bookingQueue, primaryServiceLine } from "./catalog-queues";

export { CatalogIntegrityError };

// Server-authoritative pricing for the ADR-005 queue model over one immutable published release
// (ADR-004 per-size offers). Pure: the read seam (catalog-read.ts) loads the release; nothing here
// touches the database, a client price or a duration.

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
  warrantyMonths: number | null; referenceUnitPriceCentavos: number | null; sortOrder: number;
  queueCode: string | null; // release data (ADR-005 §7); NULL only on releases from before the queue model
  offers: ReleaseOffer[];
}
export interface ReleaseSnapshot {
  releaseId: string; version: string; manifestSha256: string;
  sizes: ReleaseSize[]; services: ReleaseService[];
  compatibility: { baseServiceId: string; addOnServiceId: string; sizeCodes: string[] }[];
}

export const PRICING_ALGORITHM = "php-service-size-v3" as const;
export const MAX_CENTAVOS = 100_000_000;

export type UnsignedQuote = Omit<BookingQuote, "issuedAt" | "expiresAt" | "quoteToken">;
export interface PricingRejection {
  code: "NOT_FOUND" | "VALIDATION_ERROR" | "SERVICE_NOT_OFFERED";
  message: string;
  fieldErrors: Record<string, string[]>;
}
export type PricingResult =
  | { kind: "QUOTED"; quote: UnsignedQuote }
  | { kind: "REJECTED"; error: PricingRejection };

const reject = (code: PricingRejection["code"], field: string, message: string): PricingResult =>
  ({ kind: "REJECTED", error: { code, message, fieldErrors: { [field]: [message] } } });

// How a cell books online (ADR-005 §3, Amendment 1 A1 and A2):
// - OFFERED + FIXED_ONLINE: a PRICED line at the source price (today the three washes). Without
//   a source price (which the P1-01 offer check forbids) it is not bookable.
// - OFFERED + QUOTE_REQUIRED: a FOR_QUOTE line; the source price, if any, is its reference.
// - UNCONFIRMED: not bookable, except a per-panel service with a source reference (panel
//   repaint), which is FOR_QUOTE with count x the per-panel reference as its reference.
// - NOT_OFFERED: not bookable.
export function offerBooking(service: ReleaseService, offer: ReleaseOffer): OnlineBooking {
  if (offer.state === "OFFERED") {
    if (offer.bookingMode === "QUOTE_REQUIRED") return "FOR_QUOTE";
    return offer.unitPriceCentavos !== null ? "PRICED" : "UNAVAILABLE";
  }
  if (offer.state === "UNCONFIRMED" && service.unit === "PANEL" && service.referenceUnitPriceCentavos !== null) return "FOR_QUOTE";
  return "UNAVAILABLE";
}
const referenceUnit = (service: ReleaseService, offer: ReleaseOffer) =>
  offer.state === "OFFERED" ? offer.unitPriceCentavos : service.referenceUnitPriceCentavos;

// One size, one or more distinct services in the customer's order. Each line is checked on its
// own (exists, bookable on that size, quantity fits its unit), then the composition: at least one
// base service, and every add-on compatible with some base line on that size. The first base in
// the customer's order is the primary service and decides the queue (ADR-005 §8). Lines come back
// in canonical order (A6): the primary, the other bases by service ID, then add-ons by service ID.
export function priceSelection(release: ReleaseSnapshot, selection: CatalogSelection): PricingResult {
  const size = release.sizes.find((s) => s.id === selection.vehicleCategoryId);
  if (!size) return reject("NOT_FOUND", "vehicleCategoryId", "Choose one of the listed vehicle sizes.");

  const resolved: { service: ReleaseService; offer: ReleaseOffer; quantity: number; booking: OnlineBooking }[] = [];
  for (const [i, line] of selection.lines.entries()) {
    const service = release.services.find((s) => s.id === line.serviceId);
    if (!service) return reject("NOT_FOUND", `lines.${i}.serviceId`, "Choose one of the listed services.");
    const offer = service.offers.find((o) => o.vehicleCategoryId === size.id);
    if (!offer) throw new CatalogIntegrityError("missing size offer"); // the release has five per service
    const booking = offerBooking(service, offer);
    if (booking === "UNAVAILABLE") {
      return reject("SERVICE_NOT_OFFERED", `lines.${i}.serviceId`, offer.state === "NOT_OFFERED"
        ? "This service isn't offered for that vehicle size." : "This service can't be booked online for that vehicle size yet. Contact the shop.");
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 20 || (service.unit === "VEHICLE" && line.quantity !== 1)) {
      return reject("VALIDATION_ERROR", `lines.${i}.quantity`, service.unit === "VEHICLE" ? "This service is priced per vehicle." : "Choose 1 to 20 panels.");
    }
    resolved.push({ service, offer, quantity: line.quantity, booking });
  }
  const bases = resolved.filter((r) => r.service.type === "BASE");
  if (bases.length === 0) return reject("VALIDATION_ERROR", "lines.0.serviceId", "Add-ons are added to a main service; choose one first.");
  for (const [i, r] of resolved.entries()) {
    if (r.service.type !== "ADD_ON") continue;
    const compatible = bases.some((b) => release.compatibility.some((c) =>
      c.baseServiceId === b.service.id && c.addOnServiceId === r.service.id && c.sizeCodes.includes(size.code)));
    if (!compatible) return reject("VALIDATION_ERROR", `lines.${i}.serviceId`, "This add-on can't be added to the selected services.");
  }

  const primary = primaryServiceLine(release, selection.lines);
  const queueId = bookingQueue(release, [primary]); // fails closed when the primary has no queue
  const byId = (a: { service: ReleaseService }, b: { service: ReleaseService }) => (a.service.id < b.service.id ? -1 : a.service.id > b.service.id ? 1 : 0);
  const canonical = [
    resolved.find((r) => r.service.id === primary.serviceId)!,
    ...bases.filter((r) => r.service.id !== primary.serviceId).sort(byId),
    ...resolved.filter((r) => r.service.type === "ADD_ON").sort(byId),
  ];

  // Integer money only; every product and sum is checked against the contract maximum.
  const lines: QuotedLine[] = canonical.map(({ service, offer, quantity, booking }) => {
    const unit = booking === "PRICED" ? offer.unitPriceCentavos! : referenceUnit(service, offer);
    const subtotal = unit === null ? null : unit * quantity;
    return {
      serviceId: service.id, offerId: offer.id, kind: service.type, name: service.name, unit: service.unit, quantity,
      priceStatus: booking === "PRICED" ? "PRICED" : "FOR_QUOTE",
      unitPriceCentavos: booking === "PRICED" ? unit : null, subtotalCentavos: booking === "PRICED" ? subtotal : null,
      referenceUnitPriceCentavos: booking === "PRICED" ? null : unit, referenceSubtotalCentavos: booking === "PRICED" ? null : subtotal,
    };
  });
  const total = lines.reduce((s, l) => s + (l.subtotalCentavos ?? 0), 0);
  const forQuote = lines.filter((l) => l.priceStatus === "FOR_QUOTE");
  const estimated = forQuote.every((l) => l.referenceSubtotalCentavos !== null) ? total + forQuote.reduce((s, l) => s + l.referenceSubtotalCentavos!, 0) : null;
  const amounts = [...lines.flatMap((l) => [l.subtotalCentavos, l.referenceSubtotalCentavos]), total, estimated];
  if (amounts.some((a) => a !== null && !(Number.isSafeInteger(a) && a <= MAX_CENTAVOS))) {
    return reject("VALIDATION_ERROR", "lines", "Contact the shop to price this selection.");
  }
  const body = { vehicleCategoryId: selection.vehicleCategoryId, primaryServiceId: primary.serviceId, queueId, lines,
    totalPriceCentavos: total, estimatedTotalCentavos: estimated };
  return {
    kind: "QUOTED",
    quote: {
      version: 3, catalogReleaseId: release.releaseId, catalogFingerprint: catalogFingerprint(release, body),
      pricingAlgorithm: PRICING_ALGORITHM, ...body, currency: "PHP",
    },
  };
}

// Lowercase SHA-256 of the fixed-order array; the manifest hash is server-resolved.
export function catalogFingerprint(
  release: Pick<ReleaseSnapshot, "releaseId" | "manifestSha256">,
  q: Pick<UnsignedQuote, "vehicleCategoryId" | "primaryServiceId" | "queueId" | "lines" | "totalPriceCentavos" | "estimatedTotalCentavos">,
): string {
  const lineArrays = q.lines.map((l) => [l.serviceId, l.offerId, l.kind, l.name, l.unit, l.quantity, l.priceStatus,
    l.unitPriceCentavos, l.subtotalCentavos, l.referenceUnitPriceCentavos, l.referenceSubtotalCentavos]);
  const value = [PRICING_ALGORITHM, release.releaseId, release.manifestSha256, q.vehicleCategoryId, q.primaryServiceId, q.queueId,
    lineArrays, q.totalPriceCentavos, q.estimatedTotalCentavos, "PHP"];
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

import "server-only";
import type { BookingCatalog, BookingCatalogResponse, PublicDuration, ServiceSizeOffer } from "@/types/catalog-contracts";
import { catalogUnavailable } from "./catalog-errors";
import { offerBooking, type ReleaseOffer, type ReleaseService, type ReleaseSnapshot } from "./catalog-pricing";
import { readPublicCatalog, type CatalogReadOptions } from "./catalog-read";

// The customer catalog DTO (ADR-004 releases, ADR-005 booking; T-040 P-02, T-043 C-02): the
// current published release, projected field by field. Never spread a model: anything not named
// here (bay capacity, caps, queues, hold plans, source annotations, comparison prices, ratings)
// cannot reach a customer.
export async function getBookingCatalog(options: CatalogReadOptions = {}): Promise<BookingCatalogResponse> {
  try {
    const release = await readPublicCatalog((current) => current, options);
    return release ? { ok: true, data: projectPublicCatalog(release) } : { ok: false, error: catalogUnavailable() };
  } catch {
    return { ok: false, error: catalogUnavailable() };
  }
}

function publicDuration(offer: ReleaseOffer): PublicDuration {
  if (offer.state === "NOT_OFFERED" || offer.durationKind === "UNKNOWN" || (offer.durationKind === "TIMED" && offer.durationMinutes === null)) return { kind: "UNKNOWN" };
  if (offer.durationKind === "MULTI_DAY") return { kind: "MULTI_DAY", elapsedDays: offer.elapsedDays };
  return { kind: "TIMED", minutes: offer.durationMinutes! };
}

function publicOffer(service: ReleaseService, offer: ReleaseOffer): ServiceSizeOffer {
  // Durations are informational only (ADR-005); onlineBooking is the same rule pricing applies.
  const common = { id: offer.id, vehicleCategoryId: offer.vehicleCategoryId, duration: publicDuration(offer), onlineBooking: offerBooking(service, offer) };
  // Comparison prices stay null until a reviewed release and contract enable their display.
  if (offer.state === "OFFERED" && offer.unitPriceCentavos !== null) {
    return { ...common, state: "OFFERED", bookingMode: offer.bookingMode, unitPriceCentavos: offer.unitPriceCentavos, compareAtCentavos: null };
  }
  if (offer.state === "NOT_OFFERED") return { ...common, state: "NOT_OFFERED", bookingMode: "QUOTE_REQUIRED", unitPriceCentavos: null, compareAtCentavos: null };
  return { ...common, state: "UNCONFIRMED", bookingMode: "QUOTE_REQUIRED", unitPriceCentavos: offer.unitPriceCentavos, compareAtCentavos: null };
}

export function projectPublicCatalog(release: ReleaseSnapshot): BookingCatalog {
  return {
    catalogReleaseId: release.releaseId,
    catalogVersion: release.version,
    vehicleCategories: release.sizes.map((s) => ({ id: s.id, code: s.code, name: s.name, description: s.description, sortOrder: s.sortOrder })),
    services: release.services.map((s) => ({
      id: s.id, slug: s.slug, name: s.name, description: s.description, category: s.group, type: s.type, unit: s.unit,
      inclusions: [...s.inclusions], productName: s.productName, hardness: s.hardness, warrantyMonths: s.warrantyMonths,
      referenceUnitPriceCentavos: s.referenceUnitPriceCentavos,
      offers: release.sizes.map((size) => publicOffer(s, s.offers.find((o) => o.vehicleCategoryId === size.id)!)),
    })),
    addOnCompatibility: release.compatibility.map((c) => ({ baseServiceId: c.baseServiceId, addOnServiceId: c.addOnServiceId })),
  };
}

import type { LandingStatus } from "@/server/landing/status";
import type { BookingCatalog, CatalogSelection, ServicePackage, VehicleCategory, VehicleBodyType } from "@/types/catalog-contracts";

export const money = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: centavos % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(centavos / 100);
export function servicePrice(service: ServicePackage, size?: VehicleCategory, body?: VehicleBodyType): string {
  const offers = size ? service.offers.filter((o) => o.vehicleCategoryId === size.id) : service.offers;
  if (!size) {
    const priced = offers.filter((o) => o.onlineBooking === "PRICED" && o.state === "OFFERED");
    // CEO rule A (P1-89): "from" the lowest size misleads when sizes cost different amounts; a pickup surcharge is a body variant, not a size.
    if (new Set(priced.map((o) => o.unitPriceCentavos)).size > 1) return "Price depends on size";
    const prices = priced.flatMap((o) => o.state === "OFFERED" ? [o.unitPriceCentavos, ...(o.pickupPriceCentavos !== undefined ? [o.pickupPriceCentavos] : [])] : []);
    return prices.length ? `from ${money(Math.min(...prices))}` : "Price on inspection";
  }
  const offer = offers[0];
  if (!offer || offer.state === "NOT_OFFERED" || offer.onlineBooking === "UNAVAILABLE") return "Not offered for this size";
  if (offer.state === "UNCONFIRMED") return "Ask for a price";
  const amount = body === "PICKUP" ? offer.pickupPriceCentavos ?? offer.unitPriceCentavos : offer.unitPriceCentavos;
  const unit = service.unit === "PANEL" ? " per panel" : "";
  if (offer.onlineBooking === "FOR_QUOTE") return `Price on inspection${amount !== null ? ` · about ${money(amount)}${unit}` : ""}`;
  if ((size.code === "L" || size.code === "XL") && !body) return `from ${money(Math.min(amount, offer.pickupPriceCentavos ?? amount))}${unit}`;
  return money(amount) + unit;
}
export function bookingHref(catalog: Pick<BookingCatalog, "services">, size: VehicleCategory | undefined, lines: CatalogSelection["lines"]): string {
  const line = lines[0], service = catalog.services.find((s) => s.id === line?.serviceId);
  const eligible = lines.length === 1 && service?.type === "BASE" && service.unit === "VEHICLE" && line.quantity === 1 && size && ["MOTOR", "S", "M"].includes(size.code) && service.offers.some((o) => o.vehicleCategoryId === size.id && o.onlineBooking === "PRICED");
  return eligible ? `/book?service=${encodeURIComponent(service.slug)}&vehicle=${size.code}` : "/book";
}
export function pruneSelection(catalog: Pick<BookingCatalog, "services" | "addOnCompatibility">, lines: CatalogSelection["lines"]): CatalogSelection["lines"] {
  return lines.filter((l) => {
    const service = catalog.services.find((s) => s.id === l.serviceId);
    return service?.type === "BASE" || (service?.type === "ADD_ON" && catalog.addOnCompatibility.some((c) => c.addOnServiceId === l.serviceId && lines.some((b) => b.serviceId === c.baseServiceId)));
  });
}
export const selectionKey = (size: string, body: VehicleBodyType | undefined, lines: CatalogSelection["lines"]) => JSON.stringify([size, body ?? null, lines.map((l) => [l.serviceId, l.quantity])]);
export const estimateLabels = (hasInspection: boolean, estimate: number | null) => ({ subtotal: hasInspection ? "Known-price subtotal" : "Total", estimate: hasInspection ? estimate === null ? "Unknown until inspection" : money(estimate) : null });
export type QuoteAnswer = { ok?: boolean; error?: { code?: string; message?: string; retryAfterSeconds?: number } } | null;
// answer is null when the body is not JSON (for example a proxy 502 page): show "unavailable", never parser text.
export function quoteFailure(status: number, answer: QuoteAnswer, retryAfter: string | null): { message: string; seconds?: number } {
  if (status === 429) { const seconds = Number(answer?.error?.retryAfterSeconds ?? retryAfter) || 60; return { message: `Too many estimates right now. Try again in ${seconds} seconds.`, seconds }; }
  if (answer?.error?.code === "CATALOG_UPDATED") return { message: "Prices just changed. Get a new estimate." };
  if (status === 503 || !answer) return { message: "Prices are unavailable right now." };
  return { message: answer.error?.message ?? "Could not get an estimate. Try again later." };
}
// LE revision: the landing action always opens booking. The booking route owns availability.
export function bookingAction(): { label: string; href: string } {
  return { label: "Book now", href: "/book" };
}
// 17.4: the card arrow books that one service; it never depends on the estimate selection.
export function serviceArrow(catalog: Pick<BookingCatalog, "services">, size: VehicleCategory | undefined, service: Pick<ServicePackage, "id" | "name">, status: LandingStatus, phone: string): { label: string; href: string } {
  if (status === "PAUSED") return { label: `Call to book ${service.name}`, href: `tel:${phone}` };
  return { label: `Book ${service.name}`, href: bookingHref(catalog, size, [{ serviceId: service.id, quantity: 1 }]) };
}

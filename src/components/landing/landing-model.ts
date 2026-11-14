import type { BookingCatalog, CatalogSelection, ServicePackage, VehicleCategory, VehicleBodyType } from "@/types/catalog-contracts";

export const money = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: centavos % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(centavos / 100);
export function servicePrice(service: ServicePackage, size?: VehicleCategory, body?: VehicleBodyType): string {
  const offers = size ? service.offers.filter((o) => o.vehicleCategoryId === size.id) : service.offers;
  if (!size) {
    const prices = offers.filter((o) => o.onlineBooking === "PRICED").flatMap((o) => o.state === "OFFERED" ? [o.unitPriceCentavos, ...(o.pickupPriceCentavos !== undefined ? [o.pickupPriceCentavos] : [])] : []);
    return prices.length ? `from ${money(Math.min(...prices))}` : "Price on inspection";
  }
  const offer = offers[0];
  if (!offer || offer.state === "NOT_OFFERED" || offer.onlineBooking === "UNAVAILABLE") return "Not offered for this vehicle";
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

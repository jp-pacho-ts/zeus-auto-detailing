import type { ServicePackage, VehicleBodyType, VehicleCategory } from "@/types/catalog-contracts";

// LE 2026-11-20: a promo set in admin is saved as the selling price (unitPriceCentavos) with the regular price kept as
// compareAtCentavos, and online booking charges the selling price. The landing page shows that as a discount.
export type Deal = { priceCentavos: number; regularCentavos: number; percent: number };

// Rounded down, so a saving is never overstated; under 1% is not shown as a deal.
const percentOff = (price: number, regular: number) => Math.floor((regular - price) * 100 / regular);

// Only a priced, bookable offer whose compare-at is above its selling price. Compare-at covers the standard price, so
// a pickup price (chosen, or possibly the one shown while no body type is chosen) never gets a discount label.
function offerDeal(offer: ServicePackage["offers"][number], body?: VehicleBodyType): Deal | null {
  if (offer.state !== "OFFERED" || offer.onlineBooking !== "PRICED" || offer.compareAtCentavos === null) return null;
  if (offer.pickupPriceCentavos !== undefined && body !== "SUV" && body !== "VAN") return null;
  const percent = percentOff(offer.unitPriceCentavos, offer.compareAtCentavos);
  return percent >= 1 ? { priceCentavos: offer.unitPriceCentavos, regularCentavos: offer.compareAtCentavos, percent } : null;
}

export function serviceDeal(service: ServicePackage, size?: VehicleCategory, body?: VehicleBodyType): Deal | null {
  const offer = size && service.offers.find((o) => o.vehicleCategoryId === size.id);
  return offer ? offerDeal(offer, body) : null;
}

// The deepest saving on any size ("Up to N% off" when no size is chosen); null when nothing is on promo.
export function bestDealPercent(service: ServicePackage): number | null {
  const percents = service.offers.flatMap((o) => { const deal = offerDeal(o, "SUV"); return deal ? [deal.percent] : []; });
  return percents.length ? Math.max(...percents) : null;
}

// The largest peso saving on any size ("Save up to ₱…"); null when nothing is on promo.
export function bestSavingCentavos(service: ServicePackage): number | null {
  const savings = service.offers.flatMap((o) => { const deal = offerDeal(o, "SUV"); return deal ? [deal.regularCentavos - deal.priceCentavos] : []; });
  return savings.length ? Math.max(...savings) : null;
}

// Main services on promo, deepest saving first, at most three: the owner features a service by giving it a promo.
export function featuredDeals(services: ServicePackage[]): ServicePackage[] {
  return services.filter((s) => s.type === "BASE" && bestDealPercent(s) !== null)
    .sort((a, b) => bestDealPercent(b)! - bestDealPercent(a)!)
    .slice(0, 3);
}

// LE 2026-11-20: the landing page always shows clients the best services for them. Promos lead; the rest of the three
// places go to the shop's lead main service (catalog order, as the owner arranged it) in Wash, Detailing and Graphene,
// then other categories. Only services with an online price are shown. A real "Featured" switch in admin is a later task.
export function featuredServices(services: ServicePackage[]): ServicePackage[] {
  const picks = featuredDeals(services);
  const priced = services.filter((s) => s.type === "BASE" && s.offers.some((o) => o.state === "OFFERED" && o.onlineBooking === "PRICED"));
  const order = ["WASH", "DETAILING", "GRAPHENE", "TINT", "PPF", "REPAINT"];
  for (const kind of order) {
    if (picks.length >= 3) break;
    if (picks.some((p) => p.category === kind)) continue;
    const lead = priced.find((s) => s.category === kind);
    if (lead) picks.push(lead);
  }
  return picks;
}

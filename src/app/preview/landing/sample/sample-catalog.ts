import type { BookingCatalog, CatalogServiceKind, ServicePackage, VehicleCategory, VehicleCategoryCode } from "@/types/catalog-contracts";

// Design-review data only (LE 2026-11-20): invented prices and promos so the featured offers and discounts can be seen
// on a loopback dev server without a database. Never used in production (the sample page 404s there).
const SIZES: [VehicleCategoryCode, string][] = [["MOTOR", "Motor / Motorcycle"], ["S", "Small"], ["M", "Medium"], ["L", "Large"], ["XL", "Extra large"]];
const vehicleCategories: VehicleCategory[] = SIZES.map(([code, name], i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, code, name, description: null, sortOrder: i }));

// prices: [regular, promo | null] per size in pesos; null regular = not offered for that size.
function service(n: number, slug: string, name: string, category: CatalogServiceKind, description: string, prices: ([number, number | null] | null)[], inclusions: string[] = []): ServicePackage {
  return {
    id: `00000000-0000-4000-9000-0000000000${String(n).padStart(2, "0")}`, slug, name, description, category, type: "BASE", unit: "VEHICLE", inclusions,
    productName: null, hardness: null, warrantyMonths: null, referenceUnitPriceCentavos: null,
    offers: vehicleCategories.map((size, i) => {
      const p = prices[i], common = { id: `${size.id.slice(0, -2)}${n}${i}`, vehicleCategoryId: size.id, duration: { kind: "TIMED" as const, minutes: 60 } };
      if (!p) return { ...common, onlineBooking: "UNAVAILABLE" as const, state: "NOT_OFFERED" as const, bookingMode: "QUOTE_REQUIRED" as const, unitPriceCentavos: null, compareAtCentavos: null };
      const [regular, promo] = p;
      return { ...common, onlineBooking: "PRICED" as const, state: "OFFERED" as const, bookingMode: "FIXED_ONLINE" as const,
        unitPriceCentavos: (promo ?? regular) * 100, compareAtCentavos: promo === null ? null : regular * 100 };
    }),
  };
}

export const SAMPLE_CATALOG: BookingCatalog = {
  catalogReleaseId: "00000000-0000-4000-a000-000000000001", catalogVersion: "sample", vehicleCategories, addOnCompatibility: [],
  services: [
    service(1, "basic-wash", "Basic Wash", "WASH", "Exterior wash, wheels and a hand dry.", [[150, null], [250, 199], [300, 249], [350, 299], [400, 349]]),
    service(2, "signature-wash", "Signature Wash", "WASH", "A fuller wash with tyre shine and interior vacuum.", [null, [450, null], [550, null], [650, null], [750, null]]),
    service(3, "exterior-detailing", "Exterior Detailing", "DETAILING", "Decontamination, machine polish and protection for the paint.", [null, [3500, null], [4200, null], [5000, null], [5800, null]]),
    service(4, "eclipse-graphene", "Eclipse", "GRAPHENE", "Entry graphene coating for lasting gloss and easier washing.", [null, [11700, 9900], [13700, null], [15700, null], [17700, null]], ["Decon wash", "Graphene base"]),
    service(5, "kenzo-graphene", "Kenzo", "GRAPHENE", "Two-layer graphene coating.", [null, [17500, null], [19500, null], [21500, null], [23500, null]], ["Decon wash", "Graphene base", "Graphene top"]),
  ],
};

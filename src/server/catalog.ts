import "server-only";
import { Prisma } from "@prisma/client";
import { VehicleCategoryCodeSchema } from "@/lib/validation";
import type { BookingCatalogResponse } from "@/types/contracts";
import { prisma } from "./db";
import { contractError } from "./errors";

export async function getBookingCatalog(): Promise<BookingCatalogResponse> {
  try {
    const data = await prisma.$transaction(async tx => {
      const [categories, services] = await Promise.all([
        tx.vehicleCategory.findMany({ orderBy: { sortOrder: "asc" } }),
        tx.service.findMany({ where: { isActive: true, bayCapacityRequired: 1, durationMinutes: { gt: 0, lte: 540 } }, orderBy: { name: "asc" } }),
      ]);
      return {
        vehicleCategories: categories.flatMap(c => !VehicleCategoryCodeSchema.safeParse(c.slug).success || !c.sizeMultiplier || !c.sizeMultiplier.gt(0) ? [] : [({ id: c.id, code: VehicleCategoryCodeSchema.parse(c.slug), name: c.name, description: c.description, sizeMultiplier: c.sizeMultiplier.toNumber(), sortOrder: c.sortOrder })]),
        services: services.flatMap(s => s.price === null || s.durationMinutes === null ? [] : [({ id: s.id, slug: s.slug, name: s.name, description: s.description, category: s.category, durationMinutes: s.durationMinutes, basePriceCentavos: s.price.mul(100).toNumber(), bayCapacityRequired: 1 as const, isActive: s.isActive })]),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { ok: true, data };
  } catch (error) { return { ok: false, error: contractError(error) }; }
}

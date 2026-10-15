import "server-only";
import { Prisma } from "@prisma/client";
import { VehicleCategoryCodeSchema } from "@/lib/validation";
import type { GetAvailableSlotsRequest } from "@/types/contracts";
import { appointmentInstant, assertBookingHorizon, calculateAvailability, dateCarrier } from "./availability-core";
import { DomainError } from "./errors";

export async function readAvailability(tx: Prisma.TransactionClient, request: GetAvailableSlotsRequest, now = new Date()) {
  assertBookingHorizon(request.date, now);
  const date = dateCarrier(request.date);
  const [category, service, config, templates, overrides, blocks, bookings] = await Promise.all([
    tx.vehicleCategory.findUnique({ where: { id: request.vehicleCategoryId } }),
    tx.service.findUnique({ where: { id: request.serviceId } }),
    tx.scheduleConfig.findFirst({ where: { effectiveDate: { lte: date } }, orderBy: { effectiveDate: "desc" } }),
    tx.timeSlot.findMany({ where: { dayOfWeek: date.getUTCDay() }, orderBy: { startTime: "asc" } }),
    tx.slotCapacityOverride.findMany({ where: { date } }),
    tx.blockedDate.findMany({ where: { date } }),
    tx.booking.findMany({ where: { status: { not: "CANCELLED" }, startsAt: { lt: new Date(appointmentInstant(request.date, "00:00").getTime() + 86400000) }, endsAt: { gt: appointmentInstant(request.date, "00:00") } }, select: { startsAt: true, endsAt: true, status: true } }),
  ]);
  if (!category || !VehicleCategoryCodeSchema.safeParse(category.slug).success) throw new DomainError("NOT_FOUND", "Choose a supported vehicle category.", { vehicleCategoryId: ["Vehicle category is unavailable."] });
  if (!service || !service.isActive) throw new DomainError("NOT_FOUND", "Choose an active service.", { serviceId: ["Service is unavailable."] });
  if (!config || service.bayCapacityRequired !== 1 || category.sizeMultiplier.lte(0) || service.price.lt(0)) throw new DomainError("SCHEDULE_CONFLICT", "The shop catalog or schedule needs review.");
  const price = service.price.mul(category.sizeMultiplier).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const totalPriceCentavos = price.mul(100).toNumber();
  if (!Number.isSafeInteger(totalPriceCentavos)) throw new DomainError("SCHEDULE_CONFLICT", "The service quote is unavailable.");
  const data = calculateAvailability({ request, now, config, templates, overrides, blocks, bookings, durationMinutes: service.durationMinutes, totalPriceCentavos });
  return { data, service, category, price };
}

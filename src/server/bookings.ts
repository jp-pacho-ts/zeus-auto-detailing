import "server-only";
import { createHash, randomInt } from "node:crypto";
import { Prisma, type Booking, type PrismaClient } from "@prisma/client";
import { CreateBookingSchema } from "@/lib/validation";
import type { BookingResponse, BookingSummary, CreateBookingRequest } from "@/types/contracts";
import { appointmentInstant, dateCarrier, SHOP_CURRENCY, SHOP_TIMEZONE } from "./availability-core";
import { readAvailability } from "./availability-data";
import { prisma } from "./db";
import { contractError, DomainError, validationError } from "./errors";

function summary(b: Booking): BookingSummary {
  // Slot-era serializer: QUEUE_V3 day bookings have no clock times (P1-02 D1); P1-03 replaces it.
  if (b.startTime === null || b.endTime === null || b.durationMinutes === null) throw new Error("Day-queue booking in the legacy slot summary");
  return { id: b.id, referenceCode: b.referenceCode, status: b.status, vehicleCategoryId: b.vehicleCategoryId, vehicleCategoryName: b.vehicleCategoryNameSnapshot, serviceId: b.serviceId, serviceName: b.serviceNameSnapshot, bookingDate: b.bookingDate.toISOString().slice(0, 10), startTime: b.startTime, endTime: b.endTime, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), timezone: SHOP_TIMEZONE, durationMinutes: b.durationMinutes, totalPriceCentavos: b.priceSnapshot.mul(100).toNumber(), currency: SHOP_CURRENCY, customerName: b.customerName, customerPhone: b.customerPhone, customerEmail: b.customerEmail, vehicleModel: b.vehicleModel, vehiclePlate: b.vehiclePlate, specialRequests: b.notes, createdAt: b.createdAt.toISOString() };
}
function requestHash(r: CreateBookingRequest): string {
  const normalized = [r.vehicleCategoryId, r.serviceId, r.bookingDate, r.startTime, r.customerName, r.customerPhone, r.customerEmail ?? null, r.vehicleModel, r.vehiclePlate ?? null, r.specialRequests ?? null];
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function referenceCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return "ZEUS-" + Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}
export async function commitBooking(input: unknown, client: PrismaClient = prisma): Promise<{ result: BookingResponse; created: boolean }> {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(input); } catch { serialized = undefined; }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 16384) return { result: { ok: false, error: { code: "VALIDATION_ERROR", message: "Booking details must fit within 16 KiB.", fieldErrors: {}, retryable: false } }, created: false };
  const parsed = CreateBookingSchema.safeParse(input);
  if (!parsed.success) return { result: { ok: false, error: validationError(parsed.error.issues) }, created: false };
  const r = parsed.data, hash = requestHash(r);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(async tx => {
        // All future capacity-affecting writers must acquire this canonical shop lock first.
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::int, $2::int)", 746001, 1);
        const dateHash = createHash("sha256").update(r.bookingDate).digest().readInt32BE(0);
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::int, $2::int)", 746002, dateHash);
        const prior = await tx.booking.findUnique({ where: { idempotencyKey: r.idempotencyKey } });
        if (prior) {
          if (prior.requestHash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", "This retry key belongs to different booking details. Start a new submission.");
          return { result: { ok: true as const, data: summary(prior) }, created: false };
        }
        const { data, service, category, price } = await readAvailability(tx, { date: r.bookingDate, vehicleCategoryId: r.vehicleCategoryId, serviceId: r.serviceId });
        const slot = data.slots.find(s => s.startTime === r.startTime);
        if (!slot?.selectable) throw new DomainError("SLOT_UNAVAILABLE", slot?.reason || data.reason || "Choose an available arrival time.", { startTime: [slot?.reason || data.reason || "This arrival time is unavailable."] });
        const booking = await tx.booking.create({ data: { referenceCode: referenceCode(), customerName: r.customerName, customerPhone: r.customerPhone, customerEmail: r.customerEmail ?? null, vehicleModel: r.vehicleModel, vehiclePlate: r.vehiclePlate ?? null, notes: r.specialRequests ?? null, vehicleCategoryId: r.vehicleCategoryId, serviceId: r.serviceId, bookingDate: dateCarrier(r.bookingDate), startTime: slot.startTime, endTime: slot.endTime, startsAt: appointmentInstant(r.bookingDate, slot.startTime), endsAt: appointmentInstant(r.bookingDate, slot.endTime), status: "PENDING", durationMinutes: service.durationMinutes, priceSnapshot: price, serviceNameSnapshot: service.name, vehicleCategoryNameSnapshot: category.name, idempotencyKey: r.idempotencyKey, requestHash: hash } });
        return { result: { ok: true as const, data: summary(booking) }, created: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof DomainError) return { result: { ok: false, error: contractError(error) }, created: false };
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (attempt < 2 && ["P2002", "P2034", "P2028", "P2024", "P1001", "P1002", "P1008", "P1017"].includes(code)) continue;
      return { result: { ok: false, error: contractError(error) }, created: false };
    }
  }
  return { result: { ok: false, error: contractError(null) }, created: false };
}
export async function reserveBooking(input: unknown, client: PrismaClient = prisma): Promise<BookingResponse> {
  return (await commitBooking(input, client)).result;
}

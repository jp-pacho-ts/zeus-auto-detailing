import "server-only";
import { type Booking, type PrismaClient } from "@prisma/client";
import { CreateBookingSchema } from "@/lib/validation";
import type { BookingResponse, BookingSummary } from "@/types/contracts";
import { SHOP_CURRENCY, SHOP_TIMEZONE } from "./availability-core";
import { prisma } from "./db";
import { legacyRequestHash } from "./bookings-hash";
import { withBookingDb } from "./bookings-admission";
import { bookingDbNow } from "./bookings-locks";
import { contractError, validationError } from "./errors";
// Historical projection only. Fresh slot creates are permanently retired; keep the exact
// normalized hash and stored snapshots so an already committed old tab can retry safely.
export function legacyBookingSummary(b: Booking): BookingSummary {
    if (b.startTime === null || b.endTime === null || b.durationMinutes === null)
        throw new Error("Not a legacy slot receipt");
    return {
        id: b.id, referenceCode: b.referenceCode, status: b.status, vehicleCategoryId: b.vehicleCategoryId, vehicleCategoryName: b.vehicleCategoryNameSnapshot, serviceId: b.serviceId, serviceName: b.serviceNameSnapshot, bookingDate: b.bookingDate.toISOString().slice(0, 10), startTime: b.startTime, endTime: b.endTime, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), timezone: SHOP_TIMEZONE, durationMinutes: b.durationMinutes, totalPriceCentavos: b.priceSnapshot.mul(100).toNumber(), currency: SHOP_CURRENCY, customerName: b.customerName, customerPhone: b.customerPhone, customerEmail: b.customerEmail, vehicleModel: b.vehicleModel, vehiclePlate: b.vehiclePlate, specialRequests: b.notes, createdAt: b.createdAt.toISOString()
    };
}
export async function commitBooking(input: unknown, client: PrismaClient = prisma): Promise<{
    result: BookingResponse;
    created: boolean;
}> {
    const fail = (code: "VALIDATION_ERROR" | "IDEMPOTENCY_CONFLICT" | "UNAUTHENTICATED", message: string) => ({ result: { ok: false as const, error: {
                code, message, fieldErrors: {}, retryable: false
            } }, created: false });
    let text: string | undefined;
    try {
        text = JSON.stringify(input);
    }
    catch { /* invalid input */ }
    if (!text || Buffer.byteLength(text) > 16384)
        return fail("VALIDATION_ERROR", "Booking details must fit within 16 KiB.");
    const parsed = CreateBookingSchema.safeParse(input);
    if (!parsed.success)
        return { result: { ok: false, error: validationError(parsed.error.issues) }, created: false };
    const r = parsed.data;
    try {
        return await withBookingDb(client, "PREFLIGHT", async (tx) => {
            const b = await tx.booking.findFirst({ where: { idempotencyKey: { equals: r.idempotencyKey, mode: "insensitive" } } });
            if (!b)
                return fail("VALIDATION_ERROR", "Refresh the booking page to start a day booking.");
            if (b.snapshotVersion !== "LEGACY_V1" || b.requestHash !== legacyRequestHash(r))
                return fail("IDEMPOTENCY_CONFLICT", "This retry key belongs to different booking details.");
            const now = await bookingDbNow(tx);
            if (now.getTime() >= b.createdAt.getTime() + 86400000)
                return fail("VALIDATION_ERROR", "Refresh the booking page and contact the shop about this older submission.");
            if (b.managementTokenVersion !== 1)
                return fail("UNAUTHENTICATED", "This submission can no longer be recovered. Please contact the shop.");
            return { result: { ok: true as const, data: legacyBookingSummary(b) }, created: false };
        });
    }
    catch (error) {
        return { result: { ok: false, error: contractError(error) }, created: false };
    }
}
export async function reserveBooking(input: unknown, client: PrismaClient = prisma): Promise<BookingResponse> { return (await commitBooking(input, client)).result; }

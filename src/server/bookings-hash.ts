import "server-only";
import { createHash } from "node:crypto";
import type { CreateBookingRequest, CreateDayBookingRequest } from "@/types/contracts";
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
// Do not change: existing raw legacy receipts bind precisely this release-1 array.
export function legacyRequestHash(r: CreateBookingRequest): string {
    return sha256(JSON.stringify([
        r.vehicleCategoryId, r.serviceId, r.bookingDate, r.startTime, r.customerName, r.customerPhone, r.customerEmail ?? null, r.vehicleModel, r.vehiclePlate ?? null, r.specialRequests ?? null
    ]));
}
export function bookingRequestHash(r: CreateDayBookingRequest): string {
    const q = r.acceptedQuote;
    return sha256(JSON.stringify([
        r.contractVersion, r.vehicleCategoryId, r.lines.map(l => [l.serviceId, l.quantity]), r.bookingDate,
        [
            q.version, q.catalogReleaseId, q.catalogFingerprint, q.pricingAlgorithm, q.vehicleCategoryId, q.primaryServiceId, q.queueId,
            q.lines.map(l => [
                l.serviceId, l.offerId, l.kind, l.name, l.unit, l.quantity, l.priceStatus, l.unitPriceCentavos, l.subtotalCentavos, l.referenceUnitPriceCentavos, l.referenceSubtotalCentavos
            ]), q.totalPriceCentavos, q.estimatedTotalCentavos, q.currency, q.issuedAt, q.expiresAt, q.quoteToken
        ],
        r.customerName, r.customerPhone, r.customerEmail ?? null, r.vehicleModel, r.vehiclePlate ?? null, r.specialRequests ?? null
    ]));
}

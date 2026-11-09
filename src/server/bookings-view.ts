import "server-only";
import type { Booking, BookingLineItem } from "@prisma/client";
import type { DayBookingView } from "@/types/contracts";

export function publicDayBooking(b: Booking & {
  lineItems: BookingLineItem[];
}): DayBookingView {
  const lines = b.lineItems
    .filter((l) => !l.removedAt)
    .sort((a, c) => a.order - c.order)
    .map((l) => ({
      serviceId: l.serviceId,
      name: l.nameSnapshot,
      quantity: l.quantity,
      priceStatus: (l.staffPriceCentavos !== null || l.priceStatus === "PRICED"
        ? "PRICED"
        : "FOR_QUOTE") as "PRICED" | "FOR_QUOTE",
      subtotalCentavos: l.staffPriceCentavos ?? l.subtotalCentavos,
      referenceSubtotalCentavos: l.referenceSubtotalCentavos,
    }));
  const total = lines.reduce((s, l) => s + (l.subtotalCentavos ?? 0), 0),
    pending = lines.filter((l) => l.priceStatus === "FOR_QUOTE");
  return {
    id: b.id,
    referenceCode: b.referenceCode,
    status: b.status,
    revision: b.revision,
    bookingDate: b.bookingDate.toISOString().slice(0, 10),
    timezone: "Asia/Manila",
    vehicleCategoryId: b.vehicleCategoryId,
    vehicleCategoryName: b.vehicleCategoryNameSnapshot,
    lines,
    totalPriceCentavos: total,
    estimatedTotalCentavos: pending.some(
      (l) => l.referenceSubtotalCentavos === null,
    )
      ? null
      : total +
        pending.reduce((s, l) => s + (l.referenceSubtotalCentavos ?? 0), 0),
    currency: "PHP",
  };
}

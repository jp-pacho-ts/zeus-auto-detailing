import { brandConfig } from "@/config/brand";
import type {
  AdminBookingDetail,
  AdminQueueBooking,
  AdminTotals,
} from "@/types/admin-contracts";
import type { BookingStatus, UserRole } from "@/types/contracts";
export const money = (value: number) =>
  new Intl.NumberFormat(brandConfig.locale, {
    style: "currency",
    currency: brandConfig.currency,
  }).format(value / 100);
export const shopDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: brandConfig.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function centavos(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(n) && n <= 100_000_000 ? n : null;
}
export function totalLabel(
  t: Pick<
    AdminTotals,
    "currentTotalCentavos" | "forQuoteCount" | "currentEstimateCentavos"
  >,
): string {
  return (
    money(t.currentTotalCentavos) +
    (t.forQuoteCount
      ? ` + ${t.forQuoteCount} for quote${t.currentEstimateCentavos === null ? "" : ` (estimate ${money(t.currentEstimateCentavos)})`}`
      : "")
  );
}
export function statusActions(
  b: Pick<
    AdminBookingDetail,
    "status" | "snapshot" | "lines" | "cancellationKind"
  > & { bookingDate?: string },
  role: UserRole,
): BookingStatus[] {
  if (b.status === "CANCELLED") {
    const today = shopDate(),
      last = new Date(Date.parse(today) + 90 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    if (b.bookingDate && (b.bookingDate < today || b.bookingDate > last))
      return [];
    return role === "ADMIN" &&
      b.snapshot === "QUEUE_V3" &&
      b.cancellationKind === "SHOP_DECLINED"
      ? ["PENDING"]
      : [];
  }
  if (b.status === "PENDING")
    return role === "ADMIN" ? ["CONFIRMED", "IN_PROGRESS"] : ["IN_PROGRESS"];
  if (b.status === "CONFIRMED") return ["IN_PROGRESS"];
  if (
    b.status === "IN_PROGRESS" &&
    (b.snapshot === "LEGACY" ||
      (b.lines.some((l) => !l.removed) &&
        b.lines
          .filter((l) => !l.removed)
          .every((l) => l.workStatus === "DONE")))
  )
    return ["COMPLETED"];
  return [];
}
export function reorderPayload(
  all: Pick<AdminQueueBooking, "id" | "revision" | "status">[],
  id: string,
  direction: -1 | 1,
) {
  const open = all.filter((b) => b.status !== "CANCELLED"),
    i = open.findIndex((b) => b.id === id),
    j = i + direction;
  if (i < 0 || j < 0 || j >= open.length) return null;
  [open[i], open[j]] = [open[j], open[i]];
  return {
    bookings: open.map((b) => ({ id: b.id, expectedRevision: b.revision })),
  };
}
export const statusLabel = (status: string) =>
  ({
    PENDING: "Booked",
    CONFIRMED: "Confirmed",
    IN_PROGRESS: "In progress",
    COMPLETED: "Done",
    CANCELLED: "Cancelled",
    WAITING: "Waiting",
    DONE: "Done",
  })[status] ?? status;

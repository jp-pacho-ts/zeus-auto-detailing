import "server-only";
import type { StaffTx } from "@/server/auth/db-admission";
import { dateCarrier } from "./context";

// ADR-005 §9: a queue's cap counts non-CANCELLED day bookings (COMPLETED keeps its unit). The
// effective cap is the per-date override, else the queue default; NULL means not configured,
// so the day is full. Under the shop lock these counts are exact; P1-02's guards are the backstop.
export async function effectiveCap(tx: StaffTx, queueCode: string, day: string): Promise<number | null> {
  const override = await tx.queueCapOverride.findUnique({ where: { queueCode_date: { queueCode, date: dateCarrier(day) } }, select: { dailyCap: true } });
  if (override) return override.dailyCap;
  return (await tx.bookingQueue.findUnique({ where: { code: queueCode }, select: { dailyCap: true } }))?.dailyCap ?? null;
}

export function committed(tx: StaffTx, queueCode: string, day: string, excludeBookingId?: string): Promise<number> {
  return tx.booking.count({ where: { queueCode, bookingDate: dateCarrier(day), snapshotVersion: "QUEUE_V3", status: { not: "CANCELLED" },
    ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) } });
}

export async function closedDay(tx: StaffTx, day: string): Promise<{ reason: string } | null> {
  const block = await tx.blockedDate.findFirst({ where: { date: dateCarrier(day), isFullDay: true }, select: { reason: true }, orderBy: { id: "asc" } });
  return block ? { reason: block.reason } : null;
}

// Committed day bookings today or later per date, for a cap change (P1-02 R34: history never blocks).
export async function futureCommitted(tx: StaffTx, queueCode: string, fromDay: string, onlyDay?: string): Promise<{ date: string; count: number }[]> {
  const rows = await tx.booking.groupBy({ by: ["bookingDate"], _count: { _all: true },
    where: { queueCode, snapshotVersion: "QUEUE_V3", status: { not: "CANCELLED" }, bookingDate: onlyDay ? dateCarrier(onlyDay) : { gte: dateCarrier(fromDay) } } });
  return rows.map((r) => ({ date: r.bookingDate.toISOString().slice(0, 10), count: r._count._all })).filter((r) => r.date >= fromDay);
}

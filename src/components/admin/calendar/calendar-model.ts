import type { AdminCalendarDay } from "@/lib/admin-schedule";
import type { BookingStatus } from "@/types/contracts";

// Calendar dates are Asia/Manila calendar days as YYYY-MM-DD; arithmetic stays in UTC so the
// browser's own time zone never shifts a day.
const at = (day: string) => new Date(day + "T00:00:00.000Z");
export const addDay = (day: string, n: number) => new Date(at(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const monthOf = (day: string) => day.slice(0, 7);
export function shiftMonth(month: string, n: number): string {
  const d = new Date(month + "-01T00:00:00.000Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

export function weekOf(day: string): string[] {
  const sunday = addDay(day, -at(day).getUTCDay());
  return Array.from({ length: 7 }, (_, i) => addDay(sunday, i));
}

// Whole Sunday-first weeks covering the month (4 to 6 weeks, at most 42 days).
export function monthGrid(month: string): string[][] {
  const weeks: string[][] = [];
  for (let start = weekOf(month + "-01")[0]; start <= month + "-31" && monthOf(start) <= month; start = addDay(start, 7)) {
    const week = weekOf(start);
    if (monthOf(week[0]) > month) break;
    weeks.push(week);
  }
  return weeks;
}

const WORK_ORDER: BookingStatus[] = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"];
export function statusParts(day: AdminCalendarDay): { status: BookingStatus; count: number }[] {
  return WORK_ORDER.filter((status) => day.byStatus[status] > 0).map((status) => ({ status, count: day.byStatus[status] }));
}
export const bookingCount = (n: number) => (n === 0 ? "No bookings" : `${n} booking${n === 1 ? "" : "s"}`);

export const nextSortOrder = (bays: readonly { sortOrder: number }[]) =>
  bays.reduce((max, b) => Math.max(max, b.sortOrder), 0) + 1;

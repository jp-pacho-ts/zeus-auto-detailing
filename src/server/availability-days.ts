import "server-only";
import type { Prisma } from "@prisma/client";
import type { PublicDay, PublicDayState } from "@/types/contracts";
import { dateCarrier, manilaToday } from "./availability-core";
export const addDays = (day: string, n: number) => new Date(dateCarrier(day).getTime() + n * 86400000).toISOString().slice(0, 10);
export const dayWindow = (day: string) => ({ startsAt: new Date(day + "T00:00:00+08:00"), endsAt: new Date(Date.parse(day + "T00:00:00+08:00") + 86400000) });
export function validDay(day: string, now: Date): boolean { const today = manilaToday(now); return day >= today && day <= addDays(today, 90); }
// Private capacity inputs terminate here. Only date/state leaves this function.
export async function readDayStates(tx: Prisma.TransactionClient, queueCode: string, from: string, through: string): Promise<PublicDay[]> {
    const [queue, overrides, occupancy, blocks, weekdays, priorConfig, configs] = await Promise.all([
        tx.bookingQueue.findUnique({ where: { code: queueCode }, select: { dailyCap: true, isActive: true } }),
        tx.queueCapOverride.findMany({ where: { queueCode, date: { gte: dateCarrier(from), lte: dateCarrier(through) } }, select: { date: true, dailyCap: true } }),
        tx.booking.groupBy({
            by: ["bookingDate"], where: {
                queueCode, bookingDate: { gte: dateCarrier(from), lte: dateCarrier(through) }, status: { not: "CANCELLED" }
            }, _count: { _all: true }
        }),
        tx.blockedDate.findMany({ where: { date: { gte: dateCarrier(from), lte: dateCarrier(through) }, isFullDay: true }, select: { date: true } }),
        tx.timeSlot.findMany({
            where: { isActive: true }, distinct: ["dayOfWeek"], select: { dayOfWeek: true }
        }),
        tx.scheduleConfig.findFirst({
            where: { effectiveDate: { lte: dateCarrier(from) } }, orderBy: { effectiveDate: "desc" }, select: { effectiveDate: true }
        }),
        tx.scheduleConfig.findMany({ where: { effectiveDate: { gt: dateCarrier(from), lte: dateCarrier(through) } }, select: { effectiveDate: true } }),
    ]);
    const caps = new Map(overrides.map(o => [o.date.toISOString().slice(0, 10), o.dailyCap]));
    const counts = new Map(occupancy.map(o => [o.bookingDate.toISOString().slice(0, 10), o._count._all]));
    const closed = new Set(blocks.map(b => b.date.toISOString().slice(0, 10)));
    const open = new Set(weekdays.map(w => w.dayOfWeek)), effective = [priorConfig, ...configs].filter(c => c !== null).map(c => c.effectiveDate.toISOString().slice(0, 10)).sort()[0];
    const result: PublicDay[] = [];
    for (let day = from; day <= through; day = addDays(day, 1)) {
        const cap = caps.has(day) ? caps.get(day)! : queue?.dailyCap ?? null;
        const state: PublicDayState = !queue?.isActive || !effective || day < effective || closed.has(day) || !open.has(dateCarrier(day).getUTCDay()) ? "CLOSED"
            : cap !== null && cap <= (counts.get(day) ?? 0) ? "FULLY_BOOKED" : "AVAILABLE";
        result.push({ date: day, state });
    }
    return result;
}

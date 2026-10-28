import "server-only";
import { createHash } from "node:crypto";
import type { BookingStatus } from "@/types/contracts";
import {
  CalendarQuerySchema,
  ClosedDateCreateSchema,
  WeekHoursSchema,
  type AdminCalendar,
  type AdminClosedDate,
  type AdminSchedule,
  type AdminWeekdayHours,
} from "@/lib/admin-schedule";
import { AdminIdSchema } from "@/lib/admin-validation";
import { brandConfig } from "@/config/brand";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { lockBookingDates } from "@/server/bookings-locks";
import {
  addDays,
  authorize,
  dateCarrier,
  isoDay,
  manilaDate,
  parse,
  type AdminOptions,
  type StaffActor,
} from "./context";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import { mutate } from "./mutation";

// P1-20 opening hours and closed days (ADMIN, op SCHEDULE) and the booking calendar (READ).
// Customers read the same rows through availability-days.ts: a day is open when a schedule
// start is on or before it, its weekday has an active time slot, and no full-day closed date
// covers it. Writes run in mutate(): the shop advisory lock every booking writer takes comes
// first, so no booking can land on a day while it is being closed. LE 2026-10-28: changes are
// logged (adminEvent) until a SCHEDULE_CHANGED audit action exists; closing a booked day is refused.

interface SlotRow { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }

// time_slots has no revision column: the hash of every row is the version token (order-free).
export function hoursVersion(rows: readonly SlotRow[]): string {
  const lines = rows.map((r) => [r.dayOfWeek, r.startTime, r.endTime, r.isActive].join("|")).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

const STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const OPEN_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS"] as const;
const today = (o: AdminOptions) => manilaDate(o.now?.() ?? new Date());
const plural = (n: number) => `${n} booking${n === 1 ? "" : "s"}`;

function read<T>(options: AdminOptions, work: (tx: StaffTx) => Promise<T>): Promise<T> {
  return withStaffDb("STAFF_READ", work, { access: "read", db: options.db, signal: options.signal });
}

function weekdayHours(rows: readonly SlotRow[]): AdminWeekdayHours[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const own = rows.filter((r) => r.dayOfWeek === dayOfWeek), active = own.filter((r) => r.isActive);
    const shown = active.length ? active : own;
    return {
      dayOfWeek,
      open: active.length > 0,
      openTime: shown.length ? shown.map((r) => r.startTime).sort()[0] : brandConfig.openTime,
      closeTime: shown.length ? shown.map((r) => r.endTime).sort().at(-1)! : brandConfig.closeTime,
    };
  });
}

async function loadSchedule(tx: StaffTx, options: AdminOptions): Promise<AdminSchedule> {
  const [slots, start, closed] = await Promise.all([
    tx.timeSlot.findMany({ select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true } }),
    tx.scheduleConfig.findFirst({ orderBy: { effectiveDate: "asc" }, select: { effectiveDate: true } }),
    tx.blockedDate.findMany({
      where: { isFullDay: true, date: { gte: dateCarrier(today(options)) } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: 400,
      select: { id: true, date: true, reason: true },
    }),
  ]);
  return {
    version: hoursVersion(slots),
    startsOn: start ? isoDay(start.effectiveDate) : null,
    days: weekdayHours(slots),
    closedDates: closed.map((c) => ({ id: c.id, date: isoDay(c.date), reason: c.reason })),
  };
}

export async function getSchedule(actor: StaffActor, options: AdminOptions = {}): Promise<AdminSchedule> {
  authorize(actor, "SCHEDULE");
  return read(options, (tx) => loadSchedule(tx, options));
}

// Open (not cancelled, not completed) bookings today or later on the given weekdays or dates.
async function openBookings(tx: StaffTx, from: string, where: { weekdays: number[] } | { date: string }) {
  const rows = await tx.booking.groupBy({
    by: ["bookingDate"],
    _count: { _all: true },
    where: {
      status: { in: [...OPEN_STATUSES] },
      bookingDate: "date" in where ? dateCarrier(where.date) : { gte: dateCarrier(from) },
    },
    orderBy: { bookingDate: "asc" },
  });
  return rows
    .map((r) => ({ date: isoDay(r.bookingDate), count: r._count._all }))
    .filter((r) => r.date >= from && ("date" in where || where.weekdays.includes(dateCarrier(r.date).getUTCDay())));
}

export async function setWeekHours(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminSchedule> {
  authorize(actor, "SCHEDULE");
  const v = parse(WeekHoursSchema, input);
  return mutate(options, "schedule_hours", async (tx) => {
    const day = today(options);
    const slots = await tx.timeSlot.findMany({ orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] });
    if (hoursVersion(slots) !== v.expectedVersion)
      throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed the opening hours. Reload and try again.");
    const current = weekdayHours(slots);
    const closing = v.days.filter((d) => !d.open && current[d.dayOfWeek].open).map((d) => d.dayOfWeek);
    if (closing.length) {
      const booked = await openBookings(tx, day, { weekdays: closing });
      if (booked.length)
        throw new AdminServiceError("SCHEDULE_CONFLICT", "Those days have bookings. Move or decline them before closing the day.", {
          fieldErrors: { days: booked.map((b) => `${b.date}: ${plural(b.count)}`) },
        });
    }
    for (const d of v.days) {
      const own = slots.filter((r) => r.dayOfWeek === d.dayOfWeek);
      // Rows are never deleted (slot overrides may reference them): extra or closed rows go inactive.
      const keep = d.open ? (own.find((r) => r.startTime === d.openTime) ?? own[0]) : undefined;
      const retire = own.filter((r) => r.isActive && r.id !== keep?.id).map((r) => r.id);
      if (retire.length) await tx.timeSlot.updateMany({ where: { id: { in: retire } }, data: { isActive: false } });
      if (!d.open) continue;
      if (!keep)
        await tx.timeSlot.create({ data: { dayOfWeek: d.dayOfWeek, startTime: d.openTime, endTime: d.closeTime, isActive: true } });
      else if (keep.startTime !== d.openTime || keep.endTime !== d.closeTime || !keep.isActive)
        await tx.timeSlot.update({ where: { id: keep.id }, data: { startTime: d.openTime, endTime: d.closeTime, isActive: true } });
    }
    if (v.days.some((d) => d.open) && !(await tx.scheduleConfig.findFirst({ select: { id: true } })))
      await tx.scheduleConfig.create({
        data: { effectiveDate: dateCarrier(day), openTime: brandConfig.openTime, closeTime: brandConfig.closeTime },
      });
    const result = await loadSchedule(tx, options);
    adminEvent("admin.schedule.hours_changed", {
      actorStaffId: actor.staffId,
      openWeekdays: result.days.filter((d) => d.open).map((d) => d.dayOfWeek).join(","),
    });
    return result;
  });
}

export async function addClosedDate(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminClosedDate> {
  authorize(actor, "SCHEDULE");
  const v = parse(ClosedDateCreateSchema, input);
  return mutate(options, "schedule_closed_add", async (tx) => {
    const day = today(options);
    if (v.date < day) throw fieldError("date", "Past days can't be changed.");
    if (v.date > addDays(day, 365)) throw fieldError("date", "Choose a day within the next year.");
    await lockBookingDates(tx, [v.date]);
    if (await tx.blockedDate.findFirst({ where: { date: dateCarrier(v.date), isFullDay: true }, select: { id: true } }))
      throw fieldError("date", "That day is already closed.");
    const [booked] = await openBookings(tx, day, { date: v.date });
    if (booked)
      throw fieldError("date", `${booked.date}: ${plural(booked.count)}. Move or decline ${booked.count === 1 ? "it" : "them"} first.`, "SCHEDULE_CONFLICT");
    const row = await tx.blockedDate.create({ data: { date: dateCarrier(v.date), reason: v.reason ?? "Closed", isFullDay: true } });
    adminEvent("admin.schedule.closed_date_added", { actorStaffId: actor.staffId, date: v.date });
    return { id: row.id, date: v.date, reason: row.reason };
  });
}

export async function removeClosedDate(actor: StaffActor, closedDateId: unknown, options: AdminOptions = {}): Promise<{ deleted: true }> {
  authorize(actor, "SCHEDULE");
  const id = parse(AdminIdSchema, closedDateId);
  return mutate(options, "schedule_closed_remove", async (tx) => {
    const row = await tx.blockedDate.findUnique({ where: { id } });
    if (!row || !row.isFullDay) throw new AdminServiceError("NOT_FOUND");
    const date = isoDay(row.date);
    if (date < today(options)) throw fieldError("date", "Past days can't be changed.");
    await tx.blockedDate.delete({ where: { id } });
    adminEvent("admin.schedule.closed_date_removed", { actorStaffId: actor.staffId, date });
    return { deleted: true };
  });
}

// Counts only (no customer fields). A day is closed by the same rules customers see.
export async function getCalendar(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminCalendar> {
  authorize(actor, "READ");
  const { from, to } = parse(CalendarQuerySchema, input);
  return read(options, async (tx) => {
    const range = { gte: dateCarrier(from), lte: dateCarrier(to) };
    const [counts, blocks, weekdays, start] = await Promise.all([
      tx.booking.groupBy({ by: ["bookingDate", "status"], _count: { _all: true }, where: { bookingDate: range } }),
      tx.blockedDate.findMany({ where: { date: range, isFullDay: true }, select: { date: true } }),
      tx.timeSlot.findMany({ where: { isActive: true }, distinct: ["dayOfWeek"], select: { dayOfWeek: true } }),
      tx.scheduleConfig.findFirst({ orderBy: { effectiveDate: "asc" }, select: { effectiveDate: true } }),
    ]);
    const closed = new Set(blocks.map((b) => isoDay(b.date))), open = new Set(weekdays.map((w) => w.dayOfWeek));
    const startsOn = start ? isoDay(start.effectiveDate) : null;
    const days: AdminCalendar["days"] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const byStatus = Object.fromEntries(STATUSES.map((st) => [st, 0])) as Record<BookingStatus, number>;
      for (const c of counts) if (isoDay(c.bookingDate) === day) byStatus[c.status as BookingStatus] += c._count._all;
      days.push({
        date: day,
        closed: !startsOn || day < startsOn || closed.has(day) || !open.has(dateCarrier(day).getUTCDay()),
        total: STATUSES.filter((st) => st !== "CANCELLED").reduce((n, st) => n + byStatus[st], 0),
        byStatus,
      });
    }
    return { from, to, days };
  });
}

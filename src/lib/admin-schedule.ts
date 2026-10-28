// P1-20 admin calendar, opening hours and closed days: Zod schemas (strict) and the response
// shapes. Kept apart from the shared contracts (src/lib/validation.ts, src/types/**).
import { z } from "zod";
import type { BookingStatus, LocalDate, UUID } from "@/types/contracts";
import { LocalDateSchema } from "./validation";

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const dayNumber = (day: string) => Date.parse(day + "T00:00:00.000Z") / 86_400_000;
export const CALENDAR_MAX_DAYS = 42;

export const WeekdayHoursSchema = z
  .object({ dayOfWeek: z.number().int().min(0).max(6), open: z.boolean(), openTime: Time, closeTime: Time })
  .strict()
  .refine((d) => !d.open || d.openTime < d.closeTime, { message: "Closing time must be after opening time", path: ["closeTime"] });
export const WeekHoursSchema = z
  .object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), days: z.array(WeekdayHoursSchema).length(7) })
  .strict()
  .refine((v) => new Set(v.days.map((d) => d.dayOfWeek)).size === 7, { message: "List each weekday once", path: ["days"] });

export const ClosedDateCreateSchema = z
  .object({
    date: LocalDateSchema,
    reason: z.string().trim().max(200).optional().transform((s) => s || undefined),
  })
  .strict();

export const CalendarQuerySchema = z
  .object({ from: LocalDateSchema, to: LocalDateSchema })
  .strict()
  .refine((v) => v.from <= v.to && dayNumber(v.to) - dayNumber(v.from) < CALENDAR_MAX_DAYS, {
    message: `Choose at most ${CALENDAR_MAX_DAYS} days`,
    path: ["to"],
  });

export interface AdminWeekdayHours { dayOfWeek: number; open: boolean; openTime: string; closeTime: string }
// The reason is staff-only: customers only ever see the day as closed.
export interface AdminClosedDate { id: UUID; date: LocalDate; reason: string }
export interface AdminSchedule {
  version: string; // send back as expectedVersion
  startsOn: LocalDate | null; // first day bookings can open; null = no schedule yet (every day closed)
  days: AdminWeekdayHours[]; // Sunday (0) to Saturday (6)
  closedDates: AdminClosedDate[]; // today and later, oldest first
}
export interface AdminCalendarDay {
  date: LocalDate;
  closed: boolean;
  total: number; // every status except CANCELLED
  byStatus: Record<BookingStatus, number>;
}
export interface AdminCalendar { from: LocalDate; to: LocalDate; days: AdminCalendarDay[] }

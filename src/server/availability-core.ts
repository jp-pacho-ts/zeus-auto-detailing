import type { AvailableSlotData, BookingStatus, GetAvailableSlotsRequest, SlotState } from "@/types/contracts";
import { DomainError } from "./errors";

export const SHOP_TIMEZONE = "Asia/Manila" as const;
export const SHOP_CURRENCY = "PHP" as const;
export const manilaToday = (now = new Date()) => new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
export const dateCarrier = (date: string) => new Date(date + "T00:00:00.000Z");
export const appointmentInstant = (date: string, time: string) => new Date(date + "T" + time + ":00+08:00");
export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const toTime = (minutes: number) => String(Math.floor(minutes / 60) % 24).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

export interface AvailabilityInput {
  request: GetAvailableSlotsRequest;
  now: Date;
  config: { openTime: string; closeTime: string; defaultSlotIntervalMinutes: number };
  durationMinutes: number;
  totalPriceCentavos: number;
  templates: { id: string; dayOfWeek: number; startTime: string; endTime: string; maxVehicleCapacity: number; isActive: boolean }[];
  overrides: { timeSlotId: string; maxVehicleCapacity: number }[];
  blocks: { isFullDay: boolean; startTime: string | null; endTime: string | null; reason: string }[];
  bookings: { startsAt: Date; endsAt: Date; status: BookingStatus }[];
}
export function assertBookingHorizon(date: string, now: Date): void {
  const today = manilaToday(now);
  const horizon = new Date(dateCarrier(today).getTime() + 90 * 86400000).toISOString().slice(0, 10);
  if (date < today || date > horizon) throw new DomainError("VALIDATION_ERROR", "Choose a date from today through the next 90 days.", { bookingDate: ["Date is outside the 90-day booking horizon."] });
}
export function calculateAvailability(input: AvailabilityInput): AvailableSlotData {
  const { request, now, config, durationMinutes, totalPriceCentavos, blocks } = input;
  assertBookingHorizon(request.date, now);
  const result: AvailableSlotData = { ...request, timezone: SHOP_TIMEZONE, durationMinutes, totalPriceCentavos, currency: SHOP_CURRENCY, dayState: "OPEN", reason: null, slots: [], generatedAt: now.toISOString() };
  const holiday = blocks.find(b => b.isFullDay);
  if (holiday) return { ...result, dayState: "HOLIDAY", reason: holiday.reason || "Closed for holiday." };
  const weekday = dateCarrier(request.date).getUTCDay();
  const templates = input.templates.filter(t => t.dayOfWeek === weekday && t.isActive).sort((a, b) => a.startTime.localeCompare(b.startTime));
  if (!templates.length) return { ...result, dayState: "CLOSED", reason: "The shop is closed on this date." };
  const invalidSchedule = () => new DomainError("SCHEDULE_CONFLICT", "The shop schedule needs review. Please choose another date.");
  if (!validTime(config.openTime) || !validTime(config.closeTime) || !Number.isInteger(config.defaultSlotIntervalMinutes) || config.defaultSlotIntervalMinutes <= 0 || toMinutes(config.openTime) >= toMinutes(config.closeTime) || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 540) throw invalidSchedule();
  let cursor = toMinutes(config.openTime);
  const overrides = new Map(input.overrides.map(o => [o.timeSlotId, o.maxVehicleCapacity]));
  const intervals = templates.map(t => {
    const start = toMinutes(t.startTime), end = toMinutes(t.endTime);
    const capacity = overrides.get(t.id) ?? t.maxVehicleCapacity;
    if (!validTime(t.startTime) || !validTime(t.endTime) || start !== cursor || end - start !== config.defaultSlotIntervalMinutes || end > toMinutes(config.closeTime) || !Number.isInteger(capacity) || capacity < 0 || capacity > 20) throw invalidSchedule();
    cursor = end;
    const startsAt = appointmentInstant(request.date, t.startTime).getTime();
    const endsAt = appointmentInstant(request.date, t.endTime).getTime();
    const occupied = input.bookings.filter(b => b.status !== "CANCELLED" && b.startsAt.getTime() < endsAt && b.endsAt.getTime() > startsAt).length;
    if (occupied > capacity) throw new DomainError("SCHEDULE_CONFLICT", "The shop schedule has a capacity conflict. Please choose another date.");
    return { ...t, start, end, capacity, remaining: capacity - occupied };
  });
  if (cursor !== toMinutes(config.closeTime)) throw invalidSchedule();
  for (const block of blocks) if (!block.isFullDay && (!block.startTime || !block.endTime || !validTime(block.startTime) || !validTime(block.endTime) || block.startTime >= block.endTime)) throw invalidSchedule();
  result.slots = intervals.map(interval => {
    const start = interval.start, end = start + durationMinutes;
    const covered = intervals.filter(i => i.start < end && i.end > start);
    const capacity = Math.min(...covered.map(i => i.capacity));
    const remaining = Math.min(...covered.map(i => i.remaining));
    const block = blocks.find(b => !b.isFullDay && start < toMinutes(b.endTime!) && end > toMinutes(b.startTime!));
    let state: SlotState = remaining === 0 ? "SOLD_OUT" : remaining === 1 ? "LIMITED" : "AVAILABLE";
    let reason: string | null = remaining === 0 ? "Sold out for the full service duration." : null;
    if (appointmentInstant(request.date, interval.startTime).getTime() <= now.getTime()) { state = "PAST"; reason = "This arrival time has passed."; }
    else if (end > toMinutes(config.closeTime) || end > 1440) { state = "OUTSIDE_HOURS"; reason = "This service cannot finish before closing."; }
    else if (block) { state = "BLOCKED"; reason = block.reason || "The shop is closed during this service."; }
    const selectable = state === "AVAILABLE" || state === "LIMITED";
    return { slotId: interval.id, date: request.date, startTime: interval.startTime, endTime: toTime(end), durationMinutes, maxVehicleCapacity: capacity, remainingCapacity: selectable ? remaining : 0, state, selectable, reason };
  });
  return result;
}

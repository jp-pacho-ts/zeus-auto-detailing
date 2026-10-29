"use client";
import type { UserRole } from "@/types/contracts";
import { BookingCalendar } from "./calendar/booking-calendar";

// Date-based customer bookings (ADR-005). Bay operations and setup live in BayWorkspace.
export function CalendarTab({ role }: { role: UserRole }) {
  return <BookingCalendar role={role} />;
}

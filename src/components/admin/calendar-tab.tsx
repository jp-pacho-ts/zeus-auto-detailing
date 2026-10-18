"use client";
import type { UserRole } from "@/types/contracts";
import { BookingsTab } from "./bookings-tab";
// Queue days replace the historical slot/bay calendar fixtures (ADR-005).
export function CalendarTab({ role }: { role: UserRole }) {
  return <BookingsTab role={role} showCaps />;
}

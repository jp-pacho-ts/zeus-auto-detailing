"use client";
import * as React from "react";
import type { UserRole } from "@/types/contracts";
import type { AdminBay } from "@/types/admin-contracts";
import { Button } from "@/components/ui/button";
import { BookingsTab } from "./bookings-tab";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
import { BookingCalendar } from "./calendar/booking-calendar";
import { BayManager } from "./calendar/bay-manager";
import { HoursManager } from "./calendar/hours-manager";

// Queue days replace the historical slot/bay calendar fixtures (ADR-005). P1-20 adds the booking
// calendar and, for ADMIN, the bay list and opening hours; the day list stays the first view
// (its Optional limits panel is hidden, item 6). The server repeats every role check.
type Section = "DAY_LIST" | "CALENDAR" | "BAYS" | "HOURS";
const SECTIONS: { id: Section; label: string; adminOnly: boolean }[] = [
  { id: "DAY_LIST", label: "Day list", adminOnly: false },
  { id: "CALENDAR", label: "Booking calendar", adminOnly: false },
  { id: "BAYS", label: "Bays", adminOnly: true },
  { id: "HOURS", label: "Opening hours", adminOnly: true },
];

export function CalendarTab({ role }: { role: UserRole }) {
  const bays = useAdminResource<AdminBay[]>("/api/admin/bays");
  const [section, setSection] = React.useState<Section>("DAY_LIST");
  const shown = SECTIONS.filter((s) => role === "ADMIN" || !s.adminOnly);
  return (
    <div className="space-y-6">
      <section
        className="rounded border border-border bg-[#18181b] p-4 sm:p-6"
        aria-label="Operating bays"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm font-bold">
            {bays.data
              ? `${bays.data.filter((bay) => bay.isActive).length} Bays Operating`
              : "Bay count unavailable"}
          </p>
          <Button
            variant="outline"
            disabled={bays.loading}
            onClick={() => void bays.reload()}
          >
            Refresh bays
          </Button>
        </div>
        <LoadState
          loading={bays.loading}
          error={bays.error}
          retry={bays.reload}
        />
      </section>
      <div role="group" aria-label="Calendar sections" className="flex flex-wrap gap-2">
        {shown.map((s) => (
          <Button key={s.id} variant={section === s.id ? "default" : "outline"} aria-pressed={section === s.id} onClick={() => setSection(s.id)}>
            {s.label}
          </Button>
        ))}
      </div>
      {section === "DAY_LIST" && <BookingsTab role={role} listView />}
      {section === "CALENDAR" && <BookingCalendar role={role} />}
      {section === "BAYS" && role === "ADMIN" && <BayManager onChanged={bays.reload} />}
      {section === "HOURS" && role === "ADMIN" && <HoursManager />}
    </div>
  );
}

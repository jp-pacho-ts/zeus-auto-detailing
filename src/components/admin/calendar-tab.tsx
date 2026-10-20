"use client";
import type { UserRole } from "@/types/contracts";
import type { AdminBay } from "@/types/admin-contracts";
import { Button } from "@/components/ui/button";
import { BookingsTab } from "./bookings-tab";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
// Queue days replace the historical slot/bay calendar fixtures (ADR-005).
export function CalendarTab({ role }: { role: UserRole }) {
  const bays = useAdminResource<AdminBay[]>("/api/admin/bays");
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
      <BookingsTab role={role} showCaps />
    </div>
  );
}

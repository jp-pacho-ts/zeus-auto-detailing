"use client";
import * as React from "react";
import type { UserRole } from "@/types/contracts";
import type { AdminBay } from "@/types/admin-contracts";
import { Button } from "@/components/ui/button";
import { BayBoard } from "./bookings/bay-board";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
import { BayManager } from "./calendar/bay-manager";
import { HoursManager } from "./calendar/hours-manager";

type Section = "BOARD" | "BAYS" | "HOURS";
const SECTIONS: { id: Section; label: string; adminOnly: boolean }[] = [
  { id: "BOARD", label: "Kanban", adminOnly: false },
  { id: "BAYS", label: "Bays", adminOnly: true },
  { id: "HOURS", label: "Opening hours", adminOnly: true },
];

export function BayWorkspace({ role }: { role: UserRole }) {
  const bays = useAdminResource<AdminBay[]>("/api/admin/bays");
  const [section, setSection] = React.useState<Section>("BOARD");
  const switched = React.useRef(false);
  React.useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    document.getElementById("bay-section-" + section)?.focus();
  }, [section]);
  const sectionSwitch = (
    <div role="group" aria-label="Bay board sections" className="flex flex-wrap gap-2">
      {SECTIONS.filter(s => role === "ADMIN" || !s.adminOnly).map(s => (
        <Button key={s.id} id={"bay-section-" + s.id}
          variant={section === s.id ? "default" : "outline"} aria-pressed={section === s.id}
          onClick={() => { switched.current = true; setSection(s.id); }}>{s.label}</Button>
      ))}
    </div>
  );
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-muted-foreground">Assign cars to bays and follow their progress from Waiting to Done.</p>
      <section className="rounded border border-border bg-[#18181b] p-4" aria-label="Operating bays">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm font-bold">
            {bays.data ? `${bays.data.filter((bay) => bay.isActive).length} Bays Operating` : "Bay count unavailable"}
          </p>
          <Button variant="outline" disabled={bays.loading} onClick={() => void bays.reload()}>Refresh bays</Button>
        </div>
        <LoadState loading={bays.loading} error={bays.error} retry={bays.reload} />
      </section>
      {section === "BOARD" ? <BayBoard role={role} viewSwitch={sectionSwitch} /> : sectionSwitch}
      {section === "BAYS" && role === "ADMIN" && <BayManager onChanged={bays.reload} />}
      {section === "HOURS" && role === "ADMIN" && <HoursManager />}
    </div>
  );
}

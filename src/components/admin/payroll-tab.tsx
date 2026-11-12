"use client";

import * as React from "react";
import type { UserRole } from "@/types/contracts";
import type { AdminTeam } from "@/types/admin-contracts";
import { LoadState } from "./bookings/use-admin-resource";
import { CommissionsPanel } from "./team/commissions-panel";
import { PayrollPanel } from "./team/payroll-panel";
import { useKeptResource } from "./team/use-kept-resource";

type View = "PAYROLL" | "COMMISSIONS";

export function PayrollTab({ role }: { role: UserRole }) {
  const isAdmin = role === "ADMIN";
  const team = useKeptResource<AdminTeam>(isAdmin ? "/api/admin/team" : null);
  const [view, setView] = React.useState<View>("PAYROLL");

  if (!isAdmin)
    return (
      <div className="rounded border border-border bg-panel p-6 text-sm text-muted-foreground">
        Only an admin can see payroll and commissions. Ask the shop owner if you need something changed.
      </div>
    );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Payroll and commissions" className="flex flex-wrap gap-2">
        {([["PAYROLL", "Weekly Payroll"], ["COMMISSIONS", "Job Commissions"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`min-h-[44px] flex-1 rounded border px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none ${view === id ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <LoadState loading={team.loading} error={team.error} retry={team.reload} />
      {team.data && (
        view === "PAYROLL" ? (
          <PayrollPanel team={team.data} reloadTeam={team.reload} />
        ) : (
          <CommissionsPanel team={team.data} reloadTeam={team.reload} />
        )
      )}
    </div>
  );
}

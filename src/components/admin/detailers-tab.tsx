"use client";

import * as React from "react";
import type { UserRole } from "@/types/contracts";
import type { AdminTeam } from "@/types/admin-contracts";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
import { CommissionsPanel } from "./team/commissions-panel";
import { TeamPanel } from "./team/team-panel";

type View = "TEAM" | "COMMISSIONS";

// Money and phone numbers are for admins only; the server refuses everyone else, and this screen says so plainly first.
export function DetailersTab({ role }: { role: UserRole }) {
  const isAdmin = role === "ADMIN";
  const team = useAdminResource<AdminTeam>(isAdmin ? "/api/admin/team" : null);
  const [view, setView] = React.useState<View>("TEAM");

  if (!isAdmin)
    return (
      <div className="rounded border border-border bg-[#121214] p-6 text-sm text-muted-foreground">
        Only an admin can see the team and commissions. Ask the shop owner if you need something changed.
      </div>
    );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Team and commissions" className="flex gap-2">
        {([["TEAM", "Team"], ["COMMISSIONS", "Commissions"]] as const).map(([id, label]) => (
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
      {team.data && (view === "TEAM"
        ? <TeamPanel team={team.data} reload={team.reload} />
        : <CommissionsPanel team={team.data} reloadTeam={team.reload} />)}
    </div>
  );
}

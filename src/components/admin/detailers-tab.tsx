"use client";

import * as React from "react";
import type { UserRole } from "@/types/contracts";
import type { AdminTeam } from "@/types/admin-contracts";
import { LoadState } from "./bookings/use-admin-resource";
import { TeamPanel } from "./team/team-panel";
import { useKeptResource } from "./team/use-kept-resource";

// Staff details and phone numbers are for admins only; the server refuses everyone else.
export function DetailersTab({ role }: { role: UserRole }) {
  const isAdmin = role === "ADMIN";
  const team = useKeptResource<AdminTeam>(isAdmin ? "/api/admin/team" : null);

  if (!isAdmin)
    return (
      <div className="rounded border border-border bg-panel p-6 text-sm text-muted-foreground">
        Only an admin can see the staff roster. Ask the shop owner if you need something changed.
      </div>
    );

  return (
    <div className="space-y-4">
      <LoadState loading={team.loading} error={team.error} retry={team.reload} />
      {team.data && <TeamPanel team={team.data} reload={team.reload} />}
    </div>
  );
}

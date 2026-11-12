"use client";

import * as React from "react";
import type { UserRole } from "@/types/contracts";
import type { AdminSupplyList } from "@/types/admin-contracts";
import { LoadState } from "./bookings/use-admin-resource";
import { SuppliesPanel } from "./supplies/supplies-panel";
import { useKeptResource } from "./team/use-kept-resource";

// Costs are money: for admins only. The server refuses everyone else, and this screen says so plainly first.
export function InventoryTab({ role }: { role: UserRole }) {
  const isAdmin = role === "ADMIN";
  const [showArchived, setShowArchived] = React.useState(false);
  const list = useKeptResource<AdminSupplyList>(isAdmin ? `/api/admin/supplies?includeArchived=${showArchived}` : null);

  if (!isAdmin)
    return (
      <div className="rounded border border-border bg-panel p-6 text-sm text-muted-foreground">
        Only an admin can see supplies and their costs. Ask the shop owner if you need something changed.
      </div>
    );

  return (
    <div className="space-y-4">
      <LoadState loading={list.loading} error={list.error} retry={list.reload} />
      {list.data && <SuppliesPanel list={list.data} showArchived={showArchived} setShowArchived={setShowArchived} reload={list.reload} />}
    </div>
  );
}

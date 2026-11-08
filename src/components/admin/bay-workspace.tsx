"use client";
import * as React from "react";
import type { UserRole } from "@/types/contracts";
import { BayBoard } from "./bookings/bay-board";

export function BayWorkspace({ role }: { role: UserRole }) {
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-muted-foreground">Assign cars to bays and follow their progress from Waiting to Done.</p>
      <BayBoard role={role} />
    </div>
  );
}

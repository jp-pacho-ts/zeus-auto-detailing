"use client";
import * as React from "react";
import type { UserRole } from "@/types/contracts";
import { BayBoard } from "./bookings/bay-board";

export function BayWorkspace({ role }: { role: UserRole }) {
  return (
    <div className="min-w-0 space-y-3">
      <BayBoard role={role} />
    </div>
  );
}

import "server-only";
import type { UserRole } from "@/types/contracts";

// Amendment 4 (LE 2026-10-20): only ADMIN assigns bays and workers.
// ADR-005 §15 (WA), Amendment 1 A3 and PM decisions D4/D5 on top of the ADR-003 role mapping
// (DETAILER = STAFF; ADMIN and MANAGER = ADMIN). Checked inside every service.
export const ADMIN_OPS = [
  "READ",
  "LINE_STATUS",
  "BAY_ASSIGN",
  "STATUS_IN_PROGRESS",
  "STATUS_COMPLETED",
  "NOTIFY",
  "STATUS_CONFIRMED",
  "STATUS_REINSTATE",
  "DECLINE",
  "MOVE",
  "REORDER",
  "LINE_ADD",
  "LINE_REMOVE",
  "LINE_PRICE",
  "WORKER_ASSIGN",
  "BAY_LIST",
  "CAPS",
  "HISTORY_LOOKUP",
  "DEPOSIT_STATUS", // P1-18: ADMIN only; STAFF reads proofs through READ
  "SCHEDULE", // P1-20: opening hours and closed days, ADMIN only
  "DELETE_BOOKING", // P1-29: ADMIN only; the database function repeats the check
] as const;
export type AdminOp = (typeof ADMIN_OPS)[number];

const STAFF_OPS: ReadonlySet<AdminOp> = new Set([
  "READ",
  "LINE_STATUS",
  "STATUS_IN_PROGRESS",
  "STATUS_COMPLETED",
  "NOTIFY",
]);

export function canPerform(op: AdminOp, role: UserRole): boolean {
  return role === "ADMIN" || (role === "STAFF" && STAFF_OPS.has(op));
}

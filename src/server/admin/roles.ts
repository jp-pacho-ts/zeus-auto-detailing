import "server-only";
import type { UserRole } from "@/types/contracts";

// ADR-005 §15 (WA), Amendment 1 A3 and PM decisions D4/D5 on top of the ADR-003 role mapping
// (DETAILER = STAFF; ADMIN and MANAGER = ADMIN). Checked inside every service.
export const ADMIN_OPS = [
  "READ", "LINE_STATUS", "BAY_ASSIGN", "STATUS_IN_PROGRESS", "STATUS_COMPLETED", "NOTIFY",
  "STATUS_CONFIRMED", "STATUS_REINSTATE", "DECLINE", "MOVE", "REORDER", "LINE_ADD", "LINE_REMOVE", "LINE_PRICE",
  "BAY_LIST", "CAPS", "HISTORY_LOOKUP",
] as const;
export type AdminOp = (typeof ADMIN_OPS)[number];

const STAFF_OPS: ReadonlySet<AdminOp> = new Set(["READ", "LINE_STATUS", "BAY_ASSIGN", "STATUS_IN_PROGRESS", "STATUS_COMPLETED", "NOTIFY"]);

export function canPerform(op: AdminOp, role: UserRole): boolean {
  return role === "ADMIN" || (role === "STAFF" && STAFF_OPS.has(op));
}

import type { AdminBoardCard, AdminDayBoard } from "@/types/admin-contracts";
import { canPlace } from "./container-model";
type AdminBoardBay = AdminDayBoard["bays"][number];
import type { UserRole } from "@/types/contracts";
export const boardProgress = (
  lines: { workStatus: string; removed?: boolean }[],
) => {
  const active = lines.filter((l) => !l.removed);
  return {
    done: active.filter((l) => l.workStatus === "DONE").length,
    total: active.length,
  };
};
export const plateLabel = (plate: string | null) => plate?.trim() || "No plate";
// P1-62: any car goes in any empty active bay (the kind of bay no longer matters). Only ADMIN moves cars.
export function canDrop(
  role: UserRole,
  card: Pick<AdminBoardCard, "id" | "assignedBayId">,
  bay: Pick<AdminBoardBay, "id" | "isActive"> & { cards: unknown[] },
) {
  return role === "ADMIN" && canPlace(bay) && card.assignedBayId !== bay.id;
}
export const bayPayload = (
  card: { revision: number },
  date: string,
  bayId: string | null,
) => ({ expectedRevision: card.revision, date, bayId });
export function writeFeedback(error: {
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}) {
  return {
    message: [
      ...new Set(
        [
          error.message,
          ...Object.values(error.fieldErrors ?? {}).flat(),
        ].filter(Boolean),
      ),
    ].join(" "),
    review: error.code === "VERSION_CONFLICT",
  };
}

// P1-30: a click that lands on (or inside) one of these keeps that control's own behaviour and does
// not open the card's details. The same list decides whether a press may start a card drag.
export const CONTROL_SELECTOR = "button, select, input, textarea, a, label, [role='menu'], [role='menuitem']";
export const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(CONTROL_SELECTOR) !== null;

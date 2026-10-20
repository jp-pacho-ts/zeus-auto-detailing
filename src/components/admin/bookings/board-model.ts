import type {
  AdminBoardCard,
  AdminDayBoard,
  BayType,
} from "@/types/admin-contracts";
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
export function canDrop(
  role: UserRole,
  card: Pick<AdminBoardCard, "id" | "assignedBayId">,
  bay: Pick<AdminDayBoard["bays"][number], "id" | "bayType" | "isActive"> & {
    cards: { id: string }[];
  },
  allowed: BayType | undefined,
) {
  return (
    role === "ADMIN" &&
    bay.isActive &&
    bay.bayType === allowed &&
    bay.cards.length === 0 &&
    card.assignedBayId !== bay.id
  );
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

import type {
  AdminBoardCard,
  AdminDayBoard,
  AdminDayQueues,
  AdminQueueBooking,
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
// P1-20 item 2 (LE 2026-10-28): one board row per bay type. A row holds the Waiting queue(s)
// served by that bay type, its bays, and Done: the day's COMPLETED visits of those queues, read
// from the day queue view (the board itself carries open cars only).
export const BOARD_LANES: { bayType: BayType; label: string }[] = [
  { bayType: "WASH", label: "Wash" },
  { bayType: "DETAILING", label: "Detailing" },
  { bayType: "PAINT", label: "Paint" },
];
export function boardLanes(board: AdminDayBoard, day: AdminDayQueues | null) {
  return BOARD_LANES.map(({ bayType, label }) => {
    const waiting = board.queues.filter((q) => q.bayType === bayType);
    const codes = new Set(waiting.map((q) => q.code));
    const bays = board.bays.filter((b) => b.bayType === bayType);
    const done: AdminQueueBooking[] = (day?.queues ?? [])
      .filter((q) => codes.has(q.code))
      .flatMap((q) => (q.bookings ?? []).filter((b) => b.status === "COMPLETED"));
    return {
      bayType,
      label,
      waiting,
      bays,
      done,
      counts: {
        waiting: waiting.reduce((n, q) => n + q.waiting.length, 0),
        inBay: bays.reduce((n, b) => n + b.cards.length, 0),
        done: done.length,
      },
    };
  });
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

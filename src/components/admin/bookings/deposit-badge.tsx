import type { DepositStatus } from "@/types/contracts";

// P1-18: the same pill vocabulary as the booking list status (bookings-tab.tsx). A proof that
// still needs a decision is amber; a decision is green or red. NONE shows nothing on the board.
const LABELS: Record<DepositStatus, string> = {
  NONE: "No deposit proof",
  PROOF_SENT: "Deposit proof to check",
  RECEIVED: "Deposit received",
  REJECTED: "Deposit rejected",
};
const TONES: Record<DepositStatus, string> = {
  NONE: "border-border text-muted-foreground",
  PROOF_SENT: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  RECEIVED: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  REJECTED: "border-rose-500/30 bg-rose-500/15 text-rose-400",
};

export const depositLabel = (status: DepositStatus) => LABELS[status];

export function DepositBadge({ status, showNone = false }: { status: DepositStatus; showNone?: boolean }) {
  if (status === "NONE" && !showNone) return null;
  return (
    <span className={`inline-block rounded border px-2.5 py-0.5 text-xs font-bold ${TONES[status]}`}>
      {LABELS[status]}
    </span>
  );
}

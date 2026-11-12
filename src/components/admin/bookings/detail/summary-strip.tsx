import type { AdminBookingDetail } from "@/types/admin-contracts";
import { money } from "../model";
import { boardProgress } from "../board-model";
import { depositLabel } from "../deposit-badge";

const depositTone = {
  NONE: "text-muted-foreground",
  PROOF_SENT: "text-amber-700 dark:text-amber-400",
  RECEIVED: "text-emerald-700 dark:text-emerald-400",
  REJECTED: "text-rose-700 dark:text-rose-400",
} as const;

// Where the booking stands, readable without scrolling. Read-only.
export function SummaryStrip({ b }: { b: AdminBookingDetail }) {
  const progress = boardProgress(b.lines);
  const cell = "min-w-0 bg-panel px-4 py-3 sm:px-6";
  return (
    <dl className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
      <div className={cell}>
        <dt className="text-xs text-muted-foreground">Total now</dt>
        <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
          {money(b.totals.currentTotalCentavos)}
          {b.totals.forQuoteCount > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">+ {b.totals.forQuoteCount} for quote</span>}
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-xs text-muted-foreground">Deposit</dt>
        <dd className={`mt-0.5 text-sm font-semibold ${depositTone[b.depositStatus]}`}>{depositLabel(b.depositStatus)}</dd>
      </div>
      <div className={cell}>
        <dt className="text-xs text-muted-foreground">Services</dt>
        <dd className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          {progress.total ? (
            <>
              <span className="tabular-nums">
                {progress.done} of {progress.total} done
              </span>
              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-raised" aria-hidden="true">
                <span className="block h-full bg-emerald-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </span>
            </>
          ) : (
            <span className="font-normal text-muted-foreground">No service list</span>
          )}
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-xs text-muted-foreground">Crew</dt>
        <dd className="mt-0.5 truncate text-sm font-semibold text-foreground">
          {b.assignedWorkers.length ? b.assignedWorkers.map((w) => w.name).join(", ") : <span className="font-normal text-muted-foreground">No one yet</span>}
        </dd>
      </div>
    </dl>
  );
}

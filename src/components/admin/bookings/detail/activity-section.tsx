import * as React from "react";
import type { AdminBookingDetail } from "@/types/admin-contracts";
import { panel, sectionTitle, sentAt } from "./shared";

// History codes such as STATUS_CHANGED read as "Status changed".
const actionLabel = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ");
const FIRST = 5;

// The booking's history (newest first, at most 50 from the server), as a timeline.
export function ActivitySection({ history }: { history: AdminBookingDetail["history"] }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? history : history.slice(0, FIRST);
  return (
    <section aria-label="History" className={`${panel} p-4 sm:p-5`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className={sectionTitle}>Activity</h3>
        <span className="text-xs text-muted-foreground">
          {history.length} {history.length === 1 ? "change" : "changes"}
        </span>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <ol className="space-y-3 border-l border-border pl-4">
          {shown.map((h, i) => (
            <li key={h.id} className="relative text-sm">
              <span
                aria-hidden="true"
                className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-panel ${i === 0 ? "bg-amber-500" : "bg-zinc-500"}`}
              />
              <p className="font-medium text-foreground">{actionLabel(h.action)}</p>
              <p className="text-xs text-muted-foreground">
                {[h.actorName ?? (h.source === "CUSTOMER" ? "Customer" : null), sentAt(h.createdAt)].filter(Boolean).join(" · ")}
              </p>
              {h.reason && <p className="mt-0.5 break-words text-xs text-foreground/80">{h.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      {history.length > FIRST && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="mt-3 min-h-[36px] text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
        >
          {all ? "Show fewer" : `Show all ${history.length}`}
        </button>
      )}
    </section>
  );
}

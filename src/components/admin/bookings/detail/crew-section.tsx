import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBookingDetail, AdminDayBoard } from "@/types/admin-contracts";
import { money } from "../model";
import { fieldClass, LoadState } from "../use-admin-resource";
import { label, panel, sectionTitle, submit, type Write } from "./shared";

type Row = { staffId: string; name: string; amountCentavos: number };
export type Recalc = { before: Row[]; after: Row[] };

export function CrewSection({
  b,
  admin,
  canAssignStaff,
  disabled,
  write,
  workers,
  recalc,
  onRecalculate,
}: {
  b: AdminBookingDetail;
  admin: boolean;
  canAssignStaff: boolean;
  disabled: boolean;
  write: Write;
  workers: { data: AdminDayBoard | null; loading: boolean; error: string | null; reload: () => unknown };
  recalc: Recalc | null;
  onRecalculate: () => void;
}) {
  return (
    <section aria-label="Assigned staff" className={`${panel} space-y-3 p-4 sm:p-5`}>
      <h3 className={sectionTitle}>Crew</h3>
      {b.assignedWorkers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one assigned yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {b.assignedWorkers.map((w) => (
            <li key={w.staffId} className="flex items-center gap-1 rounded-full border border-border bg-raised py-1 pl-3 pr-1 text-sm text-foreground">
              <span>
                {w.name}
                {w.isActive ? "" : " (inactive)"}
              </span>
              {canAssignStaff ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void write("/workers/" + w.staffId, {}, "DELETE")}
                  aria-label={`Remove ${w.name}`}
                  title={`Remove ${w.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-rose-500/10 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 dark:hover:text-rose-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="pr-2" />
              )}
            </li>
          ))}
        </ul>
      )}
      {canAssignStaff && (
        <>
          <LoadState loading={workers.loading} error={workers.error} retry={workers.reload} />
          <form className="flex items-end gap-2" onSubmit={(e) => submit(e, (f) => void write("/workers/" + String(f.get("worker")), {}, "PUT"))}>
            <label className={`${label} min-w-0 flex-1`}>
              Add a worker
              <select name="worker" className={fieldClass} required disabled={disabled} defaultValue="">
                <option value="" disabled>
                  Choose an active worker
                </option>
                {workers.data?.workers
                  .filter((w) => !b.assignedWorkers.some((a) => a.staffId === w.staffId))
                  .map((w) => (
                    <option key={w.staffId} value={w.staffId}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button variant="outline" disabled={disabled}>
              Assign
            </Button>
          </form>
        </>
      )}
      {admin && b.status === "COMPLETED" && b.snapshot === "QUEUE_V3" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">Changed a service or worker rate? Work this booking&apos;s commission out again.</p>
          <Button variant="outline" size="sm" disabled={disabled} onClick={onRecalculate}>
            Recalculate commission
          </Button>
          {recalc && (
            <table className="w-full text-sm tabular-nums" aria-label="Commission before and after">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">Worker</th>
                  <th className="py-1 text-right font-medium">Before</th>
                  <th className="py-1 text-right font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set([...recalc.before, ...recalc.after].map((r) => r.staffId))].map((staffId) => {
                  const was = recalc.before.find((r) => r.staffId === staffId),
                    now = recalc.after.find((r) => r.staffId === staffId);
                  return (
                    <tr key={staffId} className="border-t border-border">
                      <td className="py-1.5 text-foreground">{(now ?? was)!.name}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{was ? money(was.amountCentavos) : "—"}</td>
                      <td className="py-1.5 text-right font-semibold text-foreground">{now ? money(now.amountCentavos) : "—"}</td>
                    </tr>
                  );
                })}
                {recalc.after.length === 0 && recalc.before.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-1.5 text-muted-foreground">
                      No commission on this booking: no worker assigned or no service earns one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

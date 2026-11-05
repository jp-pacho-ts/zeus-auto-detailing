"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { basisPointsToPercent, formatPesos } from "@/lib/commission";
import type { AdminCommissionPaidResult, AdminCommissionSummary, AdminTeam } from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { fieldClass, LoadState } from "../bookings/use-admin-resource";
import { useKeptResource } from "./use-kept-resource";
import { describeError } from "./team-panel";
import { defaultRateLine, manilaToday, monthStart, rangeProblem, selectableIds, warningLines } from "./team-model";

const buttonClass = "inline-flex min-h-[44px] items-center justify-center rounded border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

export function CommissionsPanel({ team, reloadTeam }: { team: AdminTeam; reloadTeam: () => unknown }) {
  const today = React.useMemo(() => manilaToday(), []);
  const [from, setFrom] = React.useState(monthStart(today));
  const [to, setTo] = React.useState(today);
  const [status, setStatus] = React.useState<"ALL" | "UNPAID" | "PAID">("ALL");
  const [staffId, setStaffId] = React.useState("");
  const problem = rangeProblem(from, to);
  const url = problem ? null : `/api/admin/commissions?from=${from}&to=${to}&status=${status}${staffId ? `&staffId=${staffId}` : ""}`;
  const summary = useKeptResource<AdminCommissionSummary>(url);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editingRate, setEditingRate] = React.useState(false);
  const [rate, setRate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const writing = React.useRef(false);

  // Bulk actions use `chosen` below: only rows that are on screen AND ticked, so a changed filter can't leak old ticks in.

  async function run(work: () => Promise<string>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      // The message appears with the fresh totals, never above stale ones.
      await Promise.all([summary.reload(), reloadTeam()]);
      setNotice(message);
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function saveRate(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      await adminRequest("/api/admin/commissions/settings", { method: "PUT", body: { expectedRevision: team.settingsRevision, ratePercent: rate.trim() } });
      return "The default rate was changed. It applies to bookings completed from now on; earlier commissions are not changed.";
    });
    if (ok) setEditingRate(false);
  }

  const setPaid = (paid: boolean) =>
    run(async () => {
      const ids = selectableIds(data?.entries.filter((en) => selected.has(en.id)) ?? [], paid);
      const result = await adminRequest<AdminCommissionPaidResult>("/api/admin/commissions/paid", { method: "POST", body: { ids, paid } });
      setSelected(new Set());
      return result.changed === 0 ? "Nothing changed. Those commissions were already marked that way." : `${result.changed} ${result.changed === 1 ? "commission" : "commissions"} marked as ${paid ? "paid" : "unpaid"}.`;
    });

  const repair = () =>
    run(async () => {
      const result = await adminRequest<{ repaired: number }>("/api/admin/commissions/repair", { method: "POST", body: {} });
      return result.repaired === 0 ? "No missing commissions were found." : `${result.repaired} missing ${result.repaired === 1 ? "commission was" : "commissions were"} recorded.`;
    });

  const data = summary.data;
  const chosen = data?.entries.filter((en) => selected.has(en.id)) ?? [];
  const canMarkPaid = selectableIds(chosen, true).length > 0;
  const canMarkUnpaid = selectableIds(chosen, false).length > 0;

  return (
    <section aria-labelledby="commissions-heading" className="rounded border border-border bg-[#121214]">
      <div className="border-b border-border p-4 sm:p-6">
        <h2 id="commissions-heading" className="text-base font-bold text-foreground">Commissions</h2>
        <p data-testid="default-rate-line" className="mt-1 text-sm text-muted-foreground">{defaultRateLine(team.defaultRateBp)}</p>
        {!editingRate ? (
          <button type="button" className={`${buttonClass} mt-2`} disabled={busy} onClick={() => { setRate(basisPointsToPercent(team.defaultRateBp)); setError(null); setEditingRate(true); }}>Change default rate</button>
        ) : (
          <form onSubmit={(e) => void saveRate(e)} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block text-xs font-semibold text-muted-foreground">Default commission percent
              <input className={fieldClass} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" required autoComplete="off" />
            </label>
            <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy}>{busy ? "Saving..." : "Save default"}</Button>
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setEditingRate(false)}>Cancel</Button>
          </form>
        )}
      </div>

      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-4 sm:p-6">
        <label className="block text-xs font-semibold text-muted-foreground">From
          <input className={fieldClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">To
          <input className={fieldClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Person
          <select className={fieldClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Everyone</option>
            {team.people.filter((p) => p.role === "DETAILER").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Show
          <select className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ALL">All commissions</option>
            <option value="UNPAID">Unpaid only</option>
            <option value="PAID">Paid only</option>
          </select>
        </label>
        {problem && <p role="alert" className="text-sm text-rose-400 sm:col-span-4">{problem}</p>}
      </div>

      {notice && <p role="status" className="border-b border-border px-4 py-3 text-sm text-emerald-400 sm:px-6">{notice}</p>}
      {error && <p role="alert" className="border-b border-border px-4 py-3 text-sm text-rose-400 sm:px-6">{error}</p>}
      <LoadState loading={summary.loading} error={summary.error} retry={summary.reload} />

      {data && (
        <>
          {warningLines(data.warnings).map((line) => (
            <p key={line} role="status" className="border-b border-border bg-amber-500/10 px-4 py-3 text-sm text-amber-300 sm:px-6">{line}</p>
          ))}
          {data.warnings.missingRecords > 0 && (
            <div className="border-b border-border px-4 py-3 sm:px-6">
              <button type="button" className={buttonClass} disabled={busy} onClick={() => void repair()}>Record missing commissions</button>
            </div>
          )}

          <dl className="grid grid-cols-3 gap-px border-b border-border bg-border text-center">
            {([["Earned", data.grandTotal.earnedCentavos], ["Paid", data.grandTotal.paidCentavos], ["Unpaid", data.grandTotal.unpaidCentavos]] as const).map(([label, value]) => (
              <div key={label} className="bg-[#121214] p-3 sm:p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm font-bold tabular-nums text-foreground sm:text-base">{formatPesos(value)}</dd>
              </div>
            ))}
          </dl>

          {data.totals.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No commissions in this range. They appear here when a booking is completed with a detailer assigned.</p>
          ) : (
            <>
              <h3 className="px-4 pt-4 text-sm font-bold text-foreground sm:px-6">By person</h3>
              <ul className="divide-y divide-border">
                {data.totals.map((t) => (
                  <li key={t.staffId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
                    <span className="min-w-0 break-words text-sm font-semibold text-foreground">{t.staffName}<span className="ml-2 text-xs font-normal text-muted-foreground">{t.entryCount} {t.entryCount === 1 ? "job" : "jobs"}</span></span>
                    <span className="text-xs tabular-nums text-muted-foreground">Earned {formatPesos(t.earnedCentavos)} · Unpaid {formatPesos(t.unpaidCentavos)}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2 border-y border-border px-4 py-3 sm:px-6">
                <h3 className="mr-auto text-sm font-bold text-foreground">Jobs</h3>
                <span className="text-xs text-muted-foreground" aria-live="polite">{chosen.length} selected</span>
                <button type="button" className={buttonClass} disabled={busy || !canMarkPaid} onClick={() => void setPaid(true)}>Mark paid</button>
                <button type="button" className={buttonClass} disabled={busy || !canMarkUnpaid} onClick={() => void setPaid(false)}>Mark unpaid</button>
              </div>
              <ul className="divide-y divide-border">
                {data.entries.map((en) => (
                  <li key={en.id}>
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 px-4 py-3 sm:px-6">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5 shrink-0"
                        checked={selected.has(en.id)}
                        onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(en.id); else next.delete(en.id); return next; })}
                        aria-label={`Select ${en.staffName}, ${en.serviceName}, ${en.completedOn}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="break-words text-sm font-semibold text-foreground">{en.staffName}</span>
                          <span className="text-sm font-bold tabular-nums text-foreground">{formatPesos(en.amountCentavos)}</span>
                        </span>
                        <span className="block break-words text-xs text-muted-foreground">{en.serviceName} · {en.completedOn} · {en.bookingReference}</span>
                        <span className="block text-xs text-muted-foreground">
                          {basisPointsToPercent(en.rateBp)}% of {formatPesos(en.shareCentavos)}
                          {en.creditedCount > 1 ? ` (shared by ${en.creditedCount} of ${formatPesos(en.serviceTotalCentavos)})` : ""}
                          {" · "}{en.paidAt ? "Paid" : "Unpaid"}
                        </span>
                        {en.unpricedLineCount > 0 && <span className="block text-xs text-amber-300">Includes a service without a final price.</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {data.truncated && <p className="px-4 py-3 text-xs text-muted-foreground sm:px-6">Showing the most recent {data.entries.length} jobs. The totals above include every job in the range.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}

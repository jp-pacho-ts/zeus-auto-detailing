"use client";

import * as React from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Plus,
  Minus,
  Banknote,
  FileText,
  Printer,
  X,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPesos } from "@/lib/commission";
import type {
  AdminPayrollStaffItem,
  AdminWeeklyPayroll,
  AdminTeam,
} from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { LoadState } from "../bookings/use-admin-resource";
import { useKeptResource } from "./use-kept-resource";
import { describeError } from "./team-panel";
import {
  formatWeekLabel,
  getMondayOfWeek,
  getNextMonday,
  getPreviousMonday,
  getSundayOfWeek,
  manilaToday,
} from "./payroll-model";

const CARD = "rounded-xl border border-border/80 bg-[#121214] p-5 shadow-xs";
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PayrollPanel({
  team,
  reloadTeam,
}: {
  team?: AdminTeam;
  reloadTeam?: () => unknown;
} = {}) {
  const today = React.useMemo(() => manilaToday(), []);
  const currentMonday = React.useMemo(() => getMondayOfWeek(today), [today]);
  const [weekStart, setWeekStart] = React.useState<string>(currentMonday);

  const url = `/api/admin/payroll?weekStart=${weekStart}`;
  const payrollResource = useKeptResource<AdminWeeklyPayroll>(url);
  const data = payrollResource.data;

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Cash Advance Modal state
  const [advanceModalStaff, setAdvanceModalStaff] =
    React.useState<AdminPayrollStaffItem | null>(null);
  const [advancePesos, setAdvancePesos] = React.useState<string>("1000");
  const [advanceNotes, setAdvanceNotes] = React.useState<string>("");

  // Pay Slip Modal state
  const [slipModalStaff, setSlipModalStaff] =
    React.useState<AdminPayrollStaffItem | null>(null);

  const weekEnd = React.useMemo(() => getSundayOfWeek(weekStart), [weekStart]);

  async function handleAdjustAbsence(
    staffId: string,
    currentAbsences: number,
    delta: number,
  ) {
    const nextAbsences = Math.max(0, Math.min(6, currentAbsences + delta));
    if (nextAbsences === currentAbsences) return;

    setBusy(true);
    setError(null);
    try {
      const item = data?.items.find((it) => it.staffId === staffId);
      await adminRequest("/api/admin/payroll", {
        method: "POST",
        body: {
          staffId,
          weekStart,
          daysAbsent: nextAbsences,
          cashAdvanceCentavos: item?.cashAdvanceCentavos ?? 0,
          advanceNotes: item?.advanceNotes ?? null,
        },
      });
      await payrollResource.reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function openAdvanceModal(item: AdminPayrollStaffItem) {
    setAdvanceModalStaff(item);
    const pesos = item.cashAdvanceCentavos
      ? String(item.cashAdvanceCentavos / 100)
      : "1000";
    setAdvancePesos(pesos);
    setAdvanceNotes(item.advanceNotes ?? "");
  }

  async function handleSaveAdvance(e: React.FormEvent) {
    e.preventDefault();
    if (!advanceModalStaff) return;

    const numPesos = parseFloat(advancePesos);
    if (isNaN(numPesos) || numPesos < 0) {
      setError("Enter a valid peso amount for cash advance (0 or higher).");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await adminRequest("/api/admin/payroll", {
        method: "POST",
        body: {
          staffId: advanceModalStaff.staffId,
          weekStart,
          daysAbsent: advanceModalStaff.daysAbsent,
          cashAdvanceCentavos: Math.round(numPesos * 100),
          advanceNotes: advanceNotes.trim() || null,
        },
      });
      setAdvanceModalStaff(null);
      setNotice(
        `Updated cash advance for ${advanceModalStaff.staffName} to ₱${numPesos.toLocaleString("en-PH")}.`,
      );
      await payrollResource.reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePaid(staffId: string, isPaid: boolean) {
    setBusy(true);
    setError(null);
    try {
      await adminRequest("/api/admin/payroll/paid", {
        method: "POST",
        body: {
          staffId,
          weekStart,
          isPaid,
        },
      });
      await Promise.all([payrollResource.reload(), reloadTeam?.()]);
      setNotice(
        isPaid
          ? "Payroll & week commissions marked as paid."
          : "Payroll marked as unpaid.",
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Week Navigation Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-[#121214] p-1">
          <button
            type="button"
            onClick={() => setWeekStart(getPreviousMonday(weekStart))}
            className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded text-muted-foreground hover:bg-zinc-800 hover:text-foreground ${FOCUS}`}
            title="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 px-3 py-1 text-xs font-semibold text-foreground sm:text-sm">
            <Calendar className="h-4 w-4 text-primary" />
            <span>{formatWeekLabel(weekStart, weekEnd)}</span>
          </div>
          <button
            type="button"
            onClick={() => setWeekStart(getNextMonday(weekStart))}
            className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded text-muted-foreground hover:bg-zinc-800 hover:text-foreground ${FOCUS}`}
            title="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(currentMonday)}
            className={`min-h-[38px] rounded-lg border border-border/80 px-3 text-xs font-semibold ${FOCUS} ${
              weekStart === currentMonday
                ? "bg-primary/15 text-primary border-primary/50"
                : "bg-[#121214] text-muted-foreground hover:text-foreground"
            }`}
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(getPreviousMonday(currentMonday))}
            className={`min-h-[38px] rounded-lg border border-border/80 px-3 text-xs font-semibold ${FOCUS} ${
              weekStart === getPreviousMonday(currentMonday)
                ? "bg-primary/15 text-primary border-primary/50"
                : "bg-[#121214] text-muted-foreground hover:text-foreground"
            }`}
          >
            Last week
          </button>
          <span className="hidden rounded-full border border-border/70 bg-[#141416] px-3 py-1 text-[11px] font-medium text-muted-foreground sm:inline-block">
            Cycle closes Sunday night
          </span>
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-300">
          <p>{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-400 hover:text-emerald-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-300">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-400 hover:text-rose-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <LoadState
        loading={payrollResource.loading && data === null}
        error={payrollResource.error}
        retry={payrollResource.reload}
      />

      {data && (
        <div className="space-y-6">
          {/* Executive Summary Card */}
          <section className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Weekly Payroll &amp; Payout Summary
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Base allowance (₱200/day · 6-day week) + earned commissions −
                  cash advances (bale)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {team
                    ? `${team.people.filter((p) => p.isActive).length} active team members`
                    : `${data.totals.totalStaff} staff members`}
                </span>
                <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                  {data.totals.paidCount} Paid
                </span>
                {data.totals.unpaidCount > 0 && (
                  <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-400">
                    {data.totals.unpaidCount} Unpaid
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border/70 bg-[#161618] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Base Salaries
                </p>
                <p className="mt-1 font-mono text-xl font-bold text-foreground">
                  {formatPesos(data.totals.totalBaseSalaryCentavos)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Standard ₱200/day per attendance
                </p>
              </div>

              <div className="rounded-lg border border-border/70 bg-[#161618] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Commissions
                </p>
                <p className="mt-1 font-mono text-xl font-bold text-amber-400">
                  +{formatPesos(data.totals.totalCommissionsCentavos)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Earned across completed jobs
                </p>
              </div>

              <div className="rounded-lg border border-border/70 bg-[#161618] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Cash Advances Deducted
                </p>
                <p className="mt-1 font-mono text-xl font-bold text-rose-400">
                  −{formatPesos(data.totals.totalCashAdvanceCentavos)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mid-week cash advance / bale
                </p>
              </div>

              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                  Net Payout to Disburse
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-emerald-400">
                  {formatPesos(data.totals.totalNetPayoutCentavos)}
                </p>
                <p className="mt-1 text-xs text-emerald-300/80">
                  Handed over Sunday night
                </p>
              </div>
            </div>
          </section>

          {/* Staff Payroll Cards */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Staff Payouts ({formatWeekLabel(weekStart, weekEnd)})
            </h3>

            {data.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-[#121214] p-8 text-center text-sm text-muted-foreground">
                No active staff members found on the team.
              </div>
            ) : (
              data.items.map((item) => {
                return (
                  <div
                    key={item.staffId}
                    className="rounded-xl border border-border/80 bg-[#121214] p-4 transition-all hover:border-border sm:p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      {/* Staff Identity */}
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/80 bg-zinc-800 text-sm font-bold text-foreground">
                          {getInitials(item.staffName)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <b className="text-base font-bold text-foreground">
                              {item.staffName}
                            </b>
                            {item.isPaid ? (
                              <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Paid</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                                <Clock className="h-3 w-3" />
                                <span>Unpaid</span>
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.position ?? "Technician"} · {item.phone}
                          </p>
                        </div>
                      </div>

                      {/* Financial Metrics Strip */}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex lg:items-center lg:gap-6">
                        {/* Attendance & Base Pay */}
                        <div className="rounded-lg border border-border/60 bg-[#161618] p-3 text-left">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            Base ({item.daysWorked}/6 days)
                          </p>
                          <p className="mt-0.5 font-mono text-base font-bold text-foreground">
                            {formatPesos(item.baseSalaryCentavos)}
                          </p>
                          <div className="mt-2 flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busy || item.daysAbsent >= 6}
                              onClick={() =>
                                handleAdjustAbsence(item.staffId, item.daysAbsent, 1)
                              }
                              className={`flex h-6 items-center gap-0.5 rounded border border-border/80 bg-zinc-800 px-1.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-40 ${FOCUS}`}
                              title="Mark 1 day absent (−₱200)"
                            >
                              <Minus className="h-2.5 w-2.5" />
                              <span>Absent</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy || item.daysAbsent <= 0}
                              onClick={() =>
                                handleAdjustAbsence(item.staffId, item.daysAbsent, -1)
                              }
                              className={`flex h-6 items-center gap-0.5 rounded border border-border/80 bg-zinc-800 px-1.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 ${FOCUS}`}
                              title="Mark present (+₱200)"
                            >
                              <Plus className="h-2.5 w-2.5" />
                              <span>Present</span>
                            </button>
                          </div>
                        </div>

                        {/* Commissions */}
                        <div className="rounded-lg border border-border/60 bg-[#161618] p-3 text-left">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            Commissions
                          </p>
                          <p className="mt-0.5 font-mono text-base font-bold text-amber-400">
                            +{formatPesos(item.commissionEarnedCentavos)}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Earned this week
                          </p>
                        </div>

                        {/* Cash Advance */}
                        <div className="rounded-lg border border-border/60 bg-[#161618] p-3 text-left">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            Cash Advance (Bale)
                          </p>
                          <p className="mt-0.5 font-mono text-base font-bold text-rose-400">
                            −{formatPesos(item.cashAdvanceCentavos)}
                          </p>
                          <button
                            type="button"
                            onClick={() => openAdvanceModal(item)}
                            className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                          >
                            <Banknote className="h-3 w-3" />
                            <span>
                              {item.cashAdvanceCentavos > 0
                                ? "Edit bale"
                                : "+ Add bale"}
                            </span>
                          </button>
                        </div>

                        {/* Net Take-Home Payout */}
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-left sm:min-w-[130px]">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                            Net Payout
                          </p>
                          <p className="mt-0.5 font-mono text-xl font-bold tabular-nums text-emerald-400">
                            {formatPesos(item.netPayoutCentavos)}
                          </p>
                          <div className="mt-2 flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleTogglePaid(item.staffId, !item.isPaid)
                              }
                              className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                item.isPaid
                                  ? "bg-zinc-800 text-muted-foreground hover:text-foreground"
                                  : "bg-emerald-500 text-black hover:bg-emerald-400"
                              } ${FOCUS}`}
                            >
                              {item.isPaid ? "Mark Unpaid" : "Mark Paid"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSlipModalStaff(item)}
                              className="rounded p-1 text-muted-foreground hover:bg-zinc-800 hover:text-foreground"
                              title="View Pay Slip"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {item.advanceNotes && (
                      <div className="mt-3 flex items-center gap-1.5 rounded bg-zinc-800/40 px-3 py-1 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                        <span>
                          Advance note: <b>{item.advanceNotes}</b>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Cash Advance (Bale) Dialog */}
      <Dialog
        open={advanceModalStaff !== null}
        onOpenChange={(open) => {
          if (!open) setAdvanceModalStaff(null);
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Cash Advance (Bale)
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Record cash advance for{" "}
            <b className="text-foreground">{advanceModalStaff?.staffName}</b>{" "}
            for the week of {formatWeekLabel(weekStart, weekEnd)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSaveAdvance} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">
                Quick Presets
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAdvancePesos("1000")}
                  className={`rounded border px-3 py-1.5 text-xs font-semibold ${
                    advancePesos === "1000"
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-zinc-800 text-foreground hover:bg-zinc-700"
                  }`}
                >
                  ₱1,000 (Default)
                </button>
                <button
                  type="button"
                  onClick={() => setAdvancePesos("500")}
                  className={`rounded border px-3 py-1.5 text-xs font-semibold ${
                    advancePesos === "500"
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-zinc-800 text-foreground hover:bg-zinc-700"
                  }`}
                >
                  ₱500
                </button>
                <button
                  type="button"
                  onClick={() => setAdvancePesos("1500")}
                  className={`rounded border px-3 py-1.5 text-xs font-semibold ${
                    advancePesos === "1500"
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-zinc-800 text-foreground hover:bg-zinc-700"
                  }`}
                >
                  ₱1,500
                </button>
                <button
                  type="button"
                  onClick={() => setAdvancePesos("0")}
                  className={`rounded border px-3 py-1.5 text-xs font-semibold ${
                    advancePesos === "0"
                      ? "border-rose-500 bg-rose-500/20 text-rose-300"
                      : "border-border bg-zinc-800 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Clear (₱0)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground">
                Amount (Pesos)
              </label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  ₱
                </span>
                <input
                  type="number"
                  step="any"
                  value={advancePesos}
                  onChange={(e) => setAdvancePesos(e.target.value)}
                  placeholder="1000"
                  className="w-full rounded-md border border-border bg-[#18181b] py-2 pl-8 pr-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground">
                Note / Reason (Optional)
              </label>
              <input
                type="text"
                value={advanceNotes}
                onChange={(e) => setAdvanceNotes(e.target.value)}
                placeholder="e.g. Mid-week allowance, emergency"
                className="mt-1 w-full rounded-md border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAdvanceModalStaff(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                Save Cash Advance
              </Button>
            </div>
          </form>
      </Dialog>

      {/* Pay Slip Modal */}
      <Dialog
        open={slipModalStaff !== null}
        onOpenChange={(open) => {
          if (!open) setSlipModalStaff(null);
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Weekly Pay Slip
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Zeus Auto Detailing Tacloban · Sunday Night Settlement
          </DialogDescription>
        </DialogHeader>

          {slipModalStaff && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border border-border/80 bg-[#18181b] p-4 text-xs">
                <div className="flex items-center justify-between border-b border-border/70 pb-2">
                  <div>
                    <b className="text-sm text-foreground">
                      {slipModalStaff.staffName}
                    </b>
                    <p className="text-muted-foreground">
                      {slipModalStaff.position ?? "Detailing Technician"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">
                      {formatWeekLabel(weekStart, weekEnd)}
                    </p>
                    <p
                      className={
                        slipModalStaff.isPaid
                          ? "text-emerald-400 font-medium"
                          : "text-amber-400 font-medium"
                      }
                    >
                      {slipModalStaff.isPaid ? "● Paid" : "○ Unpaid"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">
                      Base Salary ({slipModalStaff.daysWorked}/6 days @ ₱200/day):
                    </span>
                    <span className="font-mono font-semibold text-foreground">
                      {formatPesos(slipModalStaff.baseSalaryCentavos)}
                    </span>
                  </div>

                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">
                      Commissions Earned:
                    </span>
                    <span className="font-mono font-semibold text-amber-400">
                      +{formatPesos(slipModalStaff.commissionEarnedCentavos)}
                    </span>
                  </div>

                  <div className="flex justify-between border-t border-border/60 py-1 font-medium">
                    <span className="text-foreground">Gross Earnings:</span>
                    <span className="font-mono font-bold text-foreground">
                      {formatPesos(slipModalStaff.grossPayCentavos)}
                    </span>
                  </div>

                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">
                      Less Cash Advance (Bale):
                    </span>
                    <span className="font-mono font-semibold text-rose-400">
                      −{formatPesos(slipModalStaff.cashAdvanceCentavos)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/80 pt-2 text-sm font-bold">
                    <span className="text-foreground">Net Take-Home Pay:</span>
                    <span className="font-mono text-base font-bold text-emerald-400">
                      {formatPesos(slipModalStaff.netPayoutCentavos)}
                    </span>
                  </div>
                </div>

                <div className="mt-6 border-t border-dashed border-border/80 pt-4 text-[11px] text-muted-foreground">
                  <div className="flex justify-between">
                    <div>
                      <p>Prepared by: Admin</p>
                    </div>
                    <div>
                      <p>Received by: ____________________</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.print()}
                >
                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                  <span>Print Slip</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setSlipModalStaff(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
      </Dialog>
    </div>
  );
}

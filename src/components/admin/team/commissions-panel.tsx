"use client";

import * as React from "react";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  RefreshCw,
  User,
  Percent,
  Pencil,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { basisPointsToPercent, formatPesos, signedPesosToCentavos } from "@/lib/commission";
import type {
  AdminCommissionPaidResult,
  AdminCommissionSummary,
  AdminTeam,
} from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { fieldClass, LoadState } from "../bookings/use-admin-resource";
import { useKeptResource } from "./use-kept-resource";
import { describeError } from "./team-panel";
import {
  COMMISSION_RULE_LINE,
  defaultRateLine,
  lineSummary,
  manilaToday,
  monthStart,
  rangeProblem,
  selectableIds,
  unpaidText,
  warningLines,
} from "./team-model";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CommissionsPanel({
  team,
  reloadTeam,
}: {
  team: AdminTeam;
  reloadTeam: () => unknown;
}) {
  const today = React.useMemo(() => manilaToday(), []);
  const [from, setFrom] = React.useState(monthStart(today));
  const [to, setTo] = React.useState(today);
  const [status, setStatus] = React.useState<"ALL" | "UNPAID" | "PAID">("ALL");
  const [staffId, setStaffId] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const problem = rangeProblem(from, to);

  const url = problem
    ? null
    : `/api/admin/commissions?from=${from}&to=${to}&status=${status}${
        staffId ? `&staffId=${staffId}` : ""
      }`;
  const summary = useKeptResource<AdminCommissionSummary>(url);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [adjusting, setAdjusting] = React.useState<string | null>(null);
  const [adjAmount, setAdjAmount] = React.useState("");
  const [adjMode, setAdjMode] = React.useState<"ADD" | "TAKE">("ADD");
  const [adjId, setAdjId] = React.useState("");
  const [adjReason, setAdjReason] = React.useState("");
  const [adjProblem, setAdjProblem] = React.useState<string | null>(null);
  const [adjMethod, setAdjMethod] = React.useState<"RATE" | "MANUAL">("RATE");
  const [targetRate, setTargetRate] = React.useState("30");
  const [applyToAllOnBooking, setApplyToAllOnBooking] = React.useState(true);

  const [editingRate, setEditingRate] = React.useState(false);
  const [rate, setRate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const writing = React.useRef(false);

  // Pagination state
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  async function run(work: () => Promise<string>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      const message = await work();
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
      await adminRequest("/api/admin/commissions/settings", {
        method: "PUT",
        body: {
          expectedRevision: team.settingsRevision,
          ratePercent: rate.trim(),
        },
      });
      return "The default rate was changed. It applies to bookings completed from now on; earlier commissions are not changed.";
    });
    if (ok) setEditingRate(false);
  }

  const data = summary.data;

  // Ticked rows: jobs and their adjustments
  const allEntries = React.useMemo(() => data?.entries ?? [], [data?.entries]);
  const chosen = allEntries
    .flatMap((en) => [en, ...en.adjustments])
    .filter((x) => selected.has(x.id));

  const tick = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
        const entry = allEntries.find((e) => e.id === id);
        if (entry) {
          entry.adjustments.forEach((a) => next.add(a.id));
        }
      } else {
        next.delete(id);
        const entry = allEntries.find((e) => e.id === id);
        if (entry) {
          entry.adjustments.forEach((a) => next.delete(a.id));
        }
      }
      return next;
    });

  const setPaid = (paid: boolean) =>
    run(async () => {
      const ids = selectableIds(chosen, paid);
      const result = await adminRequest<AdminCommissionPaidResult>(
        "/api/admin/commissions/paid",
        { method: "POST", body: { ids, paid } },
      );
      setSelected(new Set());
      return result.changed === 0
        ? "Nothing changed. Those commissions were already marked that way."
        : `${result.changed} ${
            result.changed === 1 ? "commission" : "commissions"
          } marked as ${paid ? "paid" : "unpaid"}.`;
    });

  const repair = () =>
    run(async () => {
      const result = await adminRequest<{ repaired: number; failed: number }>(
        "/api/admin/commissions/repair",
        { method: "POST", body: {} },
      );
      const done =
        result.repaired === 0
          ? "No missing commissions were found."
          : `${result.repaired} missing ${
              result.repaired === 1 ? "commission was" : "commissions were"
            } recorded.`;
      return result.failed === 0
        ? done
        : `${done} ${result.failed} could not be recorded and need attention.`;
    });

  async function saveAdjustment(e: React.FormEvent) {
    e.preventDefault();
    let amountCentavos: number;
    let finalReason: string;

    if (adjMethod === "RATE") {
      const rateNum = parseFloat(targetRate);
      if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100) {
        setAdjProblem("Enter a valid percentage between 1 and 100.");
        return;
      }
      const targetBp = Math.round(rateNum * 100);
      const currentNet = adjustingCurrentNet;
      const targetCentavos = Math.round(
        ((adjustingEntry?.shareCentavos ?? 0) * targetBp) / 10000,
      );
      amountCentavos = targetCentavos - currentNet;
      if (amountCentavos === 0) {
        setAdjProblem(`The commission is already at ${targetRate}%.`);
        return;
      }
      finalReason = `Rate adjusted from ${basisPointsToPercent(adjustingEntry?.rateBp ?? 2000)}% to ${targetRate}%`;
    } else {
      const typed = signedPesosToCentavos(adjAmount);
      if (typed === null || typed < 0) {
        setAdjProblem(
          "Enter an amount in pesos, like 300 or 150.50, with no minus sign. It can't be zero. Choose Add or Take off.",
        );
        return;
      }
      amountCentavos = adjMode === "TAKE" ? -typed : typed;
      if (!adjReason.trim()) {
        setAdjProblem("Give a reason.");
        return;
      }
      finalReason = adjReason.trim();
    }
    setAdjProblem(null);
    const ok = await run(async () => {
      if (applyToAllOnBooking && peerEntries.length > 1 && adjMethod === "RATE") {
        const rateNum = parseFloat(targetRate);
        const targetBp = Math.round((isNaN(rateNum) ? 30 : rateNum) * 100);
        let count = 0;
        for (const peer of peerEntries) {
          const peerTarget = Math.round((peer.shareCentavos * targetBp) / 10000);
          const peerNet =
            peer.amountCentavos +
            peer.adjustments.reduce((s, a) => s + a.amountCentavos, 0);
          const delta = peerTarget - peerNet;
          if (delta !== 0) {
            await adminRequest("/api/admin/commissions/adjust", {
              method: "POST",
              body: {
                id: crypto.randomUUID(),
                entryId: peer.id,
                amountCentavos: delta,
                reason: `Rate adjusted from ${basisPointsToPercent(peer.rateBp)}% to ${targetRate}%`,
              },
            });
            count++;
          }
        }
        return count > 1
          ? `Adjusted commission for ${count} detailers on ${adjustingEntry?.bookingReference}.`
          : "The adjustment was recorded.";
      } else {
        await adminRequest("/api/admin/commissions/adjust", {
          method: "POST",
          body: {
            id: adjId,
            entryId: adjusting,
            amountCentavos,
            reason: finalReason,
          },
        });
        return "The adjustment was recorded.";
      }
    });
    if (ok) {
      setAdjusting(null);
      setAdjAmount("");
      setAdjReason("");
      setAdjMode("ADD");
    }
  }

  const freshAdjId = () => setAdjId(crypto.randomUUID());
  const canMarkPaid = selectableIds(chosen, true).length > 0;
  const canMarkUnpaid = selectableIds(chosen, false).length > 0;

  // People options for dropdown
  const peopleOptions = React.useMemo(() => {
    const list: { id: string; name: string }[] = team.people
      .filter((p) => p.role === "DETAILER")
      .map((p) => ({ id: p.id, name: p.name }));
    const known = new Set(list.map((p) => p.id));
    if (data?.totals) {
      for (const t of data.totals) {
        if (!known.has(t.staffId)) {
          known.add(t.staffId);
          list.push({ id: t.staffId, name: t.staffName });
        }
      }
    }
    if (data?.entries) {
      for (const en of data.entries) {
        if (!known.has(en.staffId)) {
          known.add(en.staffId);
          list.push({ id: en.staffId, name: en.staffName });
        }
      }
    }
    return list;
  }, [team.people, data]);

  // Client-side text filter
  const filteredEntries = React.useMemo(() => {
    if (!searchQuery.trim()) return allEntries;
    const q = searchQuery.toLowerCase().trim();
    return allEntries.filter(
      (en) =>
        en.staffName.toLowerCase().includes(q) ||
        en.bookingReference.toLowerCase().includes(q) ||
        en.serviceName.toLowerCase().includes(q),
    );
  }, [allEntries, searchQuery]);

  // Pagination slice
  const totalEntries = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedEntries = filteredEntries.slice(
    startIndex,
    startIndex + pageSize,
  );

  // Quick preset dates
  const setRangeMonth = () => {
    setFrom(monthStart(today));
    setTo(today);
    setPage(1);
  };
  const setRangeToday = () => {
    setFrom(today);
    setTo(today);
    setPage(1);
  };
  const setRange30Days = () => {
    const d = new Date(Date.now() + 8 * 3600000);
    d.setDate(d.getDate() - 30);
    setFrom(d.toISOString().slice(0, 10));
    setTo(today);
    setPage(1);
  };

  const adjustingEntry = adjusting
    ? allEntries.find((e) => e.id === adjusting)
    : undefined;

  const peerEntries = adjustingEntry
    ? allEntries.filter(
        (e) => e.bookingReference === adjustingEntry.bookingReference,
      )
    : [];

  const adjustingCurrentNet = adjustingEntry
    ? adjustingEntry.amountCentavos +
      adjustingEntry.adjustments.reduce((sum, a) => sum + a.amountCentavos, 0)
    : 0;

  const calculatedPreview = (() => {
    if (!adjustingEntry || adjMethod !== "RATE") return null;
    const num = parseFloat(targetRate);
    if (isNaN(num) || num <= 0 || num > 100) return null;
    const targetBp = Math.round(num * 100);
    const targetCentavos = Math.round(
      (adjustingEntry.shareCentavos * targetBp) / 10000,
    );
    const deltaCentavos = targetCentavos - adjustingCurrentNet;
    return { targetCentavos, deltaCentavos };
  })();

  const openAdjustment = (
    entry: (typeof allEntries)[number],
    method: "RATE" | "MANUAL" = "RATE",
  ) => {
    setAdjusting(entry.id);
    setAdjProblem(null);
    setError(null);
    freshAdjId();
    setAdjMethod(method);
    setApplyToAllOnBooking(true);

    const currentNet =
      entry.amountCentavos +
      entry.adjustments.reduce((s, a) => s + a.amountCentavos, 0);
    const effectiveBp =
      entry.shareCentavos > 0
        ? Math.round((currentNet / entry.shareCentavos) * 10000)
        : entry.rateBp;
    const currentPct = basisPointsToPercent(effectiveBp);
    const suggested = effectiveBp === 2000 ? "30" : currentPct;
    setTargetRate(suggested);

    if (method === "MANUAL") {
      setAdjMode("ADD");
      setAdjAmount("");
      setAdjReason("");
    } else {
      const targetBp = Math.round(parseFloat(suggested) * 100);
      const targetCentavos = Math.round((entry.shareCentavos * targetBp) / 10000);
      const delta = targetCentavos - currentNet;
      if (delta >= 0) {
        setAdjMode("ADD");
        setAdjAmount(delta === 0 ? "0" : (delta / 100).toFixed(2));
      } else {
        setAdjMode("TAKE");
        setAdjAmount((Math.abs(delta) / 100).toFixed(2));
      }
      setAdjReason(
        delta !== 0
          ? `Rate adjusted from ${currentPct}% to ${suggested}%`
          : `Manual adjustment for ${entry.staffName}`,
      );
    }
  };

  const handleRateChange = (val: string) => {
    setTargetRate(val);
    if (!adjustingEntry) return;
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0 || num > 100) return;
    const targetBp = Math.round(num * 100);
    const targetCentavos = Math.round(
      (adjustingEntry.shareCentavos * targetBp) / 10000,
    );
    const delta = targetCentavos - adjustingCurrentNet;

    if (delta >= 0) {
      setAdjMode("ADD");
      setAdjAmount((delta / 100).toFixed(2));
    } else {
      setAdjMode("TAKE");
      setAdjAmount((Math.abs(delta) / 100).toFixed(2));
    }
    const currentPct = basisPointsToPercent(adjustingEntry.rateBp);
    setAdjReason(`Rate adjusted from ${currentPct}% to ${val}%`);
    freshAdjId();
  };

  return (
    <div className="space-y-5">
      {/* 1. EXECUTIVE KPI METRICS (Clean Dashboard Cards) */}
      {data && (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Earned Commissions
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {formatPesos(data.grandTotal.earnedCentavos)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Total credited this period
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-emerald-500/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Paid Out
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-emerald-400 sm:text-3xl">
              {formatPesos(data.grandTotal.paidCentavos)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Settled commissions
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-amber-500/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {data.grandTotal.unpaidCentavos < 0 ? "Owed Back" : "Unpaid Balance"}
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-amber-400 sm:text-3xl">
              {formatPesos(Math.abs(data.grandTotal.unpaidCentavos))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.grandTotal.unpaidCentavos < 0 ? "Owed back to shop" : "Ready for payout"}
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Credited Jobs
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {data.grandTotal.entryCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Across {data.totals.length} detailers
            </p>
          </div>
        </div>
      )}

      {/* 2. HEADER CARD: Commission Rate Settings & Rules (De-cluttered) */}
      <section
        aria-labelledby="commissions-heading"
        className="overflow-hidden rounded-xl border border-border bg-panel shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 p-4 sm:p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h2
                id="commissions-heading"
                className="text-lg font-bold tracking-tight text-foreground"
              >
                Commissions
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                <Percent className="h-3 w-3" />
                {basisPointsToPercent(team.defaultRateBp)}% Default
              </span>
            </div>
            <p
              data-testid="default-rate-line"
              className="text-xs text-muted-foreground"
            >
              {defaultRateLine(team.defaultRateBp)}
            </p>
            <p
              data-testid="commission-rule-line"
              className="text-xs text-muted-foreground/80"
            >
              {COMMISSION_RULE_LINE}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!editingRate ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setRate(basisPointsToPercent(team.defaultRateBp));
                  setError(null);
                  setEditingRate(true);
                }}
              >
                Change default rate
              </Button>
            ) : (
              <form
                onSubmit={(e) => void saveRate(e)}
                className="flex items-center gap-2 rounded-lg border border-primary/30 bg-card p-1.5"
              >
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  Default commission percent
                  <input
                    className="h-8 w-16 rounded border border-border bg-black/40 px-2 text-center text-xs font-mono font-bold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    inputMode="decimal"
                    required
                    autoComplete="off"
                  />
                  %
                </label>
                <Button
                  type="submit"
                  size="sm"
                  variant="gold"
                  disabled={busy}
                  className="h-8 px-2.5 text-xs font-bold"
                >
                  {busy ? "Saving..." : "Save default"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditingRate(false)}
                  className="h-8 px-2 text-xs"
                >
                  Cancel
                </Button>
              </form>
            )}
          </div>
        </div>

        {/* NOTICES & WARNINGS */}
        {notice && (
          <p
            role="status"
            className="border-b border-border bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-400 sm:px-6"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="border-b border-border bg-rose-500/10 px-4 py-2.5 text-xs font-medium text-rose-400 sm:px-6"
          >
            {error}
          </p>
        )}
        {data && warningLines(data.warnings).length > 0 && (
          <div className="border-b border-border bg-amber-500/5 px-4 py-3 sm:px-6 space-y-1.5">
            {warningLines(data.warnings).map((line) => (
              <div
                key={line}
                role="status"
                className="flex items-start gap-2 text-xs text-amber-300"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>{line}</span>
              </div>
            ))}
            {data.warnings.missingRecords > 0 && (
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void repair()}
                  className="h-7 text-xs"
                >
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  Record missing commissions
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 3. UNIFIED FILTER TOOLBAR */}
        <div className="border-b border-border/80 bg-panel p-4 sm:p-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold text-muted-foreground">
              From
              <input
                className={fieldClass}
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">
              To
              <input
                className={fieldClass}
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">
              Person
              <select
                className={fieldClass}
                value={staffId}
                onChange={(e) => {
                  setStaffId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Everyone</option>
                {peopleOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">
              Show
              <select
                className={fieldClass}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as typeof status);
                  setPage(1);
                }}
              >
                <option value="ALL">All commissions</option>
                <option value="UNPAID">Unpaid only</option>
                <option value="PAID">Paid only</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground mr-1">Quick presets:</span>
              <button
                type="button"
                onClick={setRangeToday}
                className="rounded border border-border/70 bg-card px-2.5 py-1 text-xs text-foreground transition hover:border-primary/50"
              >
                Today
              </button>
              <button
                type="button"
                onClick={setRangeMonth}
                className="rounded border border-border/70 bg-card px-2.5 py-1 text-xs text-foreground transition hover:border-primary/50"
              >
                This Month
              </button>
              <button
                type="button"
                onClick={setRange30Days}
                className="rounded border border-border/70 bg-card px-2.5 py-1 text-xs text-foreground transition hover:border-primary/50"
              >
                Last 30 Days
              </button>
            </div>

            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search reference, service..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {problem && (
            <p role="alert" className="text-xs text-rose-400 font-medium">
              {problem}
            </p>
          )}
        </div>

        <LoadState
          loading={summary.loading}
          error={summary.error}
          retry={summary.reload}
        />

        {data && (
          <>
            {/* 4. DETAIL ROSTER BREAKDOWN ("By person") */}
            <div className="border-b border-border/80 bg-panel p-4 sm:p-5">
              <div className="flex items-center justify-between pb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  By person
                </h3>
                {staffId && (
                  <button
                    type="button"
                    onClick={() => setStaffId("")}
                    className="text-xs text-primary underline hover:text-primary/80"
                  >
                    Clear person filter
                  </button>
                )}
              </div>

              {data.totals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No commissions in this range. They appear here when a booking is completed with a detailer assigned.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {data.totals.map((t) => {
                    const isSelected = staffId === t.staffId;
                    return (
                      <button
                        key={t.staffId}
                        type="button"
                        onClick={() => {
                          setStaffId(isSelected ? "" : t.staffId);
                          setPage(1);
                        }}
                        className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 shadow-xs"
                            : "border-border/70 bg-card hover:border-border hover:bg-raised"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                            {getInitials(t.staffName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-foreground">
                              {t.staffName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t.entryCount} {t.entryCount === 1 ? "job" : "jobs"}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="font-mono text-xs font-bold text-foreground">
                            Earned {formatPesos(t.earnedCentavos)}
                          </p>
                          <p
                            className={`text-xs font-medium ${
                              t.unpaidCentavos > 0
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {unpaidText(t.unpaidCentavos)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 5. JOBS LEDGER TABLE & CONTROLS */}
            <div className="p-4 sm:p-5 space-y-4">
              {/* Table Toolbar / Bulk Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card px-4 py-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-bold text-foreground">
                    Jobs
                  </h3>
                  <span
                    className="rounded-full bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    {chosen.length} selected
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !canMarkPaid}
                    onClick={() => void setPaid(true)}
                    className="h-8 text-xs font-bold"
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                    Mark paid
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !canMarkUnpaid}
                    onClick={() => void setPaid(false)}
                    className="h-8 text-xs font-bold"
                  >
                    <Clock className="mr-1.5 h-3.5 w-3.5 text-amber-400" />
                    Mark unpaid
                  </Button>
                  {selected.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(new Set())}
                      className="h-8 text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {filteredEntries.length === 0 ? (
                <div className="rounded-xl border border-border bg-panel p-8 text-center">
                  <User className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    No commission jobs match your filters.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try adjusting the dates, selecting everyone, or clearing your search.
                  </p>
                </div>
              ) : (
                <>
                  {/* Clean Desktop Table */}
                  <div className="overflow-hidden rounded-xl border border-border bg-panel">
                    <div className="w-full">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-border bg-card text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="w-10 px-4 py-3.5 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-border bg-black/40 text-primary focus:ring-primary"
                                aria-label="Select all on this page"
                                checked={
                                  paginatedEntries.length > 0 &&
                                  paginatedEntries.every((e) =>
                                    selected.has(e.id),
                                  )
                                }
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    for (const item of paginatedEntries) {
                                      if (on) {
                                        next.add(item.id);
                                        item.adjustments.forEach((adj) =>
                                          next.add(adj.id),
                                        );
                                      } else {
                                        next.delete(item.id);
                                        item.adjustments.forEach((adj) =>
                                          next.delete(adj.id),
                                        );
                                      }
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </th>
                            <th className="px-4 py-3.5">Detailer</th>
                            <th className="px-4 py-3.5">Booking & Service</th>
                            <th className="px-4 py-3.5">Rate & Calculation</th>
                            <th className="px-4 py-3.5 text-right">Commission</th>
                            <th className="px-4 py-3.5 text-center">Status</th>
                            <th className="px-4 py-3.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {paginatedEntries.map((en) => {
                            const isTicked = selected.has(en.id);
                            const summaryText = lineSummary(en.lines);
                            const adjTotal = en.adjustments.reduce((sum, a) => sum + a.amountCentavos, 0);
                            const netTotal = en.amountCentavos + adjTotal;
                            const effectiveBp =
                              en.shareCentavos > 0
                                ? Math.round((netTotal / en.shareCentavos) * 10000)
                                : en.rateBp;
                            const rateAdjustments = en.adjustments.filter((a) =>
                              a.reason.startsWith("Rate adjusted"),
                            );
                            const manualAdjustments = en.adjustments.filter(
                              (a) => !a.reason.startsWith("Rate adjusted"),
                            );
                            const hasRateAdj = rateAdjustments.length > 0;
                            const allPaid =
                              en.paidAt !== null &&
                              en.adjustments.every((a) => a.paidAt !== null);

                            return (
                              <React.Fragment key={en.id}>
                                <tr
                                  className={`transition-colors hover:bg-card ${
                                    isTicked ? "bg-primary/5" : ""
                                  }`}
                                >
                                  <td className="px-4 py-3 text-center align-top">
                                    <input
                                      type="checkbox"
                                      className="mt-1 h-4 w-4 rounded border-border bg-black/40 text-primary focus:ring-primary"
                                      checked={isTicked}
                                      onChange={(e) =>
                                        tick(en.id, e.target.checked)
                                      }
                                      aria-label={`Select ${en.staffName}, ${en.serviceName}, ${en.completedOn}`}
                                    />
                                  </td>

                                  <td className="px-4 py-3 align-top">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                                        {getInitials(en.staffName)}
                                      </span>
                                      <span className="font-semibold text-foreground">
                                        {en.staffName}
                                      </span>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3 align-top min-w-[200px]">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                                          {en.bookingReference}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {en.completedOn}
                                        </span>
                                      </div>
                                      <p className="font-medium text-foreground">
                                        {en.lines
                                          .filter((l) => l.counted)
                                          .map((l) => l.name)
                                          .join(", ") || en.serviceName}
                                      </p>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3 align-top min-w-[220px]">
                                    <div className="space-y-1 text-xs text-muted-foreground">
                                      <p className="flex items-center gap-1.5 flex-wrap text-foreground">
                                        <span className="font-semibold text-primary">
                                          {basisPointsToPercent(effectiveBp)}%
                                        </span>{" "}
                                        <span>of {formatPesos(en.shareCentavos)}</span>
                                        <button
                                          type="button"
                                          title="Edit commission rate"
                                          onClick={() => openAdjustment(en, "RATE")}
                                          className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-primary transition"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                        {hasRateAdj && (
                                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">
                                            Rate updated from {basisPointsToPercent(en.rateBp)}%
                                          </span>
                                        )}
                                        {en.creditedCount > 1
                                          ? ` (shared by ${en.creditedCount} of ${formatPesos(
                                              en.serviceTotalCentavos,
                                            )})`
                                          : ""}
                                      </p>
                                      <p className="text-xs">
                                        Commission base{" "}
                                        {formatPesos(en.serviceTotalCentavos)}
                                        {summaryText.counted
                                          ? ` · Counted: ${summaryText.counted}`
                                          : ""}
                                      </p>
                                      {summaryText.notCounted && (
                                        <p className="text-xs text-muted-foreground/75">
                                          Not counted: {summaryText.notCounted}
                                        </p>
                                      )}
                                      {en.unpricedLineCount > 0 && (
                                        <p className="text-xs text-amber-300">
                                          Includes a service without a final price.
                                        </p>
                                      )}
                                    </div>
                                  </td>

                                  <td className="px-4 py-3 text-right align-top">
                                    <div className="space-y-0.5">
                                      <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                                        {formatPesos(netTotal)}
                                      </span>
                                      {adjTotal !== 0 && (
                                        <p className="font-mono text-xs text-muted-foreground tabular-nums">
                                          Base {formatPesos(en.amountCentavos)}{" "}
                                          {adjTotal >= 0 ? "+" : "-"}{" "}
                                          {formatPesos(Math.abs(adjTotal))}
                                        </p>
                                      )}
                                    </div>
                                  </td>

                                  <td className="px-4 py-3 text-center align-top">
                                    <span
                                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                        allPaid
                                          ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                          : "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                                      }`}
                                    >
                                      {allPaid ? "Paid" : "Unpaid"}
                                    </span>
                                  </td>

                                  <td className="px-4 py-3 text-right align-top">
                                    <div className="flex items-center justify-end gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy}
                                        onClick={() => openAdjustment(en, "RATE")}
                                        className="h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
                                      >
                                        <Pencil className="mr-1 h-3 w-3" />
                                        Edit Rate
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy}
                                        aria-label="Add adjustment"
                                        onClick={() => openAdjustment(en, "MANUAL")}
                                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                      >
                                        <Plus className="mr-1 h-3 w-3" />
                                        Add adjustment
                                      </Button>
                                    </div>
                                  </td>
                                </tr>

                                {/* Nested Adjustments (manual adjustments only, rate adjustments are integrated into parent) */}
                                {manualAdjustments.map((adj) => {
                                  const isAdjTicked = selected.has(adj.id);
                                  return (
                                    <tr
                                      key={adj.id}
                                      className={`bg-panel/50 transition-colors hover:bg-card ${
                                        isAdjTicked ? "bg-primary/5" : ""
                                      }`}
                                    >
                                      <td className="px-4 py-2.5 text-center">
                                        <input
                                          type="checkbox"
                                          className="h-3.5 w-3.5 rounded border-border bg-black/40 text-primary focus:ring-primary"
                                          checked={isAdjTicked}
                                          onChange={(e) =>
                                            tick(adj.id, e.target.checked)
                                          }
                                          aria-label={`Select the adjustment of ${formatPesos(
                                            adj.amountCentavos,
                                          )} for ${en.staffName}, ${
                                            en.serviceName
                                          }`}
                                        />
                                      </td>
                                      <td
                                        colSpan={3}
                                        className="py-2.5 pl-6 text-xs text-muted-foreground"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-primary">
                                            Adjustment {formatPesos(adj.amountCentavos)}
                                          </span>
                                          <span>·</span>
                                          <span className="text-foreground">
                                            {adj.reason}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                                        {formatPesos(adj.amountCentavos)}
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        <span
                                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
                                            adj.paidAt
                                              ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                              : "border border-amber-500/20 bg-amber-500/10 text-amber-400"
                                          }`}
                                        >
                                          {adj.paidAt ? "Paid" : "Unpaid"}
                                        </span>
                                      </td>
                                      <td></td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 6. PAGINATION CONTROLS */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 pt-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        Showing{" "}
                        <strong className="text-foreground font-mono">
                          {totalEntries === 0 ? 0 : startIndex + 1}
                        </strong>{" "}
                        to{" "}
                        <strong className="text-foreground font-mono">
                          {Math.min(startIndex + pageSize, totalEntries)}
                        </strong>{" "}
                        of{" "}
                        <strong className="text-foreground font-mono">
                          {totalEntries}
                        </strong>{" "}
                        jobs
                      </span>
                      <span>·</span>
                      <label className="flex items-center gap-1.5">
                        Rows:
                        <select
                          value={pageSize}
                          onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                          }}
                          className="h-7 rounded border border-border bg-card px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        >
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                        </select>
                      </label>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="h-8 px-2.5 text-xs"
                      >
                        <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                        Previous
                      </Button>

                      <div className="flex items-center gap-1 px-1">
                        {Array.from(
                          { length: totalPages },
                          (_, i) => i + 1,
                        )
                          .filter(
                            (p) =>
                              p === 1 ||
                              p === totalPages ||
                              Math.abs(p - currentPage) <= 1,
                          )
                          .map((p, idx, arr) => (
                            <React.Fragment key={p}>
                              {idx > 0 && arr[idx - 1] !== p - 1 && (
                                <span className="px-1 text-xs text-muted-foreground">
                                  ...
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => setPage(p)}
                                className={`h-8 w-8 rounded text-xs font-mono font-bold transition-colors ${
                                  currentPage === p
                                    ? "bg-primary text-primary-foreground"
                                    : "border border-border/70 bg-card text-foreground hover:border-primary/50"
                                }`}
                              >
                                {p}
                              </button>
                            </React.Fragment>
                          ))}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= totalPages}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        className="h-8 px-2.5 text-xs"
                      >
                        Next
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {data.truncated && (
                    <p className="text-center text-xs text-muted-foreground">
                      Showing the most recent {data.entries.length} jobs. The totals above include every job in the range.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>

      {/* 7. ADD / EDIT ADJUSTMENT MODAL */}
      <Dialog
        open={adjusting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdjusting(null);
            setAdjProblem(null);
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
              <Pencil className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Adjust Commission & Rate</DialogTitle>
              <DialogDescription className="text-xs">
                {adjustingEntry
                  ? `${adjustingEntry.bookingReference} · ${adjustingEntry.serviceName} · ${adjustingEntry.staffName}`
                  : "Adjust the commission amount or rate for this job."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {adjustingEntry && (
          <form onSubmit={(e) => void saveAdjustment(e)} className="space-y-4 pt-1">
            {/* Quick Context Card */}
            <div className="rounded-lg border border-border/80 bg-panel p-3 text-xs">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <span className="text-xs text-muted-foreground block">Base Share</span>
                  <span className="font-mono font-bold text-foreground">
                    {formatPesos(adjustingEntry.shareCentavos)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Current Rate</span>
                  <span className="font-mono font-bold text-amber-400">
                    {basisPointsToPercent(adjustingEntry.rateBp)}%
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Current Commission</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {formatPesos(adjustingCurrentNet)}
                  </span>
                </div>
              </div>
            </div>

            {/* Adjustment Method Selector */}
            <div className="flex rounded-lg border border-border bg-panel p-1 text-xs">
              <button
                type="button"
                onClick={() => setAdjMethod("RATE")}
                className={`flex-1 rounded py-1.5 font-semibold transition ${
                  adjMethod === "RATE"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                % Set New Rate
              </button>
              <button
                type="button"
                onClick={() => setAdjMethod("MANUAL")}
                className={`flex-1 rounded py-1.5 font-semibold transition ${
                  adjMethod === "MANUAL"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                ₱ Direct Amount (+ / -)
              </button>
            </div>

            {adjMethod === "RATE" && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-card/60 p-3.5">
                <div>
                  <label className="block text-xs font-semibold text-foreground">
                    Target Commission Percentage (%)
                  </label>
                  <div className="relative mt-1">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="100"
                      value={targetRate}
                      onChange={(e) => handleRateChange(e.target.value)}
                      placeholder="e.g. 30"
                      className="w-full rounded-md border border-border bg-panel px-3 py-2 font-mono text-sm font-bold text-foreground focus:border-primary focus:outline-none pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>

                {/* Quick percentage presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">Presets:</span>
                  {[10, 15, 20, 25, 30, 35, 40, 50].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleRateChange(pct.toString())}
                      className={`rounded border px-2 py-0.5 text-xs font-mono font-semibold transition ${
                        targetRate === pct.toString()
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-border/70 bg-panel text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>

                {/* Real-time calculation preview */}
                {calculatedPreview && (
                  <div className="rounded border border-primary/30 bg-primary/5 p-2.5 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">New Commission ({targetRate}%):</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatPesos(calculatedPreview.targetCentavos)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/40 pt-1">
                      <span className="text-muted-foreground">Adjustment to record:</span>
                      <span
                        className={`font-mono font-bold ${
                          calculatedPreview.deltaCentavos >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {calculatedPreview.deltaCentavos >= 0 ? "+" : "-"}
                        {formatPesos(Math.abs(calculatedPreview.deltaCentavos))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Standard fields that tests and manual adjustments rely on */}
            {adjMethod === "MANUAL" && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-muted-foreground">
                  Change
                  <select
                    className={fieldClass}
                    value={adjMode}
                    onChange={(e) => {
                      setAdjMode(e.target.value as "ADD" | "TAKE");
                      freshAdjId();
                    }}
                  >
                    <option value="ADD">Add to the commission</option>
                    <option value="TAKE">Take off the commission</option>
                  </select>
                </label>

                <label className="block text-xs font-semibold text-muted-foreground">
                  Amount (pesos)
                  <input
                    className={fieldClass}
                    value={adjAmount}
                    onChange={(e) => {
                      setAdjAmount(e.target.value);
                      freshAdjId();
                    }}
                    inputMode="decimal"
                    placeholder="e.g. 200"
                    required
                    autoComplete="off"
                  />
                </label>

                <label className="block text-xs font-semibold text-muted-foreground">
                  Reason
                  <input
                    className={fieldClass}
                    value={adjReason}
                    onChange={(e) => {
                      setAdjReason(e.target.value);
                      freshAdjId();
                    }}
                    placeholder="e.g. Manual adjustment description"
                    maxLength={200}
                    required
                    autoComplete="off"
                  />
                </label>
              </div>
            )}

            {/* Multi-worker option on this booking */}
            {peerEntries.length > 1 && (
              <label className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-card p-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyToAllOnBooking}
                  onChange={(e) => setApplyToAllOnBooking(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
                <div className="text-xs">
                  <span className="font-semibold text-foreground">
                    Apply to all {peerEntries.length} detailers on {adjustingEntry.bookingReference}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Will record this rate adjustment for {peerEntries.map((p) => p.staffName).join(", ")}.
                  </p>
                </div>
              </label>
            )}

            {adjProblem && (
              <p role="alert" className="text-xs text-rose-400 font-medium">
                {adjProblem}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setAdjusting(null);
                  setAdjProblem(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="gold" disabled={busy}>
                {busy
                  ? "Saving..."
                  : adjMethod === "RATE"
                    ? `Update Rate to ${targetRate}%`
                    : "Save adjustment"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

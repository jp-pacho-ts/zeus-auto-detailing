"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPesos } from "@/lib/commission";
import type {
  AdminAnalytics,
  AdminDayBoard,
  AdminDayQueues,
} from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import type { AdminTab } from "./admin-portal";
import { analyticsUrl, manilaToday, periodRange } from "./analytics/analytics-model";
import { money, shopDate, statusLabel, totalLabel } from "./bookings/model";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
import { MetricCard } from "./metric-card";
import { useKeptResource } from "./team/use-kept-resource";

export function DashboardTab({
  role,
  onNavigate,
}: {
  role: UserRole;
  onNavigate: (tab: AdminTab) => void;
}) {
  const [today] = React.useState(shopDate);
  const isAdmin = role === "ADMIN";
  const day = useAdminResource<AdminDayQueues>(`/api/admin/queues?date=${today}`);
  const board = useAdminResource<AdminDayBoard>(`/api/admin/board?date=${today}`);
  const [monthPeriod] = React.useState(() =>
    periodRange("THIS_MONTH", manilaToday(new Date())),
  );
  const analytics = useKeptResource<AdminAnalytics>(
    isAdmin ? analyticsUrl(monthPeriod) : null,
  );

  const allBookings = day.data
    ? [...day.data.queues.flatMap((q) => q.bookings), ...day.data.legacy]
    : [];
  const activeBookings = allBookings.filter((b) => b.status !== "CANCELLED");
  const pendingCount = activeBookings.filter((b) => b.status === "PENDING").length;
  const inProgressCount = activeBookings.filter(
    (b) => b.status === "IN_PROGRESS",
  ).length;
  const todayTotalCentavos = activeBookings.reduce(
    (sum, b) => sum + b.totals.currentTotalCentavos,
    0,
  );

  const allBays = board.data
    ? board.data.containers.flatMap((c) => c.bays)
    : [];
  const occupiedBays = allBays.filter((b) => b.cards.length > 0).length;
  const waitingCount = board.data ? board.data.waiting.length : 0;
  const doneTodayCount = board.data ? board.data.done.length : 0;

  const reloadAll = () => {
    void day.reload();
    void board.reload();
    if (isAdmin) void analytics.reload();
  };

  return (
    <div className="space-y-6">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          title="Today's Bookings"
          value={day.data ? String(activeBookings.length) : "—"}
          meta={`${inProgressCount} in progress · ${doneTodayCount} finished`}
        />
        <MetricCard
          title="Today's Queue Value"
          value={day.data ? money(todayTotalCentavos) : "—"}
        />
        <MetricCard
          title="Bay Floor Occupancy"
          value={
            board.data ? `${occupiedBays} / ${allBays.length}` : "—"
          }
          meta={`${waitingCount} waiting for bay`}
        />
        <MetricCard
          title="Needs Attention"
          value={day.data ? String(pendingCount) : "—"}
          meta={
            pendingCount > 0
              ? `${pendingCount} awaiting confirmation`
              : "All confirmed"
          }
        />
      </div>

      <LoadState
        loading={false}
        error={day.error || board.error}
        retry={reloadAll}
      />

      {/* Two-Column Live Floor & Queue Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Live Bay Floor */}
        <section className="rounded-lg border border-border bg-white dark:bg-[#121214] lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Bay Floor
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("Bay board")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              Manage bays <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="divide-y divide-border">
            {board.loading && !board.data && (
              <div className="space-y-4 p-4" role="status" aria-busy="true">
                <span className="sr-only">Loading bay floor...</span>
                {[0, 1].map((idx) => (
                  <div key={idx} className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <Skeleton className="h-20 w-full rounded-md" />
                      <Skeleton className="h-20 w-full rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {board.data?.containers.map((container) => {
              const busyCount = container.bays.filter(
                (b) => b.cards.length > 0,
              ).length;
              return (
                <div key={container.id} className="p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                      {container.name}
                    </h3>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {busyCount} of {container.bays.length} in use
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {container.bays.map((bay) => {
                      const car = bay.cards[0] ?? null;
                      return (
                        <div
                          key={bay.id}
                          className={`rounded-md border p-3 ${
                            car
                              ? "border-amber-500/30 bg-amber-500/5 dark:bg-[#161619] dark:border-primary/30"
                              : "border-border/70 bg-stone-50 dark:bg-[#0d0d0f]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-bold text-stone-900 dark:text-foreground">
                              {bay.name}
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ${
                                car
                                  ? "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                  : "border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              }`}
                            >
                              {car ? "Occupied" : "Open"}
                            </span>
                          </div>
                          {car ? (
                            <div className="mt-2 space-y-1 text-xs">
                              <p className="font-semibold text-stone-900 dark:text-foreground">
                                <span className="font-mono text-amber-600 dark:text-primary">
                                  {car.referenceCode}
                                </span>{" "}
                                · {car.vehicleModel}
                              </p>
                              <p className="truncate text-stone-600 dark:text-muted-foreground">
                                {car.lines[0]?.name ?? "Service"}
                                {car.lines.length > 1
                                  ? ` +${car.lines.length - 1} more`
                                  : ""}{" "}
                                · {car.progress.done}/{car.progress.total} done
                              </p>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs font-medium text-stone-500 dark:text-zinc-500">
                              Open
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {board.data && board.data.containers.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">
                No bay containers configured yet.
              </p>
            )}
          </div>
        </section>

        {/* Today's Priority Queue */}
        <section className="rounded-lg border border-border bg-white dark:bg-[#121214] lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Today&apos;s Queue
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("Bookings")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              All bookings <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="divide-y divide-border">
            {day.loading && !day.data && (
              <div className="space-y-3 p-4" role="status" aria-busy="true">
                <span className="sr-only">Loading today&apos;s queue...</span>
                {[0, 1, 2, 3].map((idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="space-y-1.5">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-3 w-44 opacity-70" />
                    </div>
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            )}
            {activeBookings.slice(0, 8).map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 p-3.5 transition-colors hover:bg-[#18181b]/60"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onNavigate("Bookings")}
                      className="font-mono text-xs font-bold text-primary underline underline-offset-4"
                    >
                      {b.referenceCode}
                    </button>
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ${
                        b.status === "CONFIRMED" || b.status === "COMPLETED"
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                          : b.status === "PENDING"
                            ? "border-amber-500/30 bg-amber-500/15 text-amber-400"
                            : "border-blue-500/30 bg-blue-500/15 text-blue-400"
                      }`}
                    >
                      {statusLabel(b.status)}
                    </span>
                  </div>
                  <p className="truncate text-xs font-medium text-foreground">
                    {b.customerName} · {b.vehicleModel}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.lines
                      .filter((l) => !l.removed)
                      .map((l) => l.name)
                      .join(", ") || b.serviceName}{" "}
                    · {b.bay?.name ?? "Unassigned bay"}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                  {totalLabel(b.totals)}
                </div>
              </div>
            ))}
            {day.data && activeBookings.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">
                No active bookings scheduled for today yet.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Month-to-Date Executive Strip (Admin Only) */}
      {isAdmin && analytics.data && (
        <section className="rounded-lg border border-border bg-white dark:bg-[#121214] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-foreground">
                This Month&apos;s Performance
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("Sales Analytics")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              Full analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {(() => {
            const mtdNet = analytics.data.revenueCentavos - (analytics.data.commissions.earnedCentavos + (analytics.data.expenses?.manualCentavos ?? 0) + (analytics.data.expenses?.stockBoughtCentavos ?? 0));
            const mtdPos = mtdNet >= 0;
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <div className="rounded-md border border-border/80 bg-stone-50 dark:bg-[#0d0d0f] p-3.5">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Month Revenue
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                    {formatPesos(analytics.data.revenueCentavos)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {analytics.data.finishedJobs} finished jobs
                  </p>
                </div>
                <div className="rounded-md border border-border/80 bg-stone-50 dark:bg-[#0d0d0f] p-3.5">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Est. Net Income
                  </p>
                  <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${mtdPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {formatPesos(mtdNet)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    After comms &amp; expenses
                  </p>
                </div>
                <div className="rounded-md border border-border/80 bg-stone-50 dark:bg-[#0d0d0f] p-3.5">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Average Ticket
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                    {analytics.data.averageJobCentavos !== null
                      ? formatPesos(analytics.data.averageJobCentavos)
                      : "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {analytics.data.fullyPricedJobs} fully priced
                  </p>
                </div>
                <div className="rounded-md border border-border/80 bg-stone-50 dark:bg-[#0d0d0f] p-3.5">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Unpaid Commissions
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                    {formatPesos(analytics.data.commissions.unpaidCentavos)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Earned: {formatPesos(analytics.data.commissions.earnedCentavos)}
                  </p>
                </div>
                <div className="rounded-md border border-border/80 bg-stone-50 dark:bg-[#0d0d0f] p-3.5">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Inventory Alerts
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                    {analytics.data.stock.lowOrOutCount}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Low or out-of-stock
                  </p>
                </div>
              </div>
            );
          })()}
        </section>
      )}
    </div>
  );
}

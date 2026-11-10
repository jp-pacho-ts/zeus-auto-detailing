"use client";

import * as React from "react";
import {
  Calendar,
  Filter,
  BarChart3,
  Table2,
  TrendingUp,
  TrendingDown,
  Sparkles,
  AlertCircle,
  Boxes,
  CheckCircle2,
  X,
} from "lucide-react";
import { formatPesos } from "@/lib/commission";
import type { AdminAnalytics } from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import {
  analyticsUrl,
  averageText,
  barText,
  bucketLabel,
  chartEmptyText,
  chartTitle,
  commissionEarnedNote,
  customProblem,
  deletedNote,
  groupLabel,
  manilaToday,
  marginText,
  olderNote,
  periodLabel,
  periodRange,
  REVENUE_DEFINITION,
  SERVICE_GROUPS,
  serviceMatchesGroup,
  STATUS_ROWS,
  stockNote,
  stockValueText,
  unpricedNotice,
  type AnalyticsPeriod,
  type AnalyticsPreset,
  type ServiceGroupCode,
} from "./analytics/analytics-model";
import { ColumnChart } from "./analytics/column-chart";
import { RankedBars } from "./analytics/ranked-bars";
import { fieldClass, LoadState } from "./bookings/use-admin-resource";
import { useKeptResource } from "./team/use-kept-resource";

const CARD = "rounded-xl border border-border/80 bg-[#121214] p-5 shadow-xs";
const PRESETS: [AnalyticsPreset | "CUSTOM", string][] = [
  ["TODAY", "Today"],
  ["THIS_WEEK", "This week"],
  ["LAST_WEEK", "Last week"],
  ["THIS_MONTH", "This month"],
  ["LAST_MONTH", "Last month"],
  ["THIS_YEAR", "This year"],
  ["CUSTOM", "Custom"],
];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

type ViewMode = "ALL" | "FINANCIALS" | "SERVICES";

function StatTile({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {Icon && <Icon className={`h-4 w-4 shrink-0 ${accent ?? "text-muted-foreground"}`} />}
      </div>
      <b className="mt-2 block break-words font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {value}
      </b>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AnalyticsTab({ role }: { role: UserRole }) {
  const isAdmin = role === "ADMIN";
  const [today] = React.useState(() => manilaToday(new Date()));
  const [preset, setPreset] = React.useState<AnalyticsPreset | "CUSTOM">("THIS_MONTH");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>(() => periodRange("THIS_MONTH", today));
  const [draft, setDraft] = React.useState<AnalyticsPeriod>(period);
  const figures = useKeptResource<AdminAnalytics>(isAdmin ? analyticsUrl(period) : null);
  const [asTable, setAsTable] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>("ALL");
  const [selectedCategory, setSelectedCategory] = React.useState<ServiceGroupCode>("ALL");

  const data = figures.data;

  // Filter top services by selected category
  const filteredServices = React.useMemo(() => {
    if (!data) return [];
    if (selectedCategory === "ALL") return data.topServices;
    return data.topServices.filter((s) => serviceMatchesGroup(s.name, selectedCategory));
  }, [data, selectedCategory]);

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-border bg-[#121214] p-6 text-sm text-muted-foreground">
        Only an admin can see sales and analytics.
      </div>
    );
  }

  function choosePreset(next: AnalyticsPreset | "CUSTOM") {
    setPreset(next);
    if (next === "CUSTOM") return;
    const range = periodRange(next, today);
    setPeriod(range);
    setDraft(range);
  }

  function editCustomDate(change: Partial<AnalyticsPeriod>) {
    const next = { ...draft, ...change };
    setDraft(next);
    if (!customProblem(next.from, next.to)) setPeriod(next);
  }

  const problem = preset === "CUSTOM" ? customProblem(draft.from, draft.to) : null;
  const stale = figures.loading && data !== null;
  const notices = data
    ? [deletedNote(data.notCounted.deletedFinished), olderNote(data.notCounted.olderFinished)].filter(
        (x): x is string => x !== null,
      )
    : [];
  const unpriced = data ? unpricedNotice(data.unpriced.jobs) : null;
  const hasBars = data ? data.buckets.rows.some((r) => r.revenueCentavos > 0) : false;

  return (
    <div className="space-y-6">
      {/* Primary Toolbar & Filter Deck */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Time Preset Pills */}
          <div role="group" aria-label="Period preset" className="flex flex-wrap gap-1 rounded-lg border border-border/80 bg-[#121214] p-1">
            {PRESETS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={preset === id}
                onClick={() => choosePreset(id)}
                className={`min-h-[40px] rounded-md px-3 text-xs font-semibold transition-colors ${FOCUS} ${
                  preset === id
                    ? "bg-zinc-800 text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-zinc-900/50 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Perspective View Mode Toggle */}
          <div role="group" aria-label="Analytics view mode" className="flex items-center gap-1 rounded-lg border border-border/80 bg-[#121214] p-1">
            <button
              type="button"
              aria-pressed={viewMode === "ALL"}
              onClick={() => setViewMode("ALL")}
              className={`min-h-[40px] rounded-md px-3 text-xs font-semibold transition-colors ${FOCUS} ${
                viewMode === "ALL"
                  ? "bg-zinc-800 text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All metrics
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "FINANCIALS"}
              onClick={() => setViewMode("FINANCIALS")}
              className={`min-h-[40px] rounded-md px-3 text-xs font-semibold transition-colors ${FOCUS} ${
                viewMode === "FINANCIALS"
                  ? "bg-zinc-800 text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              P&amp;L summary
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "SERVICES"}
              onClick={() => setViewMode("SERVICES")}
              className={`min-h-[40px] rounded-md px-3 text-xs font-semibold transition-colors ${FOCUS} ${
                viewMode === "SERVICES"
                  ? "bg-zinc-800 text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Services &amp; demand
            </button>
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {preset === "CUSTOM" && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 bg-[#121214] p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="font-medium text-foreground">Custom range:</span>
            </div>
            <label className="flex items-center gap-1.5">
              <span>From</span>
              <input
                type="date"
                value={draft.from}
                onChange={(e) => editCustomDate({ from: e.target.value })}
                className={fieldClass}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span>To</span>
              <input
                type="date"
                value={draft.to}
                onChange={(e) => editCustomDate({ to: e.target.value })}
                className={fieldClass}
              />
            </label>
          </div>
        )}

        {/* Service Category Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <div className="mr-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Filter className="h-3.5 w-3.5 text-primary" />
            <span>Category:</span>
          </div>
          {SERVICE_GROUPS.map((group) => {
            const isSelected = selectedCategory === group.code;
            return (
              <button
                key={group.code}
                type="button"
                onClick={() => setSelectedCategory(group.code)}
                aria-pressed={isSelected}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all ${FOCUS} ${
                  isSelected
                    ? "border-primary/60 bg-primary/15 text-primary shadow-xs"
                    : "border-border/60 bg-[#141416] text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {group.label}
                {isSelected && group.code !== "ALL" && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCategory("ALL");
                    }}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
                    title="Clear filter"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {problem && (
        <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-400">
          {problem}
        </p>
      )}

      <LoadState loading={figures.loading && data === null} error={figures.error} retry={figures.reload} />

      {data && (
        <div className={`space-y-6 ${stale ? "opacity-60" : ""}`} aria-busy={stale}>
          {/* Executive Financial Hero (Shown in ALL and FINANCIALS view) */}
          {(viewMode === "ALL" || viewMode === "FINANCIALS") && (
            <section className={CARD}>
              {(() => {
                const rev = data.revenueCentavos;
                const comm = data.commissions.earnedCentavos;
                const manual = data.expenses?.manualCentavos ?? 0;
                const stock = data.expenses?.stockBoughtCentavos ?? 0;
                const totalOut = comm + manual + stock;
                const netIncome = rev - totalOut;
                const isProfitable = netIncome >= 0;
                const margin = marginText(netIncome, rev);

                return (
                  <div className="space-y-5">
                    {/* Header Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h1 className="text-base font-bold text-foreground">Financial Performance</h1>
                          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {periodLabel(data.from, data.to)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{REVENUE_DEFINITION}</p>
                      </div>

                      {/* Net Margin Pill */}
                      {margin && (
                        <div
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-semibold ${
                            isProfitable
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : "border-rose-500/40 bg-rose-500/10 text-rose-400"
                          }`}
                        >
                          {isProfitable ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" />
                          )}
                          <span>{margin}</span>
                        </div>
                      )}
                    </div>

                    {/* Top Net Hero Summary */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      <div className="rounded-xl border border-border/70 bg-[#161618] p-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Gross Revenue</p>
                        <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                          {formatPesos(rev)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {data.finishedJobs} finished jobs ({data.fullyPricedJobs} fully priced)
                        </p>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-[#161618] p-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Deductions</p>
                        <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-rose-400 sm:text-4xl">
                          −{formatPesos(totalOut)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Commissions, facility overhead &amp; inventory
                        </p>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-[#18181b] p-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Est. Net Income</p>
                        <p
                          className={`mt-2 font-mono text-3xl font-bold tracking-tight sm:text-4xl ${
                            isProfitable ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {formatPesos(netIncome)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Operating profit after commissions and recorded expenses
                        </p>
                      </div>
                    </div>

                    {/* Itemized P&L Outflow Breakdown Cards */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-border/60 bg-[#141416] p-3.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Gross Revenue
                        </p>
                        <p className="mt-1 font-mono text-lg font-bold text-foreground">{formatPesos(rev)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{data.finishedJobs} finished jobs</p>
                      </div>

                      <div className="rounded-lg border border-border/60 bg-[#141416] p-3.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Technician Commissions
                          </p>
                          <span className="h-2 w-2 rounded-full bg-amber-400" />
                        </div>
                        <p className="mt-1 font-mono text-lg font-bold text-amber-400">−{formatPesos(comm)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Unpaid: {formatPesos(data.commissions.unpaidCentavos)} · {commissionEarnedNote(data.commissions.startsAt, data.from)}
                        </p>
                      </div>

                      <div className="rounded-lg border border-border/60 bg-[#141416] p-3.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Operating Expenses
                          </p>
                          <span className="h-2 w-2 rounded-full bg-rose-400" />
                        </div>
                        <p className="mt-1 font-mono text-lg font-bold text-rose-400">−{formatPesos(manual)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Direct shop &amp; facility expenses</p>
                      </div>

                      <div className="rounded-lg border border-border/60 bg-[#141416] p-3.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Supplies &amp; Stock
                          </p>
                          <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        </div>
                        <p className="mt-1 font-mono text-lg font-bold text-indigo-400">−{formatPesos(stock)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Chemicals &amp; consumables received</p>
                      </div>
                    </div>

                    {notices.map((note) => (
                      <p key={note} className="text-xs text-muted-foreground">
                        {note}
                      </p>
                    ))}
                  </div>
                );
              })()}
            </section>
          )}

          {/* Operational Metrics Strip */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Finished jobs"
              value={String(data.finishedJobs)}
              note="Bookings completed in this period."
              icon={CheckCircle2}
              accent="text-emerald-400"
            />
            <StatTile
              label="Average job value"
              value={averageText(data.averageJobCentavos)}
              note={
                data.averageJobCentavos === null
                  ? "No finished job with every price set."
                  : "Jobs with every price set."
              }
              icon={Sparkles}
              accent="text-primary"
            />
            <StatTile
              label="Stock value today"
              value={stockValueText(data.stock.valueCentavos)}
              note={stockNote(data.stock.noCostItems)}
              icon={Boxes}
              accent="text-blue-400"
            />
            <StatTile
              label="Reorder alerts"
              value={String(data.stock.lowOrOutCount)}
              note="Supplies at or below their reorder level."
              icon={AlertCircle}
              accent={data.stock.lowOrOutCount > 0 ? "text-amber-400" : "text-muted-foreground"}
            />
          </div>

          {/* Unpriced Jobs Notice */}
          {unpriced && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
              <div className="flex items-center gap-2 font-medium text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>{unpriced}</p>
              </div>
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className={`flex min-h-[40px] cursor-pointer items-center underline ${FOCUS}`}>
                  See which jobs
                </summary>
                <ul className="mt-1 space-y-1">
                  {data.unpriced.references.map((reference) => (
                    <li key={reference} className="font-mono tabular-nums">
                      {reference}
                    </li>
                  ))}
                  {data.unpriced.jobs > data.unpriced.references.length && (
                    <li>and {data.unpriced.jobs - data.unpriced.references.length} more</li>
                  )}
                </ul>
              </details>
            </div>
          )}

          {/* Revenue Distribution Chart & Table (Shown in ALL and FINANCIALS view) */}
          {(viewMode === "ALL" || viewMode === "FINANCIALS") && (
            <section className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{chartTitle(data.buckets.unit)}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    A period with no finished job shows no bar.
                  </p>
                </div>
                {hasBars && (
                  <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-[#161618] p-1">
                    <button
                      type="button"
                      aria-pressed={!asTable}
                      onClick={() => setAsTable(false)}
                      className={`flex min-h-[36px] items-center gap-1.5 rounded px-2.5 text-xs font-semibold ${FOCUS} ${
                        !asTable ? "bg-zinc-800 text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <BarChart3 className="h-3.5 w-3.5" />
                      <span>Chart</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={asTable}
                      onClick={() => setAsTable(true)}
                      className={`flex min-h-[36px] items-center gap-1.5 rounded px-2.5 text-xs font-semibold ${FOCUS} ${
                        asTable ? "bg-zinc-800 text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Table2 className="h-3.5 w-3.5" />
                      <span>Table</span>
                    </button>
                  </div>
                )}
              </div>

              {!hasBars && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {chartEmptyText(data.finishedJobs)}
                </p>
              )}

              {hasBars && !asTable && (
                <div className="mt-4">
                  <ColumnChart rows={data.buckets.rows} unit={data.buckets.unit} />
                </div>
              )}

              {hasBars && asTable && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/80 text-left text-xs font-semibold text-muted-foreground">
                        <th className="py-2.5">Period</th>
                        <th className="py-2.5 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.buckets.rows.map((row) => (
                        <tr key={row.start} className="hover:bg-zinc-800/20">
                          <td className="py-2.5 text-foreground">{bucketLabel(row, data.buckets.unit)}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-foreground">
                            {barText(row)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Service & Operational Breakdowns (Shown in ALL and SERVICES view) */}
          {(viewMode === "ALL" || viewMode === "SERVICES") && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Section
                title="By service category"
                note="One job can count in two groups (e.g., wash with tint). Click to filter top services."
                action={
                  selectedCategory !== "ALL" ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory("ALL")}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Show all
                    </button>
                  ) : undefined
                }
              >
                <RankedBars
                  empty="Nothing in this period."
                  selectedKey={selectedCategory === "ALL" ? null : selectedCategory}
                  onSelectKey={(code) => setSelectedCategory(code as ServiceGroupCode)}
                  rows={data.byGroup.map((g) => ({
                    key: g.code,
                    label: groupLabel(g.code),
                    centavos: g.revenueCentavos,
                  }))}
                />
              </Section>

              <Section title="By line of work" note="The active queues on the shop bay board.">
                <RankedBars
                  empty="Nothing in this period."
                  rows={data.byQueue.map((q) => ({
                    key: q.code,
                    label: q.name,
                    centavos: q.revenueCentavos,
                  }))}
                />
              </Section>

              <Section
                title={
                  selectedCategory === "ALL"
                    ? "Top services"
                    : `Top services (${groupLabel(selectedCategory)})`
                }
                note="Ranked by gross revenue, times booked in brackets."
              >
                <RankedBars
                  empty={
                    selectedCategory === "ALL"
                      ? "Nothing in this period."
                      : `No ${groupLabel(selectedCategory)} services in this period.`
                  }
                  rows={filteredServices.map((t) => ({
                    key: t.serviceId,
                    label: `${t.name} (${t.count})`,
                    centavos: t.revenueCentavos,
                  }))}
                />
              </Section>

              <Section title="Bookings by status" note="All bookings dated in this period, as they stand now.">
                <ul className="mt-3 divide-y divide-border/60">
                  {STATUS_ROWS.map(([status, label]) => {
                    const count = data.bookingsByStatus[status] ?? 0;
                    return (
                      <li key={status} className="flex items-center justify-between py-2.5 text-sm text-foreground">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              status === "COMPLETED"
                                ? "bg-emerald-400"
                                : status === "IN_PROGRESS"
                                  ? "bg-amber-400"
                                  : status === "CONFIRMED"
                                    ? "bg-blue-400"
                                    : status === "PENDING"
                                      ? "bg-zinc-400"
                                      : "bg-rose-400"
                            }`}
                          />
                          <span>{label}</span>
                        </div>
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                          {count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

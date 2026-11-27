"use client";
import * as React from "react";
import { Calendar } from "lucide-react";
import type { AdminExpenseAnalytics } from "@/types/admin-contracts";
import { bucketLabel, customProblem, manilaToday, periodLabel, periodRange, type AnalyticsPeriod, type AnalyticsPreset } from "../analytics/analytics-model";
import { ColumnChart } from "../analytics/column-chart";
import { RankedBars } from "../analytics/ranked-bars";
import { fieldClass, LoadState } from "../bookings/use-admin-resource";
import { useKeptResource } from "../team/use-kept-resource";
import { expenseBarText, expenseBucketText, expenseChartRows, formatTotal, kindShares, unpricedNote } from "./expenses-model";

const PRESETS: [AnalyticsPreset | "CUSTOM", string][] = [
  ["TODAY", "Today"], ["THIS_WEEK", "This week"], ["LAST_WEEK", "Last week"], ["THIS_MONTH", "This month"],
  ["LAST_MONTH", "Last month"], ["THIS_YEAR", "This year"], ["CUSTOM", "Custom"],
];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const KIND_COLOURS = ["bg-primary", "bg-emerald-400", "bg-amber-400"];

// Expense analytics in the Sales & Analytics style: the same period pills, day/week/month chart and rules. Only an admin reaches this panel.
export function ExpenseAnalytics({ refresh, period, onPeriodChange }: { refresh: object; period: AnalyticsPeriod; onPeriodChange: (period: AnalyticsPeriod) => void }) {
  const [today] = React.useState(() => manilaToday(new Date()));
  const [preset, setPreset] = React.useState<AnalyticsPreset | "CUSTOM">("THIS_MONTH");
  const setPeriod = onPeriodChange;
  const [draft, setDraft] = React.useState<AnalyticsPeriod>(period);
  const [asTable, setAsTable] = React.useState(false);
  const figures = useKeptResource<AdminExpenseAnalytics>(`/api/admin/expenses/analytics?from=${period.from}&to=${period.to}`);
  const data = figures.data;
  const reload = figures.reload;
  React.useEffect(() => { void reload(); }, [refresh, reload]);

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
  const rows = data?.buckets ?? [];
  const chartRows = expenseChartRows(rows);
  const shares = data ? kindShares(data.totals) : [];
  const categories = (data?.byCategory ?? []).map((c) => ({ key: c.categoryId, label: c.name, centavos: Number(c.total) })).sort((a, b) => b.centavos - a.centavos);

  return (
    <section aria-labelledby="expense-analytics-heading" className="space-y-4 rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="expense-analytics-heading" className="text-sm font-bold text-foreground">Expense overview</h3>
        <div role="group" aria-label="Expense period" className="flex flex-wrap gap-1 rounded-lg border border-border/80 bg-stone-100 p-1 dark:bg-panel">
          {PRESETS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={preset === id}
              onClick={() => choosePreset(id)}
              className={`min-h-[40px] rounded-md px-3 text-xs font-semibold transition-colors ${FOCUS} ${
                preset === id
                  ? "bg-white text-stone-900 shadow-xs dark:bg-zinc-800 dark:text-foreground"
                  : "text-stone-600 hover:bg-white/60 hover:text-stone-900 dark:text-muted-foreground dark:hover:bg-zinc-900/50 dark:hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Browse month</span>
        {([-1, 1] as const).map((direction) => <button key={direction} type="button" aria-label={direction < 0 ? "Previous month" : "Next month"} className="min-h-[44px] rounded-md border border-border px-3 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-primary" onClick={() => {
          const date = new Date(period.from + "T00:00:00Z");
          date.setUTCMonth(date.getUTCMonth() + direction, 1);
          const range = periodRange("THIS_MONTH", date.toISOString().slice(0, 10));
          setPreset("CUSTOM"); setPeriod(range); setDraft(range);
        }}>{direction < 0 ? "Previous" : "Next"}</button>)}
        <input aria-label="Choose month and year" type="month" min="2020-01" max={today.slice(0, 7)} value={period.from.slice(0, 7)} className={fieldClass} onChange={(e) => {
          if (!e.target.value) return;
          setPreset("CUSTOM");
          const range = periodRange("THIS_MONTH", e.target.value + "-01");
          setPeriod(range); setDraft(range);
        }} />
      </div>
      {preset === "CUSTOM" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 bg-stone-50 p-3 text-xs text-muted-foreground dark:bg-panel">
          <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
          <label className="flex items-center gap-1.5">From<input type="date" value={draft.from} onChange={(e) => editCustomDate({ from: e.target.value })} className={fieldClass} /></label>
          <label className="flex items-center gap-1.5">To<input type="date" value={draft.to} onChange={(e) => editCustomDate({ to: e.target.value })} className={fieldClass} /></label>
        </div>
      )}
      {problem && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-400">{problem}</p>}

      <LoadState loading={figures.loading && data === null} error={figures.error} retry={figures.reload} />

      {data && (
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-4 ${figures.loading ? "opacity-60" : ""}`} aria-busy={figures.loading}>
          <div className="rounded-lg border border-border bg-raised p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total spent · {periodLabel(data.from, data.to)}</p>
            <p data-testid="expense-analytics-total" className="mt-1 font-mono text-3xl font-bold tracking-tight text-foreground">{formatTotal(data.totals.total)}</p>
          </div>

          <div className="contents">
            {shares.map((s, i) => (
              <div key={s.label} className="rounded-lg border border-border bg-raised p-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_COLOURS[i]}`} aria-hidden="true" />{s.label}
                </p>
                <p className="mt-1 font-mono text-lg font-bold text-foreground">{formatTotal(s.total)}</p>
                {s.pct !== null && <p className="text-xs text-muted-foreground">{s.pct}% of the total</p>}
              </div>
            ))}
          </div>

          <div className="sm:col-span-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold text-muted-foreground">Spending by {data.unit.toLowerCase()}</h4>
              <button type="button" onClick={() => setAsTable((t) => !t)} className={`min-h-[40px] rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground ${FOCUS}`}>
                {asTable ? "Show as chart" : "Show as table"}
              </button>
            </div>
            {asTable || chartRows === null ? (
              <table className="mt-2 w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-semibold">Period</th><th className="py-1 text-right font-semibold">Spent</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.start} className="border-t border-border"><td className="py-1.5 text-foreground">{bucketLabel({ ...r, revenueCentavos: 0, jobs: 0 }, data.unit)}</td><td className="py-1.5 text-right font-mono text-foreground">{expenseBucketText(r)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : chartRows.some((r) => r.revenueCentavos > 0) ? (
              <ColumnChart rows={chartRows} unit={data.unit} name="Expenses" text={expenseBarText} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No spending in this period.</p>
            )}
          </div>

          <div className="sm:col-span-4">
            <h4 className="text-xs font-semibold text-muted-foreground">Typed-in expenses by category</h4>
            {data.byCategory.some((c) => BigInt(c.total) > BigInt(Number.MAX_SAFE_INTEGER)) ? <ul>{data.byCategory.map((c) => <li key={c.categoryId}>{c.name}: {formatTotal(c.total)}</li>)}</ul> : <RankedBars rows={categories} empty="No typed-in expenses in this period." />}
          </div>
          {unpricedNote(data.unpricedStockIns) && <p className="text-xs text-muted-foreground">{unpricedNote(data.unpricedStockIns)}</p>}
        </div>
      )}
    </section>
  );
}

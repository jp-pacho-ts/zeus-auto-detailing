"use client";

import * as React from "react";
import { formatPesos } from "@/lib/commission";
import type { AdminAnalytics } from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import {
  analyticsUrl, averageText, barText, bucketLabel, chartEmptyText, chartTitle, commissionEarnedNote, customProblem, deletedNote, groupLabel, manilaToday, olderNote, periodLabel,
  periodRange, PROFIT_LATER, REVENUE_DEFINITION, STATUS_ROWS, stockNote, stockValueText, unpricedNotice, type AnalyticsPeriod, type AnalyticsPreset,
} from "./analytics/analytics-model";
import { ColumnChart } from "./analytics/column-chart";
import { RankedBars } from "./analytics/ranked-bars";
import { fieldClass, LoadState } from "./bookings/use-admin-resource";
import { useKeptResource } from "./team/use-kept-resource";

const CARD = "rounded border border-border bg-[#121214] p-5";
const PRESETS: [AnalyticsPreset | "CUSTOM", string][] = [["THIS_MONTH", "This month"], ["LAST_MONTH", "Last month"], ["THIS_YEAR", "This year"], ["CUSTOM", "Custom"]];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <b className="mt-1 block break-words text-2xl font-bold tracking-tight text-foreground">{value}</b>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
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

  if (!isAdmin)
    return <div className="rounded border border-border bg-[#121214] p-6 text-sm text-muted-foreground">Only an admin can see sales.</div>;

  function choose(next: AnalyticsPreset | "CUSTOM") {
    setPreset(next);
    if (next === "CUSTOM") return;
    const range = periodRange(next, today);
    setPeriod(range);
    setDraft(range);
  }
  function edit(change: Partial<AnalyticsPeriod>) {
    const next = { ...draft, ...change };
    setDraft(next);
    if (!customProblem(next.from, next.to)) setPeriod(next);
  }
  const problem = preset === "CUSTOM" ? customProblem(draft.from, draft.to) : null;
  const data = figures.data;
  // The figures carry the period they came from, so old numbers never sit under a new label while a new period loads.
  const stale = figures.loading && data !== null;
  const notices = data ? [deletedNote(data.notCounted.deletedFinished), olderNote(data.notCounted.olderFinished)].filter((x): x is string => x !== null) : [];
  const unpriced = data ? unpricedNotice(data.unpriced.jobs) : null;
  const hasBars = data ? data.buckets.rows.some((r) => r.revenueCentavos > 0) : false;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Period" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded border border-border bg-[#121214] p-1">
          {PRESETS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={preset === id} onClick={() => choose(id)} className={`min-h-[44px] rounded px-3 text-sm font-semibold ${FOCUS} ${preset === id ? "bg-[#18181b] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        {preset === "CUSTOM" && (
          <>
            <label className="text-xs text-muted-foreground">From<input type="date" value={draft.from} onChange={(e) => edit({ from: e.target.value })} className={fieldClass} /></label>
            <label className="text-xs text-muted-foreground">To<input type="date" value={draft.to} onChange={(e) => edit({ to: e.target.value })} className={fieldClass} /></label>
          </>
        )}
      </div>
      {problem && <p role="alert" className="text-sm text-muted-foreground">{problem}</p>}
      <LoadState loading={figures.loading && data === null} error={figures.error} retry={figures.reload} />

      {data && (
        <div className={`space-y-4 ${stale ? "opacity-60" : ""}`} aria-busy={stale}>
          <section className={CARD}>
            <p className="text-xs text-muted-foreground">Revenue · {periodLabel(data.from, data.to)}</p>
            <b className="mt-1 block break-words text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{formatPesos(data.revenueCentavos)}</b>
            <p className="mt-2 text-xs text-muted-foreground">{REVENUE_DEFINITION}</p>
            {notices.map((note) => <p key={note} className="mt-1 text-xs text-muted-foreground">{note}</p>)}
          </section>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Finished jobs" value={String(data.finishedJobs)} note="Bookings marked finished in this period." />
            <Tile label="Average job" value={averageText(data.averageJobCentavos)} note={data.averageJobCentavos === null ? "No finished job with every price set." : "Jobs with every price set."} />
            <Tile label="Commission earned" value={formatPesos(data.commissions.earnedCentavos)} note={commissionEarnedNote(data.commissions.startsAt, data.from)} />
            <Tile label="Commission unpaid" value={formatPesos(data.commissions.unpaidCentavos)} note="Of that amount, not yet marked paid." />
          </div>

          {unpriced && (
            <div className="rounded border border-border border-l-[3px] border-l-primary bg-[#121214] p-4 text-sm text-foreground">
              <p>{unpriced}</p>
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className={`flex min-h-[44px] cursor-pointer items-center underline ${FOCUS}`}>See which jobs</summary>
                <ul className="space-y-1">
                  {data.unpriced.references.map((reference) => <li key={reference} className="tabular-nums">{reference}</li>)}
                  {data.unpriced.jobs > data.unpriced.references.length && <li>and {data.unpriced.jobs - data.unpriced.references.length} more</li>}
                </ul>
              </details>
            </div>
          )}

          <section className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">{chartTitle(data.buckets.unit)}</h2>
                <p className="mt-1 text-xs text-muted-foreground">A period with no finished job shows no bar.</p>
              </div>
              {hasBars && (
                <button type="button" onClick={() => setAsTable((v) => !v)} className={`min-h-[44px] shrink-0 rounded border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground ${FOCUS}`}>
                  {asTable ? "Show as chart" : "Show as table"}
                </button>
              )}
            </div>
            {!hasBars && <p className="py-6 text-center text-sm text-muted-foreground">{chartEmptyText(data.finishedJobs)}</p>}
            {hasBars && !asTable && <div className="mt-3"><ColumnChart rows={data.buckets.rows} unit={data.buckets.unit} /></div>}
            {hasBars && asTable && (
              <div className="mt-3">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 font-semibold">Period</th><th className="py-2 text-right font-semibold">Result</th></tr></thead>
                  <tbody>
                    {data.buckets.rows.map((row) => (
                      <tr key={row.start} className="border-t border-border"><td className="py-2 text-foreground">{bucketLabel(row, data.buckets.unit)}</td><td className="py-2 text-right tabular-nums text-foreground">{barText(row)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="By service group" note="One job can count in two groups (a wash with a tint).">
              <RankedBars empty="Nothing in this period." rows={data.byGroup.map((g) => ({ key: g.code, label: groupLabel(g.code), centavos: g.revenueCentavos }))} />
            </Section>
            <Section title="By line of work" note="The queues on the board.">
              <RankedBars empty="Nothing in this period." rows={data.byQueue.map((q) => ({ key: q.code, label: q.name, centavos: q.revenueCentavos }))} />
            </Section>
            <Section title="Top services" note="By revenue, how many times in brackets.">
              <RankedBars empty="Nothing in this period." rows={data.topServices.map((t) => ({ key: t.serviceId, label: `${t.name} (${t.count})`, centavos: t.revenueCentavos }))} />
            </Section>
            <Section title="Bookings by status" note="Bookings dated in this period, as they stand now.">
              <ul className="mt-2">
                {STATUS_ROWS.map(([status, label]) => (
                  <li key={status} className="flex justify-between border-t border-border py-2 text-sm text-foreground first:border-t-0"><span>{label}</span><span className="tabular-nums">{data.bookingsByStatus[status]}</span></li>
                ))}
              </ul>
            </Section>
          </div>

          <p className="rounded border border-dashed border-border p-5 text-sm text-muted-foreground">{PROFIT_LATER}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Tile label="Stock value today" value={stockValueText(data.stock.valueCentavos)} note={stockNote(data.stock.noCostItems)} />
            <Tile label="Low or out of stock today" value={String(data.stock.lowOrOutCount)} note="Supplies at or below their reorder level." />
          </div>
        </div>
      )}
    </div>
  );
}

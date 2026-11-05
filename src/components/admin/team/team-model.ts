// P1-37: the plain-language rules for the Team and Commissions screens. No React, no network, so they are unit tested.
import { basisPointsToPercent, formatPesos } from "@/lib/commission";
import type { AdminCommissionSummary, AdminTeamPerson, AdminTeamRemoveOutcome } from "@/types/admin-contracts";

const DAY_MS = 86_400_000;

/** Today's date in the shop's time zone (Asia/Manila), as YYYY-MM-DD. */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(t).toISOString().slice(0, 10);
  return back === date ? t / DAY_MS : null;
}

/** The first day of the month that `today` is in. */
export function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/** Null when the range can be asked for; otherwise the sentence to show. Mirrors the server's one-year limit. */
export function rangeProblem(from: string, to: string): string | null {
  const a = dayNumber(from), b = dayNumber(to);
  if (a === null || b === null) return "Choose both dates.";
  if (b < a) return "The end date can't be before the start date.";
  if (b - a > 365) return "Choose a range of one year or less.";
  return null;
}

export function ratePhrase(person: Pick<AdminTeamPerson, "commissionRateBp">, defaultBp: number): string {
  return person.commissionRateBp === null
    ? `${basisPointsToPercent(defaultBp)}% (shop default)`
    : `${basisPointsToPercent(person.commissionRateBp)}%`;
}

export function defaultRateLine(defaultBp: number): string {
  return `Default rate is ${basisPointsToPercent(defaultBp)}% until you change it.`;
}

export function removeResult(outcome: AdminTeamRemoveOutcome, name: string): string {
  return outcome === "DELETED"
    ? `${name} was removed from the team.`
    : `${name} has job history, so they were made inactive instead. Their past jobs and commissions are kept.`;
}

export function removeWarning(person: Pick<AdminTeamPerson, "name" | "openJobs" | "hasHistory">): string {
  if (person.openJobs > 0)
    return `${person.name} is still on ${person.openJobs} open ${person.openJobs === 1 ? "job" : "jobs"}. Take them off those jobs first.`;
  return person.hasHistory
    ? `${person.name} has job history. They will be made inactive and their past jobs and commissions are kept.`
    : `${person.name} will be removed from the team. This can't be undone.`;
}

export function canManage(person: Pick<AdminTeamPerson, "role">): boolean {
  return person.role === "DETAILER";
}

/** One sentence per warning that applies, in a fixed order; empty when the range is clean. */
export function warningLines(warnings: AdminCommissionSummary["warnings"]): string[] {
  const lines: string[] = [];
  if (warnings.missingRecords > 0)
    lines.push(`${plural(warnings.missingRecords, "completed booking")} in the shop ${warnings.missingRecords === 1 ? "has" : "have"} no commission recorded because something went wrong when ${warnings.missingRecords === 1 ? "it" : "they"} finished. Use "Record missing commissions" to fix it.`);
  if (warnings.nobodyCredited > 0)
    lines.push(`${plural(warnings.nobodyCredited, "completed booking")} in this range had nobody assigned, so no commission was earned.`);
  if (warnings.unpricedEntries > 0)
    lines.push(`${plural(warnings.unpricedEntries, "commission")} in this range include a service that had no final price. They are based on the priced services only.`);
  return lines;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function pesoRange(entries: { amountCentavos: number }[]): string {
  return formatPesos(entries.reduce((sum, e) => sum + e.amountCentavos, 0));
}

/** Which of the chosen entries can still change in the wanted direction. */
export function selectableIds(entries: { id: string; paidAt: string | null }[], paid: boolean): string[] {
  return entries.filter((e) => (paid ? e.paidAt === null : e.paidAt !== null)).map((e) => e.id);
}

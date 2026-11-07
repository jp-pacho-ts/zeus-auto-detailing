"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPesos } from "@/lib/commission";
import { addMonths } from "@/lib/expenses";
import type { AdminExpense, AdminExpenseCategory, AdminExpenseMonth } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { fieldClass } from "../bookings/use-admin-resource";
import { describeError } from "../team/team-panel";
import { CategoriesDialog, ExpenseFormDialog, ExpenseHistoryDialog } from "./expense-dialogs";
import { COMMISSIONS_HINT, commissionsLine, EXPENSES_EMPTY, EXPENSES_INTRO, EXPENSES_NO_MATCH, formatTotal, matchesExpenseSearch, monthLabel, owedNote, REMOVE_TEXT, shortMonth, stockLine, unpricedNote } from "./expenses-model";

const buttonClass = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

export function ExpensesPanel({ data, categories, query, thisMonth, setMonth, categoryId, setCategoryId, includeRemoved, setIncludeRemoved, reload, reloadCategories }: {
  data: AdminExpenseMonth; categories: AdminExpenseCategory[]; query: string; thisMonth: string; setMonth: (month: string) => void; categoryId: string; setCategoryId: (id: string) => void;
  includeRemoved: boolean; setIncludeRemoved: (on: boolean) => void; reload: () => unknown; reloadCategories: () => unknown;
}) {
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<AdminExpense | "new" | null>(null);
  const [removing, setRemoving] = React.useState<AdminExpense | null>(null);
  const [reason, setReason] = React.useState("");
  const [historyFor, setHistoryFor] = React.useState<AdminExpense | null>(null);
  const [managing, setManaging] = React.useState(false);
  const [older, setOlder] = React.useState<{ query: string; rows: AdminExpense[]; next: string | null } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const writing = React.useRef(false);

  // Older pages belong to one query and one load of the first page; anything else starts again from the first page.
  const extra = older && older.query === query ? older : null;
  const next = extra ? extra.next : data.nextCursor;
  const rows = [...data.expenses, ...(extra ? extra.rows : [])];
  const shown = rows.filter((e) => matchesExpenseSearch(e, search));

  async function done(message: string) {
    setOlder(null);
    await reload(); // the message appears with the fresh list, never above stale data
    setNotice(message);
  }
  async function run(work: () => Promise<string>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await done(await work());
      return true;
    } catch (e) {
      setError(describeError(e));
      if (e instanceof AdminRequestError && e.status === 409) await reload();
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function loadOlder() {
    if (!next) return;
    setBusy(true);
    try {
      const page = await adminRequest<AdminExpenseMonth>(`/api/admin/expenses?${query}&cursor=${next}`);
      setOlder({ query, rows: [...(extra ? extra.rows : []), ...page.expenses], next: page.nextCursor });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmRemove() {
    const target = removing;
    if (!target) return;
    // Removing twice changes nothing on the server, so a retry after a lost answer ends the same way.
    const ok = await run(async () => {
      await adminRequest(`/api/admin/expenses/${target.id}/remove`, { method: "POST", body: { expectedRevision: target.revision, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      return "The expense was removed. It is kept in history.";
    });
    if (ok) { setRemoving(null); setReason(""); }
  }
  const restore = (e: AdminExpense) =>
    run(async () => {
      await adminRequest(`/api/admin/expenses/${e.id}/restore`, { method: "POST", body: { expectedRevision: e.revision } });
      return "The expense is back.";
    });
  const go = (delta: number) => { setNotice(null); setError(null); setMonth(addMonths(data.month, delta)); };

  const notes = [unpricedNote(data.unpricedStockIns), owedNote(data.totals.commissionsOwed)].filter(Boolean);
  const peak = data.series.reduce((max, m) => { const v = BigInt(m.total); return v > max ? v : max; }, BigInt(0));

  return (
    <section aria-labelledby="expenses-heading" className="rounded border border-border bg-[#121214]">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 id="expenses-heading" className="text-base font-bold text-foreground">Expenses</h2>
          <p className="text-xs text-muted-foreground">{EXPENSES_INTRO}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setManaging(true)}>Categories</Button>
          <Button type="button" variant="gold" className="min-h-[44px]" onClick={() => { setError(null); setEditing("new"); }}>Add expense</Button>
        </div>
      </div>

      <div className="border-b border-border p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={buttonClass} aria-label="Previous month" onClick={() => go(-1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <div className="min-w-0 text-center">
            <p data-testid="expenses-month" className="text-sm font-bold text-foreground">{monthLabel(data.month)}</p>
            <p data-testid="expenses-total" className="break-words text-xl font-bold text-primary">{formatTotal(data.totals.total)}</p>
            <p className="text-xs text-muted-foreground">Typed expenses, stock bought and commissions paid.</p>
          </div>
          <button type="button" className={buttonClass} aria-label="Next month" disabled={data.month >= thisMonth} onClick={() => go(1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <ol aria-label="The last 12 months" className="mt-4 grid grid-cols-12 items-end gap-1">
          {data.series.map((m) => {
            const v = BigInt(m.total);
            const height = peak === BigInt(0) ? 0 : Number((v * BigInt(100)) / peak);
            return (
              <li key={m.month} title={`${monthLabel(m.month)}: ${formatTotal(m.total)}`} aria-label={`${monthLabel(m.month)}: ${formatTotal(m.total)}`} className="flex min-w-0 flex-col items-center gap-1">
                <span className="flex h-12 w-full items-end"><span className={`block w-full rounded-t ${m.month === data.month ? "bg-primary" : "bg-muted-foreground/40"}`} style={{ height: `${Math.max(height, v > BigInt(0) ? 4 : 0)}%` }} /></span>
                <span className="text-[10px] text-muted-foreground">{shortMonth(m.month)}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <ul aria-label="Added for you" className="divide-y divide-border border-b border-border">
        <li data-testid="expenses-stock" className="px-4 py-3 text-sm font-semibold text-foreground sm:px-6">{stockLine(data)}</li>
        <li data-testid="expenses-commissions" className="px-4 py-3 text-sm font-semibold text-foreground sm:px-6">
          {commissionsLine(data)}
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{COMMISSIONS_HINT}</span>
        </li>
        {notes.map((n) => <li key={n} data-testid="expenses-note" className="px-4 py-3 text-xs text-amber-300 sm:px-6">{n}</li>)}
      </ul>

      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-6">
        <label className="block text-xs font-semibold text-muted-foreground">Search
          <input className={fieldClass} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Who was paid or the note" autoComplete="off" />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Category
          <select className={fieldClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (hidden)"}</option>)}
          </select>
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm text-foreground">
          <input type="checkbox" className="h-5 w-5" checked={includeRemoved} onChange={(e) => setIncludeRemoved(e.target.checked)} />
          Show removed
        </label>
      </div>

      {notice && <p role="status" className="border-b border-border px-4 py-3 text-sm text-emerald-400 sm:px-6">{notice}</p>}
      {error && !editing && !removing && <p role="alert" className="border-b border-border px-4 py-3 text-sm text-rose-400 sm:px-6">{error}</p>}

      {rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">{EXPENSES_EMPTY}</p>
      ) : shown.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">{EXPENSES_NO_MATCH}</p>
      ) : (
        <ul aria-label="Typed expenses" className="divide-y divide-border">
          {shown.map((e) => (
            <li key={e.id} data-expense={e.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-foreground">
                  {formatPesos(e.amountCentavos)}
                  <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">{e.categoryName}</span>
                  {e.removed && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">Removed</span>}
                </p>
                <p className="break-words text-xs text-muted-foreground">{[e.expenseDate, e.payee, e.note].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={busy} onClick={() => setHistoryFor(e)}>History</button>
                {e.removed ? (
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => void restore(e)}>Restore</button>
                ) : (
                  <>
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => { setError(null); setEditing(e); }}>Edit</button>
                    <button type="button" className={`${buttonClass} text-rose-400`} disabled={busy} onClick={() => { setError(null); setReason(""); setRemoving(e); }}>Remove</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="border-t border-border p-4 text-center sm:p-6">
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void loadOlder()}>Show older</button>
        </div>
      )}

      {editing && <ExpenseFormDialog key={editing === "new" ? "new" : editing.id} target={editing === "new" ? editing : rows.find((e) => e.id === editing.id) ?? editing} month={data.month} thisMonth={thisMonth} categories={categories} onClose={() => setEditing(null)} onSaved={done} reload={reload} />}

      <Dialog open={removing !== null} onOpenChange={(o) => { if (!o && !busy) setRemoving(null); }}>
        <DialogHeader>
          <DialogTitle>Remove this expense?</DialogTitle>
          <DialogDescription>{REMOVE_TEXT}</DialogDescription>
        </DialogHeader>
        <label className="mt-4 block text-xs font-semibold text-muted-foreground">Reason (optional)
          <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoComplete="off" />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setRemoving(null)}>Keep it</Button>
          <Button type="button" variant="gold" className="min-h-[44px]" disabled={busy} onClick={() => void confirmRemove()}>{busy ? "Removing..." : "Remove"}</Button>
        </div>
      </Dialog>

      {historyFor && <ExpenseHistoryDialog expense={historyFor} onClose={() => setHistoryFor(null)} />}
      {managing && <CategoriesDialog categories={categories} onClose={() => setManaging(false)} reload={async () => { await reloadCategories(); await reload(); }} />}
    </section>
  );
}

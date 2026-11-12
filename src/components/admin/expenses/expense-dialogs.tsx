"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { centavosToPesosText, MIN_EXPENSE_DATE } from "@/lib/expenses";
import type { AdminExpense, AdminExpenseCategory, AdminExpenseEvent } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { shopDate } from "../bookings/model";
import { fieldClass } from "../bookings/use-admin-resource";
import { describeError } from "../team/team-panel";
import { historyLine } from "./expenses-model";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

// Add and Edit. The browser makes one id per form content: a retry after a lost response sends the same id, so the server records the expense once.
// Changing anything makes a new id. An edit sends every value, so a retry with the same values is recognised and changes nothing.
export function ExpenseFormDialog({ target, month, thisMonth, categories, onClose, onSaved, reload }: {
  target: AdminExpense | "new"; month: string; thisMonth: string; categories: AdminExpenseCategory[]; onClose: () => void; onSaved: (message: string) => Promise<unknown>; reload: () => unknown;
}) {
  const editing = target === "new" ? null : target;
  const today = shopDate();
  // The month being looked at, unless that is this month: then today.
  const [date, setDate] = React.useState(editing ? editing.expenseDate : month === thisMonth ? today : `${month}-01`);
  const [categoryId, setCategoryId] = React.useState(editing ? editing.categoryId : "");
  const [amount, setAmount] = React.useState(editing ? centavosToPesosText(editing.amountCentavos) : "");
  const [payee, setPayee] = React.useState(editing?.payee ?? "");
  const [note, setNote] = React.useState(editing?.note ?? "");
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const writing = React.useRef(false);
  const touch = () => setId(crypto.randomUUID());
  // A hidden category stays offered only for the expense already in it.
  const options = categories.filter((c) => c.isActive || c.id === editing?.categoryId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    const values = { date, categoryId, amountPesos: amount.trim(), ...(payee.trim() ? { payee: payee.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
    try {
      if (editing) await adminRequest(`/api/admin/expenses/${editing.id}`, { method: "PATCH", body: { expectedRevision: editing.revision, ...values } });
      else await adminRequest("/api/admin/expenses", { method: "POST", body: { id, ...values } });
      await onSaved(editing ? "The expense was changed." : "The expense was added.");
      onClose();
    } catch (err) {
      setError(describeError(err));
      if (err instanceof AdminRequestError && err.status === 409) await reload();
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit expense" : "Add expense"}</DialogTitle>
        <DialogDescription>Stock bought in Supplies and commissions paid are added for you. Do not type those here.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4">
        <label className="block text-xs font-semibold text-muted-foreground">Date
          <input className={fieldClass} type="date" value={date} min={MIN_EXPENSE_DATE} max={today} onChange={(e) => { setDate(e.target.value); touch(); }} required />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Category
          <select className={fieldClass} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); touch(); }} required>
            <option value="" disabled>Choose a category</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (hidden)"}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Amount, in pesos
          <input className={fieldClass} value={amount} onChange={(e) => { setAmount(e.target.value); touch(); }} inputMode="decimal" placeholder="For example 1250.50" required autoComplete="off" />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Who was paid (optional)
          <input className={fieldClass} value={payee} onChange={(e) => { setPayee(e.target.value); touch(); }} maxLength={80} autoComplete="off" />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Note (optional)
          <input className={fieldClass} value={note} onChange={(e) => { setNote(e.target.value); touch(); }} maxLength={200} autoComplete="off" />
        </label>
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Add expense"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// Every change to one expense, newest first: who, when, and the values as they were then.
export function ExpenseHistoryDialog({ expense, onClose }: { expense: AdminExpense; onClose: () => void }) {
  const [rows, setRows] = React.useState<AdminExpenseEvent[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    adminRequest<AdminExpenseEvent[]>(`/api/admin/expenses/${expense.id}/history`)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(describeError(e)); });
    return () => { cancelled = true; };
  }, [expense.id]);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogHeader>
        <DialogTitle>History of this expense</DialogTitle>
        <DialogDescription>Newest first. Nothing here can be changed.</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      {!rows && !error && <p className="mt-3 text-sm text-muted-foreground">Loading...</p>}
      <ul className="mt-4 divide-y divide-border">
        {rows?.map((h) => (
          <li key={h.seq} className="py-3">
            <p className="break-words text-sm font-semibold text-foreground">{historyLine(h)}</p>
            <p className="text-xs text-muted-foreground">{when(h.createdAt)} · {h.actorName}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" className="min-h-[44px]" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

// Add, rename and hide or show. A category is never deleted: past expenses keep pointing at it.
export function CategoriesDialog({ categories, onClose, reload }: { categories: AdminExpenseCategory[]; onClose: () => void; reload: () => Promise<unknown> }) {
  const [name, setName] = React.useState("");
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [renaming, setRenaming] = React.useState<{ category: AdminExpenseCategory; name: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const writing = React.useRef(false);

  async function run(work: () => Promise<string>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      await reload();
      setNotice(message);
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
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const typed = name.trim();
    const ok = await run(async () => {
      await adminRequest("/api/admin/expense-categories", { method: "POST", body: { id, name: typed } });
      return `${typed} was added.`;
    });
    if (ok) { setName(""); setId(crypto.randomUUID()); }
  }
  const patch = (c: AdminExpenseCategory, change: Record<string, unknown>, message: string) =>
    run(async () => {
      await adminRequest(`/api/admin/expense-categories/${c.id}`, { method: "PATCH", body: { expectedRevision: c.revision, ...change } });
      return message;
    });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogHeader>
        <DialogTitle>Categories</DialogTitle>
        <DialogDescription>Hide one you no longer use. Past expenses keep it, and it can come back.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(e) => void add(e)} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-40 text-xs font-semibold text-muted-foreground">New category
          <input className={fieldClass} value={name} onChange={(e) => { setName(e.target.value); setId(crypto.randomUUID()); }} maxLength={40} required autoComplete="off" />
        </label>
        <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy}>Add category</Button>
      </form>
      {notice && <p role="status" className="mt-3 text-sm text-emerald-400">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      <ul className="mt-4 divide-y divide-border">
        {categories.map((c) => (
          <li key={c.id} data-category={c.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
            {renaming?.category.id === c.id ? (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-end gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await patch(c, { name: renaming.name.trim() }, `Renamed to ${renaming.name.trim()}.`)) setRenaming(null);
                }}
              >
                <label className="min-w-0 flex-1 basis-32 text-xs font-semibold text-muted-foreground">New name for {c.name}
                  <input className={fieldClass} value={renaming.name} onChange={(e) => setRenaming({ category: c, name: e.target.value })} maxLength={40} required autoComplete="off" autoFocus />
                </label>
                <Button type="submit" variant="outline" className="min-h-[44px]" disabled={busy}>Save name</Button>
                <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setRenaming(null)}>Cancel</Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 break-words text-sm text-foreground">
                  {c.name}
                  {!c.isActive && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">Hidden</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} aria-label={`Rename ${c.name}`} onClick={() => setRenaming({ category: c, name: c.name })}>Rename</Button>
                  <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} aria-label={`${c.isActive ? "Hide" : "Show"} ${c.name}`} onClick={() => void patch(c, { isActive: !c.isActive }, c.isActive ? `${c.name} is hidden.` : `${c.name} is back.`)}>{c.isActive ? "Hide" : "Show"}</Button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

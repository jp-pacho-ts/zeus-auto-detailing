"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminSupplyItem, AdminSupplyList } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { fieldClass } from "../bookings/use-admin-resource";
import { describeError } from "../team/team-panel";
import { HistoryDialog } from "./history-dialog";
import { StockDialog } from "./stock-dialog";
import { badgeLabel, costLabel, matchesSearch, removeResult, removeWarning, SUPPLIES_EMPTY, SUPPLIES_INTRO, SUPPLIES_NO_MATCH, summaryLine } from "./supplies-model";

const buttonClass = "inline-flex min-h-[44px] items-center justify-center rounded border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const badgeClass = { Low: "border-amber-400/60 text-amber-300", Out: "border-rose-400/60 text-rose-300", OK: "border-emerald-400/50 text-emerald-300" } as const;

type Form = { name: string; category: string; unit: string; reorder: string; cost: string; start: string };
const EMPTY: Form = { name: "", category: "", unit: "", reorder: "0", cost: "0", start: "" };
const whole = (text: string) => (/^[0-9]+$/.test(text.trim()) ? Number(text.trim()) : null);

export function SuppliesPanel({ list, showArchived, setShowArchived, reload }: { list: AdminSupplyList; showArchived: boolean; setShowArchived: (on: boolean) => void; reload: () => unknown }) {
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<AdminSupplyItem | "new" | null>(null);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [formId, setFormId] = React.useState("");
  const [removing, setRemoving] = React.useState<AdminSupplyItem | null>(null);
  const [stockFor, setStockFor] = React.useState<{ item: AdminSupplyItem; kind: "RECEIVE" | "USE" } | null>(null);
  const [historyFor, setHistoryFor] = React.useState<AdminSupplyItem | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const writing = React.useRef(false);

  async function run(work: () => Promise<string | null>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      await reload(); // the message appears with the fresh list, never above stale data
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

  function open(target: AdminSupplyItem | "new") {
    setError(null);
    setFormId(crypto.randomUUID());
    setForm(target === "new" ? EMPTY : { name: target.name, category: target.category ?? "", unit: target.unit, reorder: String(target.reorderLevel), cost: (target.costPerUnitCentavos / 100).toFixed(2), start: "" });
    setEditing(target);
  }
  // A changed form is a new request; an unchanged retry after a lost response keeps its id and is recorded once.
  const change = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setFormId(crypto.randomUUID()); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const target = editing;
    if (!target) return;
    const reorder = whole(form.reorder), start = form.start.trim() === "" ? undefined : whole(form.start);
    if (reorder === null || start === null) { setError("Enter whole numbers for the reorder level and the starting stock."); return; }
    const ok = await run(async () => {
      if (target === "new") {
        await adminRequest("/api/admin/supplies", { method: "POST", body: { id: formId, name: form.name, ...(form.category.trim() ? { category: form.category } : {}), unit: form.unit, reorderLevel: reorder, costPesos: form.cost.trim(), ...(start !== undefined ? { startingStock: start } : {}) } });
        return `${form.name.trim()} was added.`;
      }
      await adminRequest(`/api/admin/supplies/${target.id}`, { method: "PATCH", body: { expectedRevision: target.revision, name: form.name, category: form.category.trim() ? form.category : null, unit: form.unit, reorderLevel: reorder, costPesos: form.cost.trim() } });
      return `${form.name.trim()} was updated.`;
    });
    if (ok) setEditing(null);
  }

  async function confirmRemove() {
    const target = removing;
    if (!target) return;
    const ok = await run(async () => {
      try {
        const result = await adminRequest<{ outcome: "DELETED" | "ARCHIVED" }>(`/api/admin/supplies/${target.id}/remove`, { method: "POST", body: { expectedRevision: target.revision } });
        return removeResult(result.outcome, target.name);
      } catch (e) {
        // The first try erased it and the answer was lost: "not found" on the retry means it is gone, which is what was asked.
        if (e instanceof AdminRequestError && e.status === 404) return removeResult("DELETED", target.name);
        throw e;
      }
    });
    if (ok) setRemoving(null);
  }

  const restore = (item: AdminSupplyItem) =>
    run(async () => {
      await adminRequest(`/api/admin/supplies/${item.id}/restore`, { method: "POST", body: { expectedRevision: item.revision } });
      return `${item.name} is back.`;
    });

  const shown = list.items.filter((i) => matchesSearch(i, query));
  const activeCount = list.items.filter((i) => i.isActive).length;

  return (
    <section aria-labelledby="supplies-heading" className="rounded border border-border bg-[#121214]">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 id="supplies-heading" className="text-base font-bold text-foreground">Supplies &amp; Inventory</h2>
          <p className="text-xs text-muted-foreground">{SUPPLIES_INTRO}</p>
        </div>
        <Button type="button" variant="gold" className="min-h-[44px]" onClick={() => open("new")}>Add item</Button>
      </div>

      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_auto] sm:items-end sm:p-6">
        <label className="block text-xs font-semibold text-muted-foreground">Search
          <input className={fieldClass} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or category" autoComplete="off" />
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm text-foreground">
          <input type="checkbox" className="h-5 w-5" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <p data-testid="supplies-summary" className="border-b border-border px-4 py-3 text-sm text-muted-foreground sm:px-6">{summaryLine(activeCount, list.lowOrOutCount)}</p>
      {notice && <p role="status" className="border-b border-border px-4 py-3 text-sm text-emerald-400 sm:px-6">{notice}</p>}
      {error && !editing && !removing && !stockFor && <p role="alert" className="border-b border-border px-4 py-3 text-sm text-rose-400 sm:px-6">{error}</p>}

      {list.items.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">{SUPPLIES_EMPTY}</p>
      ) : shown.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">{SUPPLIES_NO_MATCH}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((i) => {
            const badge = badgeLabel(i.status);
            return (
              <li key={i.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-foreground">
                    {i.name}
                    {badge && <span className={`ml-2 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${badgeClass[badge as keyof typeof badgeClass]}`}>{badge}</span>}
                    {!i.isActive && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">Archived</span>}
                  </p>
                  <p className="break-words text-xs text-muted-foreground">{i.category ? `${i.category} · ` : ""}{i.unit}</p>
                  <p className="text-xs text-muted-foreground">
                    In stock {i.currentStock} · {i.reorderLevel > 0 ? `Reorder at ${i.reorderLevel}` : "No reorder alert"} · {costLabel(i.costPerUnitCentavos)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {i.isActive ? (
                    <>
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => setStockFor({ item: i, kind: "RECEIVE" })} aria-label={`Stock in for ${i.name}`}>Stock in</button>
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => setStockFor({ item: i, kind: "USE" })} aria-label={`Used: ${i.name}`}>Used</button>
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => setHistoryFor(i)} aria-label={`History of ${i.name}`}>History</button>
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => open(i)} aria-label={`Edit ${i.name}`}>Edit</button>
                      <button type="button" className={`${buttonClass} text-rose-400`} disabled={busy} onClick={() => { setError(null); setRemoving(i); }} aria-label={`Delete ${i.name}`}>Delete</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => setHistoryFor(i)} aria-label={`History of ${i.name}`}>History</button>
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => void restore(i)} aria-label={`Restore ${i.name}`}>Restore</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o && !busy) setEditing(null); }}>
        <DialogHeader>
          <DialogTitle>{editing === "new" ? "Add item" : "Edit item"}</DialogTitle>
          <DialogDescription>Stock is changed with Stock in and Used, so every number has a history.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4">
          <label className="block text-xs font-semibold text-muted-foreground">Name
            <input className={fieldClass} value={form.name} onChange={(e) => change({ name: e.target.value })} required maxLength={80} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Category (optional)
            <input className={fieldClass} value={form.category} onChange={(e) => change({ category: e.target.value })} maxLength={60} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Unit (bottle, pcs, litre...)
            <input className={fieldClass} value={form.unit} onChange={(e) => change({ unit: e.target.value })} required maxLength={20} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Reorder level (0 means no alert)
            <input className={fieldClass} value={form.reorder} onChange={(e) => change({ reorder: e.target.value })} inputMode="numeric" required autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Cost of one unit, in pesos
            <input className={fieldClass} value={form.cost} onChange={(e) => change({ cost: e.target.value })} inputMode="decimal" required autoComplete="off" />
          </label>
          {editing === "new" && (
            <label className="block text-xs font-semibold text-muted-foreground">Starting stock (optional)
              <input className={fieldClass} value={form.start} onChange={(e) => change({ start: e.target.value })} inputMode="numeric" autoComplete="off" />
            </label>
          )}
          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy}>{busy ? "Saving..." : editing === "new" ? "Add item" : "Save changes"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => { if (!o && !busy) setRemoving(null); }}>
        <DialogHeader>
          <DialogTitle>Delete {removing?.name}?</DialogTitle>
          <DialogDescription>{removing ? removeWarning(removing) : ""}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setRemoving(null)}>Keep it</Button>
          <Button type="button" variant="gold" className="min-h-[44px]" disabled={busy} onClick={() => void confirmRemove()}>{busy ? "Deleting..." : "Delete"}</Button>
        </div>
      </Dialog>

      {stockFor && <StockDialog key={stockFor.item.id} item={stockFor.item} initialKind={stockFor.kind} onClose={() => setStockFor(null)} onSaved={async (message) => { await reload(); setNotice(message); }} />}
      {historyFor && <HistoryDialog item={historyFor} onClose={() => setHistoryFor(null)} />}
    </section>
  );
}

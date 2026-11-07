"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminSupplyItem } from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { fieldClass } from "../bookings/use-admin-resource";
import { describeError } from "../team/team-panel";
import { stockPreview } from "./supplies-model";

type Kind = "RECEIVE" | "USE";

// Stock in or used, and nothing else (there is no adjust). The browser makes one id per form content: a retry after a lost response sends
// the same id, so the server records the movement once. Changing anything in the form makes a new id.
export function StockDialog({ item, initialKind, onClose, onSaved }: { item: AdminSupplyItem; initialKind: Kind; onClose: () => void; onSaved: (message: string) => Promise<unknown> | unknown }) {
  const [kind, setKind] = React.useState<Kind>(initialKind);
  const [quantity, setQuantity] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [note, setNote] = React.useState("");
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const writing = React.useRef(false);
  const touch = () => setId(crypto.randomUUID());
  const qty = /^[0-9]+$/.test(quantity.trim()) ? Number(quantity.trim()) : Number.NaN;
  const preview = stockPreview(item, kind, qty);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (writing.current || preview.problem) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/supplies/${item.id}/stock`, { method: "POST", body: {
        id, expectedRevision: item.revision, kind, quantity: qty,
        ...(kind === "RECEIVE" && cost.trim() ? { unitCostPesos: cost.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) } });
      await onSaved(kind === "RECEIVE" ? `${qty} ${item.unit} added to ${item.name}.` : `${qty} ${item.unit} of ${item.name} recorded as used.`);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogHeader>
        <DialogTitle>{item.name}</DialogTitle>
        <DialogDescription>{item.currentStock} {item.unit} in stock now.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4">
        <div role="group" aria-label="What happened" className="grid grid-cols-2 gap-2">
          {([["RECEIVE", "Stock in"], ["USE", "Used"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} disabled={busy} onClick={() => { setKind(k); setCost(""); touch(); }}
              className={`min-h-[44px] rounded border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${kind === k ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-white/5"}`}>{label}</button>
          ))}
        </div>
        <label className="block text-xs font-semibold text-muted-foreground">How many ({item.unit})
          <input className={fieldClass} value={quantity} onChange={(e) => { setQuantity(e.target.value); touch(); }} inputMode="numeric" required autoComplete="off" />
        </label>
        {kind === "RECEIVE" && (
          <label className="block text-xs font-semibold text-muted-foreground">Price of one {item.unit} this time, in pesos (optional)
            <input className={fieldClass} value={cost} onChange={(e) => { setCost(e.target.value); touch(); }} inputMode="decimal" placeholder="For example 125.50" autoComplete="off" />
          </label>
        )}
        <label className="block text-xs font-semibold text-muted-foreground">Note (optional)
          <input className={fieldClass} value={note} onChange={(e) => { setNote(e.target.value); touch(); }} maxLength={200} placeholder={kind === "USE" ? "For example the job or who used it" : "For example the supplier"} autoComplete="off" />
        </label>
        <p role="status" aria-live="polite" className={`text-sm ${quantity.trim() && preview.problem ? "text-rose-400" : "text-muted-foreground"}`}>
          {quantity.trim() ? (preview.problem ?? `${preview.after} ${item.unit} left after this.`) : "Enter how many."}
        </p>
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy || preview.problem !== null}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

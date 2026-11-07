"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminSupplyItem, AdminSupplyMovement, AdminSupplyMovements } from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { describeError } from "../team/team-panel";
import { movementLine } from "./supplies-model";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

// Every change to the stock, newest first: who, when, how much, at what price and why. 50 at a time.
export function HistoryDialog({ item, onClose }: { item: AdminSupplyItem; onClose: () => void }) {
  const [rows, setRows] = React.useState<AdminSupplyMovement[]>([]);
  const [next, setNext] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminRequest<AdminSupplyMovements>(`/api/admin/supplies/${item.id}/movements${cursor ? `?cursor=${cursor}` : ""}`);
      setRows((prev) => (cursor ? [...prev, ...page.movements] : page.movements));
      setNext(page.nextCursor);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [item.id]);
  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(null); }); // after the render, as useKeptResource does
    return () => { cancelled = true; };
  }, [load]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogHeader>
        <DialogTitle>History of {item.name}</DialogTitle>
        <DialogDescription>Newest first. {item.currentStock} {item.unit} in stock now.</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Nothing has been recorded for this supply yet.</p>}
      <ul className="mt-4 divide-y divide-border">
        {rows.map((m) => (
          <li key={m.id} className="py-3">
            <p className="break-words text-sm font-semibold text-foreground">{movementLine(m)}</p>
            <p className="text-xs text-muted-foreground">{when(m.createdAt)} · {m.actorName}</p>
          </li>
        ))}
      </ul>
      {loading && <p className="mt-3 text-sm text-muted-foreground">Loading...</p>}
      <div className="mt-4 flex justify-end gap-2">
        {next && !loading && <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => void load(next)}>Show older</Button>}
        <Button type="button" variant="outline" className="min-h-[44px]" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

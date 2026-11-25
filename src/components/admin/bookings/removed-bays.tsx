"use client";
import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBay, AdminContainer } from "@/types/admin-contracts";
import { adminRequest } from "./client";
import { LoadState, Select } from "./use-admin-resource";
import { useKeptResource } from "../team/use-kept-resource";
import { useAdminWrite, WriteFeedback } from "../calendar/use-admin-write";

// 2026-11-24 (LE): bays are managed on the Bay board only. Add, rename, move and remove live on the board rows; this list brings a
// removed bay back. A bay whose container was removed has to move to a working container first (the server refuses otherwise).
export type RemovedBay = { bay: AdminBay; container: AdminContainer | null };

export function removedBays(bays: readonly AdminBay[], containers: readonly AdminContainer[]): RemovedBay[] {
  const order = (r: RemovedBay) => (r.container ? r.container.sortOrder : Number.MAX_SAFE_INTEGER);
  return bays
    .filter((bay) => !bay.isActive)
    .map((bay) => ({ bay, container: containers.find((c) => c.id === bay.containerId) ?? null }))
    .sort((a, b) => order(a) - order(b) || a.bay.sortOrder - b.bay.sortOrder);
}

// The board's containers and bays as one string: it changes when either does, so a bay or container removed on the board reloads this list.
type Versioned = { id: string; updatedAt: string };
export const boardBaysKey = (containers: readonly Versioned[], bays: readonly Versioned[]): string =>
  [containers, bays].map((list) => list.map((x) => x.id + "@" + x.updatedAt).join(",")).join("|");

function Row({ row, containers, busy, onBringBack, onMove }: {
  row: RemovedBay; containers: readonly AdminContainer[]; busy: boolean;
  onBringBack: (bay: AdminBay) => void; onMove: (bay: AdminBay, container: AdminContainer) => void;
}) {
  const { bay, container } = row;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-foreground">{bay.name}</span>
        <span className="block text-xs text-muted-foreground">{container ? container.name : "Its container was removed"}</span>
      </span>
      {container ? (
        <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => onBringBack(bay)}>
          Bring back {bay.name}
        </Button>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const target = containers.find((c) => c.id === String(new FormData(e.currentTarget).get("containerId")));
            if (target) onMove(bay, target);
          }}
        >
          <Select name="containerId" aria-label={`Move ${bay.name} to`}>
            {containers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button type="submit" variant="outline" className="min-h-[44px]" disabled={busy || !containers.length}>Move bay</Button>
        </form>
      )}
    </li>
  );
}

// `refresh` changes whenever the board's bays change, so a bay removed from its row menu shows up here.
export function RemovedBays({ refresh, onDone }: { refresh: unknown; onDone: (text: string) => Promise<unknown> }) {
  // Kept resources: the last answer stays on screen during a reload, so the open list and its focused button never unmount mid-save.
  const bays = useKeptResource<AdminBay[]>("/api/admin/bays");
  const containers = useKeptResource<AdminContainer[]>("/api/admin/bay-containers");
  const { busy, message, error, run } = useAdminWrite();
  const [open, setOpen] = React.useState(false);
  const first = React.useRef(true);
  const reloadBays = bays.reload, reloadContainers = containers.reload;
  React.useEffect(() => {
    if (first.current) {
      first.current = false; // the hooks above already loaded once
      return;
    }
    void reloadBays();
    void reloadContainers();
  }, [refresh, reloadBays, reloadContainers]);

  async function write(done: string, work: () => Promise<unknown>) {
    if (await run(done, work)) await onDone(done);
    await Promise.all([reloadBays(), reloadContainers()]);
  }
  const bringBack = (bay: AdminBay) =>
    void write(`${bay.name} is back in use.`, () => adminRequest(`/api/admin/bays/${bay.id}`, { method: "PATCH", body: { expectedUpdatedAt: bay.updatedAt, isActive: true } }));
  const move = (bay: AdminBay, container: AdminContainer) =>
    void write(`${bay.name} moved to ${container.name}.`, () =>
      adminRequest(`/api/admin/bays/${bay.id}/move`, { method: "POST", body: { expectedUpdatedAt: bay.updatedAt, containerId: container.id } }));

  const failed = bays.error ?? containers.error;
  if (failed) return <LoadState loading={false} error={failed} retry={() => void Promise.all([reloadBays(), reloadContainers()])} />;
  const rows = bays.data && containers.data ? removedBays(bays.data, containers.data) : [];
  if (!rows.length) return message || error ? <WriteFeedback message={message} error={error} /> : null;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group min-w-0 rounded-lg border border-border bg-panel">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        Removed bays ({rows.length})
      </summary>
      <div className="border-t border-border px-4 pb-3">
        <ul aria-label="Removed bays" className="divide-y divide-border/70">
          {rows.map((row) => (
            <Row key={row.bay.id + row.bay.updatedAt} row={row} containers={containers.data ?? []} busy={busy} onBringBack={bringBack} onMove={move} />
          ))}
        </ul>
        <WriteFeedback message={message} error={error} />
      </div>
    </details>
  );
}

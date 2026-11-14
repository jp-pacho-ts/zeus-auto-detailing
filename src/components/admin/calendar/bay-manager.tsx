"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AdminBay, AdminContainer } from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { fieldClass, LoadState, useAdminResource, Select } from "../bookings/use-admin-resource";
import { nextSortOrder } from "./calendar-model";
import { useAdminWrite, WriteFeedback } from "./use-admin-write";

// P1-20: ADMIN bay list over the existing audited routes (POST /api/admin/bays, PATCH
// /api/admin/bays/[id]). Remove = deactivate, so the bay's booking history is kept.
// P1-62 A2: the list follows the containers, not the old bay types. A bay left in a removed container gets a Move control: it cannot be brought
// back until it is in an active one.
function BayRow({ bay, busy, onPatch, moveTo, onMove }: {
  bay: AdminBay; busy: boolean; onPatch: (bay: AdminBay, change: Record<string, unknown>, done: string) => Promise<boolean>;
  moveTo?: readonly AdminContainer[]; onMove: (bay: AdminBay, container: AdminContainer) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <li className="min-w-0 space-y-3 rounded border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-words font-semibold">{bay.name}</span>
        {!bay.isActive && <span className="rounded border border-border px-2 py-0.5 text-xs font-bold uppercase text-muted-foreground">Removed</span>}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name")).trim();
          if (name && name !== bay.name) void onPatch(bay, { name }, `Renamed to ${name}.`);
        }}
      >
        <label className="min-w-0 flex-1 basis-40 text-xs">
          Bay name
          <input name="name" defaultValue={bay.name} required maxLength={40} className={fieldClass} aria-label={`New name for ${bay.name}`} />
        </label>
        <Button type="submit" variant="outline" className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere] text-left" disabled={busy}>
          Save name
        </Button>
      </form>
      {bay.isActive ? (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Remove {bay.name}? Cars can no longer be moved into it. Its booking history is kept.</span>
            <Button variant="destructive" disabled={busy} onClick={() => void onPatch(bay, { isActive: false }, `${bay.name} removed.`).then(() => setConfirming(false))}>
              Remove bay
            </Button>
            <Button variant="outline" className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere] text-left" onClick={() => setConfirming(false)}>
              Keep bay
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere] text-left" disabled={busy} onClick={() => setConfirming(true)}>
            Remove {bay.name}
          </Button>
        )
      ) : moveTo ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const target = moveTo.find((c) => c.id === String(new FormData(e.currentTarget).get("containerId")));
            if (target) void onMove(bay, target);
          }}
        >
          <label className="min-w-0 flex-1 basis-40 text-xs">
            Its container was removed. Move it to
            <Select name="containerId" aria-label={`Move ${bay.name} to`}>
              {moveTo.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
          <Button type="submit" variant="outline" disabled={busy}>Move bay</Button>
        </form>
      ) : (
        <Button variant="outline" className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere] text-left" disabled={busy} onClick={() => void onPatch(bay, { isActive: true }, `${bay.name} is back in use.`)}>
          Bring back {bay.name}
        </Button>
      )}
    </li>
  );
}

export function BayManager({ onChanged }: { onChanged?: () => unknown }) {
  const bays = useAdminResource<AdminBay[]>("/api/admin/bays");
  const containers = useAdminResource<AdminContainer[]>("/api/admin/bay-containers");
  const active = containers.data ?? [];
  const { busy, message, error, run } = useAdminWrite();
  const reloadList = bays.reload;
  const reload = async () => {
    await Promise.all([reloadList(), onChanged?.()]);
  };
  async function move(bay: AdminBay, container: AdminContainer) {
    const ok = await run(`${bay.name} moved to ${container.name}.`, () =>
      adminRequest(`/api/admin/bays/${bay.id}/move`, { method: "POST", body: { expectedUpdatedAt: bay.updatedAt, containerId: container.id } }),
    );
    await reload();
    return ok;
  }
  const inOrder = (own: AdminBay[]) => [...own].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder);
  const orphans = (bays.data ?? []).filter((b) => !active.some((c) => c.id === b.containerId));
  async function patch(bay: AdminBay, change: Record<string, unknown>, done: string) {
    const ok = await run(done, () => adminRequest(`/api/admin/bays/${bay.id}`, { method: "PATCH", body: { expectedUpdatedAt: bay.updatedAt, ...change } }));
    await reload();
    return ok;
  }
  return (
    <div className="space-y-6">
      <section aria-label="Add a bay" className="rounded border border-border bg-panel p-4">
        <h2 className="font-bold">Add a bay</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget, data = new FormData(form);
            const name = String(data.get("name")).trim();
            const ok = await run(`${name} added.`, () =>
              adminRequest("/api/admin/bays", { method: "POST", body: { name, containerId: String(data.get("containerId")), sortOrder: nextSortOrder(bays.data ?? []) } }),
            );
            if (ok) form.reset();
            await reload();
          }}
        >
          <label className="min-w-0 flex-1 basis-48 text-xs">
            Bay name
            <input name="name" required maxLength={40} placeholder="Wash bay 3" className={fieldClass} autoComplete="off" />
          </label>
          <label className="text-xs">
            Container
            <Select name="containerId">
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={busy || !bays.data || !active.length}>
            Add bay
          </Button>
        </form>
      </section>
      <WriteFeedback message={message} error={error} />
      <LoadState loading={bays.loading} error={bays.error} retry={bays.reload} />
      <LoadState loading={containers.loading} error={containers.error} retry={containers.reload} />
      {bays.data && containers.data && (
        <>
          {active.map((c) => {
            const own = inOrder(bays.data!.filter((b) => b.containerId === c.id));
            return (
              <section key={c.id} aria-label={c.name + " bays"} className="space-y-3">
                <h2 className="text-sm font-bold">
                  {c.name} ({own.filter((b) => b.isActive).length} in use)
                </h2>
                {own.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bays in {c.name} yet. Add one above.</p>
                ) : (
                  <ul className="grid gap-3 md:grid-cols-2">
                    {own.map((bay) => (
                      <BayRow key={bay.id + bay.updatedAt} bay={bay} busy={busy} onPatch={patch} onMove={move} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {orphans.length > 0 && (
            <section aria-label="Bays in a removed container" className="space-y-3">
              <h2 className="text-sm font-bold">Bays in a removed container</h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {inOrder(orphans).map((bay) => (
                  <BayRow key={bay.id + bay.updatedAt} bay={bay} busy={busy} onPatch={patch} moveTo={active} onMove={move} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

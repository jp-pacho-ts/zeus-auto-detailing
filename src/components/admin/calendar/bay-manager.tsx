"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AdminBay, BayType } from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { fieldClass, LoadState, useAdminResource } from "../bookings/use-admin-resource";
import { nextSortOrder } from "./calendar-model";
import { useAdminWrite, WriteFeedback } from "./use-admin-write";

// P1-20: ADMIN bay list over the existing audited routes (POST /api/admin/bays, PATCH
// /api/admin/bays/[id]). Remove = deactivate, so the bay's booking history is kept.
const TYPES: { value: BayType; label: string }[] = [
  { value: "WASH", label: "Wash" },
  { value: "DETAILING", label: "Detailing" },
  { value: "PAINT", label: "Paint" },
];

function BayRow({ bay, busy, onPatch }: { bay: AdminBay; busy: boolean; onPatch: (bay: AdminBay, change: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <li className="min-w-0 space-y-3 rounded border border-border bg-[#18181b] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-words font-semibold">{bay.name}</span>
        {!bay.isActive && <span className="rounded border border-border px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Removed</span>}
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
  const { busy, message, error, run } = useAdminWrite();
  const reloadList = bays.reload;
  const reload = async () => {
    await Promise.all([reloadList(), onChanged?.()]);
  };
  async function patch(bay: AdminBay, change: Record<string, unknown>, done: string) {
    const ok = await run(done, () => adminRequest(`/api/admin/bays/${bay.id}`, { method: "PATCH", body: { expectedUpdatedAt: bay.updatedAt, ...change } }));
    await reload();
    return ok;
  }
  return (
    <div className="space-y-6">
      <section aria-label="Add a bay" className="rounded border border-border bg-[#121214] p-4">
        <h2 className="font-bold">Add a bay</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget, data = new FormData(form);
            const name = String(data.get("name")).trim();
            const ok = await run(`${name} added.`, () =>
              adminRequest("/api/admin/bays", { method: "POST", body: { name, bayType: String(data.get("bayType")), sortOrder: nextSortOrder(bays.data ?? []) } }),
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
            Work done in this bay
            <select name="bayType" className={fieldClass} defaultValue="WASH">
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={busy || !bays.data}>
            Add bay
          </Button>
        </form>
      </section>
      <WriteFeedback message={message} error={error} />
      <LoadState loading={bays.loading} error={bays.error} retry={bays.reload} />
      {bays.data &&
        TYPES.map((t) => {
          const own = bays.data!.filter((b) => b.bayType === t.value).sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder);
          return (
            <section key={t.value} aria-label={t.label + " bays"} className="space-y-3">
              <h2 className="text-sm font-bold">
                {t.label} bays ({own.filter((b) => b.isActive).length} in use)
              </h2>
              {own.length === 0 ? (
                <p className="text-sm text-muted-foreground">No {t.label.toLowerCase()} bays yet. Add one above.</p>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {own.map((bay) => (
                    <BayRow key={bay.id + bay.updatedAt} bay={bay} busy={busy} onPatch={patch} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
    </div>
  );
}

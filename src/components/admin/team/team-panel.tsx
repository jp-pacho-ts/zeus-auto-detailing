"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { basisPointsToPercent } from "@/lib/commission";
import type { AdminTeam, AdminTeamPerson, AdminTeamRemoveOutcome } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { fieldClass } from "../bookings/use-admin-resource";
import { canManage, ratePhrase, removeResult, removeWarning } from "./team-model";

export function describeError(e: unknown): string {
  if (e instanceof AdminRequestError) {
    const field = Object.values(e.fieldErrors)[0]?.[0];
    return field ? `${e.message} ${field}` : e.message;
  }
  return "Could not save. Please retry.";
}

type Form = { name: string; phone: string; email: string; rate: string };
const EMPTY: Form = { name: "", phone: "", email: "", rate: "" };
const buttonClass = "inline-flex min-h-[44px] items-center justify-center rounded border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

export function TeamPanel({ team, reload }: { team: AdminTeam; reload: () => unknown }) {
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [editing, setEditing] = React.useState<AdminTeamPerson | "new" | null>(null);
  const [removing, setRemoving] = React.useState<AdminTeamPerson | null>(null);
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
      setNotice(message);
      await reload();
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

  function open(person: AdminTeamPerson | "new") {
    setError(null);
    setForm(person === "new" ? EMPTY : { name: person.name, phone: person.phone, email: person.email ?? "", rate: person.commissionRateBp === null ? "" : basisPointsToPercent(person.commissionRateBp) });
    setEditing(person);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const target = editing;
    if (!target) return;
    const rate = form.rate.trim();
    const ok = await run(async () => {
      if (target === "new") {
        await adminRequest("/api/admin/team", { method: "POST", body: {
          name: form.name, ...(form.phone.trim() ? { phone: form.phone } : {}), ...(form.email.trim() ? { email: form.email } : {}), ...(rate ? { ratePercent: rate } : {}) } });
        return `${form.name.trim()} was added to the team.`;
      }
      await adminRequest(`/api/admin/team/${target.id}`, { method: "PATCH", body: {
        expectedRevision: target.revision, name: form.name, ...(form.phone.trim() ? { phone: form.phone } : {}), ...(form.email.trim() ? { email: form.email } : {}), ratePercent: rate ? rate : null } });
      return `${form.name.trim()} was updated.`;
    });
    if (ok) setEditing(null);
  }

  const toggle = (p: AdminTeamPerson) =>
    run(async () => {
      await adminRequest(`/api/admin/team/${p.id}/active`, { method: "POST", body: { expectedRevision: p.revision, active: !p.isActive } });
      return p.isActive ? `${p.name} is now inactive and won't be assigned new jobs.` : `${p.name} is active again.`;
    });

  async function confirmRemove() {
    const p = removing;
    if (!p) return;
    const ok = await run(async () => {
      const result = await adminRequest<{ outcome: AdminTeamRemoveOutcome }>(`/api/admin/team/${p.id}/remove`, { method: "POST", body: { expectedRevision: p.revision } });
      return removeResult(result.outcome, p.name);
    });
    if (ok) setRemoving(null);
  }

  return (
    <section aria-labelledby="team-heading" className="rounded border border-border bg-[#121214]">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 id="team-heading" className="text-base font-bold text-foreground">Team</h2>
          <p className="text-xs text-muted-foreground">Add detailers, set their commission and take them off the schedule.</p>
        </div>
        <Button type="button" variant="gold" className="min-h-[44px]" onClick={() => open("new")}>Add detailer</Button>
      </div>
      {notice && <p role="status" className="border-b border-border px-4 py-3 text-sm text-emerald-400 sm:px-6">{notice}</p>}
      {error && !editing && !removing && <p role="alert" className="border-b border-border px-4 py-3 text-sm text-rose-400 sm:px-6">{error}</p>}
      {team.people.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No one is on the team yet. Add your first detailer to start tracking commissions.</p>
      ) : (
        <ul className="divide-y divide-border">
          {team.people.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-foreground">
                  {p.name}
                  {!p.isActive && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">Inactive</span>}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  {p.role === "DETAILER" ? "Detailer" : p.role === "MANAGER" ? "Manager" : "Admin"}
                  {p.phone ? ` · ${p.phone}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Commission {ratePhrase(p, team.defaultRateBp)}
                  {p.openJobs > 0 ? ` · ${p.openJobs} open ${p.openJobs === 1 ? "job" : "jobs"}` : ""}
                </p>
              </div>
              {canManage(p) ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => open(p)} aria-label={`Edit ${p.name}`}>Edit</button>
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => void toggle(p)} aria-label={`${p.isActive ? "Deactivate" : "Reactivate"} ${p.name}`}>{p.isActive ? "Deactivate" : "Reactivate"}</button>
                  <button type="button" className={`${buttonClass} text-rose-400`} disabled={busy} onClick={() => { setError(null); setRemoving(p); }} aria-label={`Remove ${p.name}`}>Remove</button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Sign-in accounts are managed by the shop owner.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o && !busy) setEditing(null); }}>
        <DialogHeader>
          <DialogTitle>{editing === "new" ? "Add detailer" : "Edit detailer"}</DialogTitle>
          <DialogDescription>Leave the commission empty to use the shop default of {basisPointsToPercent(team.defaultRateBp)}%.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4">
          <label className="block text-xs font-semibold text-muted-foreground">Full name
            <input className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Phone (optional)
            <input className={fieldClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" maxLength={30} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Email (optional)
            <input className={fieldClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" maxLength={254} autoComplete="off" />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Commission percent (optional)
            <input className={fieldClass} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} inputMode="decimal" placeholder="For example 12.5" autoComplete="off" />
          </label>
          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy}>{busy ? "Saving..." : editing === "new" ? "Add detailer" : "Save changes"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => { if (!o && !busy) setRemoving(null); }}>
        <DialogHeader>
          <DialogTitle>Remove {removing?.name}?</DialogTitle>
          <DialogDescription>{removing ? removeWarning(removing) : ""}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setRemoving(null)}>Keep on team</Button>
          <Button type="button" variant="gold" className="min-h-[44px]" disabled={busy || (removing?.openJobs ?? 0) > 0} onClick={() => void confirmRemove()}>{busy ? "Removing..." : "Remove"}</Button>
        </div>
      </Dialog>
    </section>
  );
}

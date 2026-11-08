"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { basisPointsToPercent, formatPesos } from "@/lib/commission";
import type {
  AdminStaffProfile,
  AdminTeam,
  AdminTeamPerson,
  AdminTeamPersonDetail,
  AdminTeamRemoveOutcome,
  AdminTeamRemovePreview,
} from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { fieldClass } from "../bookings/use-admin-resource";
import { ADD_STAFF, ratePhrase, removeResult, TEAM_EMPTY, TEAM_INTRO } from "./team-model";

export function describeError(e: unknown): string {
  if (e instanceof AdminRequestError) {
    const field = Object.values(e.fieldErrors)[0]?.[0];
    return field ? `${e.message} ${field}` : e.message;
  }
  return "Could not save. Please retry.";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type ProfileForm = {
  name: string;
  phone: string;
  rate: string;
  nickname: string;
  position: string;
  contactEmail: string;
  address: string;
  birthDate: string;
  hiredOn: string;
  emergencyName: string;
  emergencyPhone: string;
  notes: string;
};

const EMPTY_FORM: ProfileForm = {
  name: "",
  phone: "",
  rate: "",
  nickname: "",
  position: "",
  contactEmail: "",
  address: "",
  birthDate: "",
  hiredOn: "",
  emergencyName: "",
  emergencyPhone: "",
  notes: "",
};

const buttonClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

export function TeamPanel({ team, reload }: { team: AdminTeam; reload: () => unknown }) {
  const [form, setForm] = React.useState<ProfileForm>(EMPTY_FORM);
  const [editing, setEditing] = React.useState<AdminTeamPerson | "new" | null>(null);
  const [drawerLoading, setDrawerLoading] = React.useState(false);
  const [removing, setRemoving] = React.useState<AdminTeamPerson | null>(null);
  const [preview, setPreview] = React.useState<AdminTeamRemovePreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const writing = React.useRef(false);
  const clientId = React.useRef<string>("");

  async function run(work: () => Promise<string | null>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
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

  function openNew() {
    setError(null);
    clientId.current = crypto.randomUUID();
    setForm(EMPTY_FORM);
    setDrawerLoading(false);
    setEditing("new");
  }

  function openPerson(person: AdminTeamPerson) {
    setError(null);
    setEditing(person);
    setDrawerLoading(true);
    setForm({
      name: person.name,
      phone: person.phone,
      rate: person.commissionRateBp === null ? "" : basisPointsToPercent(person.commissionRateBp),
      nickname: person.nickname ?? "",
      position: person.position ?? "",
      contactEmail: "",
      address: "",
      birthDate: "",
      hiredOn: person.hiredOn ?? "",
      emergencyName: "",
      emergencyPhone: "",
      notes: "",
    });
    adminRequest<AdminTeamPersonDetail>(`/api/admin/team/${person.id}`)
      .then((data) => {
        setForm({
          name: data.person.name,
          phone: data.person.phone,
          rate: data.person.commissionRateBp === null ? "" : basisPointsToPercent(data.person.commissionRateBp),
          nickname: data.profile.nickname ?? "",
          position: data.profile.position ?? "",
          contactEmail: data.profile.contactEmail ?? "",
          address: data.profile.address ?? "",
          birthDate: data.profile.birthDate ?? "",
          hiredOn: data.profile.hiredOn ?? "",
          emergencyName: data.profile.emergencyName ?? "",
          emergencyPhone: data.profile.emergencyPhone ?? "",
          notes: data.profile.notes ?? "",
        });
      })
      .catch((e) => setError(describeError(e)))
      .finally(() => setDrawerLoading(false));
  }

  async function openRemove(person: AdminTeamPerson) {
    setError(null);
    setRemoving(person);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const data = await adminRequest<AdminTeamRemovePreview>(`/api/admin/team/${person.id}/remove-preview`);
      setPreview(data);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const target = editing;
    if (!target) return;
    const rate = form.rate.trim();
    const profilePayload: AdminStaffProfile = {
      nickname: form.nickname.trim() || null,
      position: form.position.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      address: form.address.trim() || null,
      birthDate: form.birthDate.trim() || null,
      hiredOn: form.hiredOn.trim() || null,
      emergencyName: form.emergencyName.trim() || null,
      emergencyPhone: form.emergencyPhone.trim() || null,
      notes: form.notes.trim() || null,
    };

    const ok = await run(async () => {
      if (target === "new") {
        await adminRequest("/api/admin/team", {
          method: "POST",
          body: {
            id: clientId.current,
            name: form.name.trim(),
            ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
            ...(rate ? { ratePercent: rate } : {}),
            profile: profilePayload,
          },
        });
        return `${form.name.trim()} was added to the team.`;
      }
      await adminRequest(`/api/admin/team/${target.id}`, {
        method: "PATCH",
        body: {
          expectedRevision: target.revision,
          name: form.name.trim(),
          phone: form.phone.trim(),
          ratePercent: rate ? rate : null,
          profile: profilePayload,
        },
      });
      return `${form.name.trim()} was updated.`;
    });
    if (ok) setEditing(null);
  }

  async function confirmRemove() {
    const p = removing;
    if (!p) return;
    const ok = await run(async () => {
      const result = await adminRequest<{ outcome: AdminTeamRemoveOutcome }>(`/api/admin/team/${p.id}/remove`, {
        method: "POST",
        body: { expectedRevision: p.revision },
      });
      return removeResult(result.outcome, p.name);
    });
    if (ok) {
      setRemoving(null);
      setEditing(null);
    }
  }

  return (
    <div className={editing ? "grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]" : ""}>
      <section aria-labelledby="team-heading" className="rounded border border-border bg-[#121214]">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 id="team-heading" className="text-base font-bold text-foreground">
              Team
            </h2>
            <p className="text-xs text-muted-foreground">{TEAM_INTRO}</p>
          </div>
          <Button type="button" variant="gold" className="min-h-[44px]" onClick={openNew}>
            {ADD_STAFF}
          </Button>
        </div>
        {notice && (
          <p role="status" className="border-b border-border px-4 py-3 text-sm text-emerald-400 sm:px-6">
            {notice}
          </p>
        )}
        {error && !editing && !removing && (
          <p role="alert" className="border-b border-border px-4 py-3 text-sm text-rose-400 sm:px-6">
            {error}
          </p>
        )}
        {team.people.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{TEAM_EMPTY}</p>
        ) : (
          <ul className="divide-y divide-border">
            {team.people.map((p) => {
              const isSelected = typeof editing === "object" && editing !== null && editing.id === p.id;
              return (
                <li
                  key={p.id}
                  className={`flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-6 ${
                    isSelected ? "bg-white/[0.04]" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-border bg-[#27272a] text-sm font-bold text-[#e8b44a]">
                      {getInitials(p.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-foreground">
                        {p.name}
                        {p.position && (
                          <span className="ml-2 inline-block rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {p.position}
                          </span>
                        )}
                      </p>
                      {p.phone && <p className="break-words text-xs text-muted-foreground">{p.phone}</p>}
                      <p className="text-xs text-muted-foreground">
                        {[
                          p.hiredOn ? `hired ${p.hiredOn}` : null,
                          `Commission ${ratePhrase(p, team.defaultRateBp)}`,
                          p.openJobs > 0 ? `${p.openJobs} open ${p.openJobs === 1 ? "job" : "jobs"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => openPerson(p)}
                      aria-label={`Open ${p.name}`}
                    >
                      Open
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing && (
        <aside
          aria-label={editing === "new" ? "New staff profile" : `${editing.name} profile`}
          className="rounded border border-border bg-[#121214] max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:overflow-y-auto max-lg:p-4"
        >
          <header className="flex items-center gap-3 border-b border-border p-4">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-border bg-[#27272a] text-sm font-bold text-[#e8b44a]">
              {editing === "new" ? "+" : getInitials(form.name || editing.name)}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-bold text-foreground">
                {editing === "new" ? "Add staff" : form.name || editing.name}
              </h3>
              {editing !== "new" && (
                <p className="truncate text-xs text-muted-foreground">
                  {form.nickname ? `"${form.nickname}"` : ""}
                  {form.nickname && form.position ? " · " : ""}
                  {form.position || ""}
                </p>
              )}
            </div>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => {
                if (!busy) setEditing(null);
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          <form onSubmit={(e) => void save(e)} className="space-y-4 p-4">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">About</h4>
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-muted-foreground">
                  Full name
                  <input
                    className={fieldClass}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    maxLength={80}
                    autoComplete="off"
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Nickname
                    <input
                      className={fieldClass}
                      value={form.nickname}
                      onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                      maxLength={40}
                      autoComplete="off"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Position
                    <input
                      className={fieldClass}
                      value={form.position}
                      onChange={(e) => setForm({ ...form, position: e.target.value })}
                      maxLength={40}
                      placeholder="Detailer, Washer, Tinter..."
                      list="team-position-suggestions"
                      autoComplete="off"
                    />
                    <datalist id="team-position-suggestions">
                      <option value="Detailer" />
                      <option value="Washer" />
                      <option value="Tinter" />
                    </datalist>
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Birth date
                    <input
                      type="date"
                      className={fieldClass}
                      value={form.birthDate}
                      onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Date hired
                    <input
                      type="date"
                      className={fieldClass}
                      value={form.hiredOn}
                      onChange={(e) => setForm({ ...form, hiredOn: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</h4>
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Phone (optional)
                    <input
                      type="tel"
                      className={fieldClass}
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      maxLength={30}
                      autoComplete="off"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Email
                    <input
                      type="email"
                      className={fieldClass}
                      value={form.contactEmail}
                      onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                      maxLength={120}
                      autoComplete="off"
                    />
                  </label>
                </div>
                <label className="block text-xs font-semibold text-muted-foreground">
                  Home address
                  <textarea
                    className={`${fieldClass} min-h-[70px] py-2`}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    maxLength={300}
                    autoComplete="off"
                  />
                </label>
              </div>
            </div>

            <fieldset aria-label="Emergency contact" className="border-t border-border pt-3">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Emergency contact
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-muted-foreground">
                  Name
                  <input
                    className={fieldClass}
                    value={form.emergencyName}
                    onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
                    maxLength={80}
                    autoComplete="off"
                  />
                </label>
                <label className="block text-xs font-semibold text-muted-foreground">
                  Phone
                  <input
                    type="tel"
                    className={fieldClass}
                    value={form.emergencyPhone}
                    onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
                    maxLength={30}
                    autoComplete="off"
                  />
                </label>
              </div>
            </fieldset>

            <div className="border-t border-border pt-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Commission
              </h4>
              <label className="block text-xs font-semibold text-muted-foreground">
                Commission percent (optional)
                <input
                  className={fieldClass}
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  inputMode="decimal"
                  placeholder={`Leave empty for shop default (${basisPointsToPercent(team.defaultRateBp)}%)`}
                  autoComplete="off"
                />
              </label>
            </div>

            <div className="border-t border-border pt-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</h4>
              <label className="block text-xs font-semibold text-muted-foreground">
                Notes
                <textarea
                  className={`${fieldClass} min-h-[70px] py-2`}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  maxLength={1000}
                  placeholder="Notes..."
                  autoComplete="off"
                />
              </label>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Only the admin can see this page. Nothing here is ever shown to customers.
            </p>

            {error && (
              <p role="alert" className="text-sm text-rose-400">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              {editing !== "new" ? (
                <button
                  type="button"
                  className={`${buttonClass} border-rose-950/60 text-rose-400 hover:bg-rose-950/20`}
                  disabled={busy || drawerLoading}
                  onClick={() => void openRemove(editing)}
                  aria-label={`Remove ${editing.name}`}
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy || drawerLoading}>
                  {busy ? "Saving..." : editing === "new" ? "Add staff" : "Save changes"}
                </Button>
              </div>
            </div>
          </form>
        </aside>
      )}

      <Dialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setRemoving(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>Remove {removing?.name}?</DialogTitle>
          <DialogDescription>
            They will disappear from the Team and from every list you pick staff from. Their past jobs and commissions
            keep their name. Their personal details (address, birth date, emergency contact, notes) are erased.
          </DialogDescription>
        </DialogHeader>

        {previewLoading ? (
          <p className="py-4 text-xs text-muted-foreground">Checking open jobs and unpaid commissions...</p>
        ) : preview ? (
          <ul className="my-3 space-y-2 text-xs text-muted-foreground">
            {preview.openJobs.length > 0 ? (
              <li>
                <span className="font-bold text-foreground">
                  {preview.openJobs.length} open {preview.openJobs.length === 1 ? "job" : "jobs"}
                </span>{" "}
                ({preview.openJobs.map((j) => j.referenceCode).join(", ")}): they will be taken off them and will not
                earn commission on them.
              </li>
            ) : (
              <li>
                <span className="font-bold text-foreground">No open jobs:</span> they are not on any open jobs.
              </li>
            )}
            <li>
              <span className="font-bold text-foreground">{formatPesos(preview.unpaidCentavos)} unpaid commission</span>{" "}
              for {preview.unpaidJobs} finished {preview.unpaidJobs === 1 ? "job" : "jobs"} stays. You can still mark it
              paid on the Commissions screen.
            </li>
          </ul>
        ) : null}

        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            disabled={busy || previewLoading}
            onClick={() => void confirmRemove()}
          >
            {busy ? "Removing..." : `Remove ${removing?.name ?? "staff"}`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

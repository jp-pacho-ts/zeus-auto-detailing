"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brandConfig } from "@/config/brand";
import type { AdminShopSettings } from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./bookings/client";
import { CapSettings } from "./bookings/cap-settings";
import { HoursManager } from "./calendar/hours-manager";
import { fieldClass, LoadState } from "./bookings/use-admin-resource";
import {
  bookingLine, BOOKING_INTRO, CONFIRM_MAINTENANCE, emailCounts, emailStatus, EMAIL_INTRO, LIMITS_INTRO, messageProblem, savedText, updateBody, websiteLine, WEBSITE_INTRO,
} from "./settings/settings-model";
import { describeError } from "./team/team-panel";
import { useKeptResource } from "./team/use-kept-resource";

const CARD = "rounded border border-border bg-[#121214] p-5";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: brandConfig.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function Choice({ label, options, value, disabled, onChoose }: { label: string; options: [string, string][]; value: string; disabled: boolean; onChoose: (value: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-1 rounded border border-border bg-[#09090b] p-1">
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} disabled={disabled} onClick={() => { if (value !== id) onChoose(id); }}
          className={`min-h-[44px] rounded px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${value === id ? "bg-[#18181b] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Card({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{intro}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

// Admin only: the server refuses everyone else, and this screen says so plainly first.
export function SettingsTab({ role, onChanged }: { role: UserRole; onChanged: () => unknown }) {
  const isAdmin = role === "ADMIN";
  const settings = useKeptResource<AdminShopSettings>(isAdmin ? "/api/admin/settings" : null);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<string | null>(null); // null: the message as saved
  const [limitsDay, setLimitsDay] = React.useState(today);
  const writing = React.useRef(false);

  if (!isAdmin) return <div className="rounded border border-border bg-[#121214] p-6 text-sm text-muted-foreground">Only an admin can change the settings.</div>;

  const current = settings.data;
  async function save(change: Parameters<typeof updateBody>[1]) {
    if (!current || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const after = await adminRequest<AdminShopSettings>("/api/admin/settings", { method: "PUT", body: updateBody(current, change) });
      setSaved(savedText(current, after));
      setDraft(null);
      await settings.reload();
      void onChanged();
    } catch (e) {
      setError(describeError(e));
      if (e instanceof AdminRequestError && e.status === 409) await settings.reload();
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const message = draft ?? current?.maintenanceMessage ?? "";
  const problem = messageProblem(message);
  return (
    <div className="space-y-4">
      <LoadState loading={settings.loading && !current} error={settings.error} retry={settings.reload} />
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {saved && <p role="status" className="text-sm text-foreground">{saved}</p>}
      {current && (
        <>
          <Card title="Website" intro={WEBSITE_INTRO}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-foreground">{websiteLine(current)}</p>
              <Choice label="Customer website" value={current.maintenance ? "ON" : "LIVE"} disabled={busy} options={[["LIVE", "Live"], ["ON", "Under maintenance"]]}
                onChoose={(v) => { if (v === "ON") setConfirming(true); else void save({ maintenance: false }); }} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (!problem) void save({ maintenanceMessage: message }); }}>
              <label className="text-xs text-muted-foreground">
                Message customers see (optional). The shop name and phone are always shown.
                <input value={message} onChange={(e) => setDraft(e.target.value)} className={fieldClass} />
              </label>
              {problem && <p role="alert" className="mt-1 text-xs text-rose-400">{problem}</p>}
              <Button className="mt-2" disabled={busy || Boolean(problem)}>Save message</Button>
            </form>
          </Card>

          <Card title="Online booking" intro={BOOKING_INTRO}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-foreground">{bookingLine(current)}</p>
              <Choice label="New bookings" value={current.bookingPaused || current.bookingPausedByServer ? "PAUSED" : "OPEN"} disabled={busy || current.bookingPausedByServer}
                options={[["OPEN", "Open"], ["PAUSED", "Paused"]]} onChoose={(v) => void save({ bookingPaused: v === "PAUSED" })} />
            </div>
          </Card>

          <HoursManager />

          <Card title="Daily limits" intro={LIMITS_INTRO}>
            <label className="block max-w-xs text-xs text-muted-foreground">
              Day to change
              <input type="date" value={limitsDay} onChange={(e) => { if (e.target.value) setLimitsDay(e.target.value); }} className={fieldClass} />
            </label>
            <CapSettings date={limitsDay} onChanged={() => undefined} />
          </Card>

          <Card title="Email" intro={EMAIL_INTRO}>
            <p className="text-sm text-foreground">{emailStatus(current)}</p>
            <p className="text-sm text-muted-foreground">{emailCounts(current)}</p>
          </Card>

          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogHeader>
              <DialogTitle>Turn on maintenance?</DialogTitle>
              <DialogDescription>{CONFIRM_MAINTENANCE}</DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button type="button" disabled={busy} onClick={() => { setConfirming(false); void save({ maintenance: true }); }}>Turn on maintenance</Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}

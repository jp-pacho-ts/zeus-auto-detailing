"use client";

import * as React from "react";
import {
  Globe,
  CalendarCheck2,
  Sliders,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brandConfig } from "@/config/brand";
import type { AdminBay, AdminShopSettings, EmailKind } from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./bookings/client";
import { CapSettings } from "./bookings/cap-settings";
import { BayManager } from "./calendar/bay-manager";
import { HoursManager } from "./calendar/hours-manager";
import { fieldClass, LoadState, Select, useAdminResource } from "./bookings/use-admin-resource";
import {
  bookingLine,
  BOOKING_INTRO,
  CONFIRM_MAINTENANCE,
  emailStatus,
  EMAIL_INTRO,
  LIMITS_INTRO,
  messageProblem,
  savedText,
  updateBody,
  websiteLine,
  WEBSITE_INTRO,
} from "./settings/settings-model";
import { describeError } from "./team/team-panel";
import { useKeptResource } from "./team/use-kept-resource";

const CARD_SHELL = "rounded-xl border border-border bg-panel p-5 sm:p-6 shadow-sm";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: brandConfig.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function Choice({
  label,
  options,
  value,
  disabled,
  onChoose,
}: {
  label: string;
  options: [string, string][];
  value: string;
  disabled: boolean;
  onChoose: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 gap-1 rounded-lg border border-border bg-background p-1 shadow-inner"
    >
      {options.map(([id, text]) => {
        const isSelected = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => {
              if (value !== id) onChoose(id);
            }}
            className={`min-h-[44px] min-w-[44px] rounded-md px-4 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
              isSelected
                ? "bg-raised text-foreground shadow-sm ring-1 ring-white/10"
                : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
            }`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

function SectionCard({
  id,
  icon: Icon,
  title,
  intro,
  danger = false,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  intro: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={id + "-title"}
      className={CARD_SHELL + " scroll-mt-40 lg:scroll-mt-24 outline-none" + (danger ? " border-rose-500/40" : "")}
    >
      <div className="flex items-start gap-3 border-b border-border/70 pb-4">
        <div className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-raised " + (danger ? "border-rose-500/40 text-rose-400" : "border-border text-primary")}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <h2 id={id + "-title"} className="text-base font-bold tracking-tight text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{intro}</p>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

// P1-77: the result of a save shows next to the section that saved it, not at the top of a long page.
function Feedback({ at, here, saved, error }: { at: string | null; here: string; saved: string | null; error: string | null }) {
  if (at !== here) return null;
  if (error)
    return (
      <p role="alert" className="flex items-center gap-2 text-xs font-medium text-rose-400">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  if (saved)
    return (
      <p role="status" className="flex items-center gap-2 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        {saved}
      </p>
    );
  return null;
}

const SECTIONS: [string, string][] = [
  ["settings-general", "General"],
  ["settings-hours", "Hours & closed days"],
  ["settings-limits", "Daily limits"],
  ["settings-email", "Email"],
  ["settings-bays", "Bays"],
  ["settings-danger", "Danger zone"],
];
// "6 bays · 1 removed": one line while the Bays section is closed.
export function baySummary(bays: AdminBay[] | null | undefined): string {
  if (!bays) return "Add, move or bring back bays.";
  const removed = bays.filter((b) => !b.isActive).length, working = bays.length - removed;
  return `${working} ${working === 1 ? "bay" : "bays"}` + (removed ? ` · ${removed} removed` : "");
}
const jump = (id: string) => {
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: "start" });
  target?.focus({ preventScroll: true });
};

const EMAIL_KINDS: [EmailKind, string, string][] = [
  ["confirmation", "Booking received", "Sent to the customer once, when they book."],
  ["reminder", "1-day reminder", "Sent to the customer once, the day before drop-off."],
  ["car_ready", "Car ready", "Sent to the customer once, when the car is finished on the board."],
  ["shop_alerts", "Shop alerts", "New booking and deposit proof alerts to the shop inbox."],
];

// Admin only: the server refuses everyone else, and this screen says so plainly first.
export function SettingsTab({ role, onChanged }: { role: UserRole; onChanged: () => unknown }) {
  const isAdmin = role === "ADMIN";
  const settings = useKeptResource<AdminShopSettings>(isAdmin ? "/api/admin/settings" : null);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [feedbackAt, setFeedbackAt] = React.useState<string | null>(null);
  // CEO 2026-11-14: Bays starts collapsed behind a one-line summary; a jump to Bays opens it.
  const [baysOpen, setBaysOpen] = React.useState(false);
  const bayList = useAdminResource<AdminBay[]>(isAdmin ? "/api/admin/bays" : null);
  const go = (id: string) => {
    if (id === "settings-bays") setBaysOpen(true);
    jump(id);
  };
  const [draft, setDraft] = React.useState<string | null>(null); // null: the message as saved
  const [limitsDay, setLimitsDay] = React.useState(today);
  const writing = React.useRef(false);

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-border bg-panel p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 mb-3">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-base font-bold text-foreground">Access Restricted</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          Only an admin can change the settings. Ask the shop owner if you need configuration adjustments.
        </p>
      </div>
    );
  }

  const current = settings.data;
  async function save(change: Parameters<typeof updateBody>[1], at: string) {
    if (!current || writing.current) return;
    writing.current = true;
    setFeedbackAt(at);
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const after = await adminRequest<AdminShopSettings>("/api/admin/settings", {
        method: "PUT",
        body: updateBody(current, change),
      });
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

  async function switchEmail(kind: EmailKind, enabled: boolean) {
    if (!current || writing.current) return;
    writing.current = true;
    setFeedbackAt("settings-email");
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await adminRequest<AdminShopSettings>("/api/admin/settings", {
        method: "PATCH",
        body: { expectedRevision: current.revision, kind, enabled },
      });
      setSaved(EMAIL_KINDS.find(([k]) => k === kind)![1] + (enabled ? " emails are on." : " emails are off."));
      await settings.reload();
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
  const paused = Boolean(current && (current.bookingPaused || current.bookingPausedByServer));
  const fb = { at: feedbackAt, saved, error };
  const chip = (tone: "ok" | "warn" | "bad" | "plain") =>
    "inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
    (tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : tone === "bad"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
          : "border-border bg-card text-foreground");
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold tracking-tight text-foreground">System Settings</h2>
      <LoadState loading={settings.loading && !current} error={settings.error} retry={settings.reload} />
      {current && (
        <>
          {/* P1-77: the one place status lives; each item jumps to its section. */}
          <nav aria-label="Settings summary" className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-2 bg-background/95 px-1 py-2">
            <button type="button" className={chip(current.maintenance ? "warn" : "ok")} onClick={() => go("settings-danger")}>
              Site: {current.maintenance ? "Under maintenance" : "Live"}
            </button>
            <button type="button" className={chip(paused ? "warn" : "ok")} onClick={() => go("settings-general")}>
              Online booking: {paused ? "Paused" : "Open"}
            </button>
            <button type="button" className={chip(current.email.configured ? "ok" : "warn")} onClick={() => go("settings-email")}>
              Email: {current.email.configured ? "Set up" : "Not set up"}
            </button>
            <button type="button" className={chip(current.email.failedLast7Days > 0 ? "bad" : "plain")} onClick={() => go("settings-email")}>
              Failed emails, 7 days: {current.email.failedLast7Days}
            </button>
          </nav>

          <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
            <nav aria-label="Settings sections" className="hidden lg:block">
              <ul className="sticky top-20 space-y-1">
                {SECTIONS.map(([id, label]) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => go(id)}
                      className="flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-sm text-muted-foreground hover:bg-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0 space-y-6">
              <label className="block text-xs font-semibold text-muted-foreground lg:hidden">
                Section
                <Select value="" onChange={(e) => e.target.value && go(e.target.value)}>
                  <option value="" disabled>
                    Jump to a section…
                  </option>
                  {SECTIONS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>

              <SectionCard id="settings-general" icon={CalendarCheck2} title="General" intro={BOOKING_INTRO}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Online booking</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{bookingLine(current)}</p>
                  </div>
                  <Choice
                    label="New bookings"
                    value={paused ? "PAUSED" : "OPEN"}
                    disabled={busy || current.bookingPausedByServer}
                    options={[
                      ["OPEN", "Open"],
                      ["PAUSED", "Paused"],
                    ]}
                    onChoose={(v) => void save({ bookingPaused: v === "PAUSED" }, "settings-general")}
                  />
                </div>
                <Feedback here="settings-general" {...fb} />
              </SectionCard>

              <div id="settings-hours" tabIndex={-1} className="scroll-mt-40 outline-none lg:scroll-mt-24">
                <HoursManager />
              </div>

              <SectionCard id="settings-limits" icon={Sliders} title="Daily limits" intro={LIMITS_INTRO}>
                <CapSettings date={limitsDay} onDateChange={setLimitsDay} onChanged={() => undefined} />
              </SectionCard>

              <SectionCard id="settings-email" icon={Mail} title="Email" intro={EMAIL_INTRO}>
                <p className="text-sm text-foreground">{emailStatus(current)}</p>
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 pb-2">
                    <h3 className="text-sm font-semibold text-foreground">Which emails go out</h3>
                    <p className="text-xs text-muted-foreground">
                      Last 7 days:{" "}
                      <span className={current.email.failedLast7Days > 0 ? "font-semibold text-rose-400" : "font-semibold text-foreground"}>
                        {current.email.failedLast7Days} failed
                      </span>{" "}
                      · <span className="font-semibold text-foreground">{current.email.waitingLast7Days} waiting</span>
                    </p>
                  </div>
                  <div className="divide-y divide-border/70">
                    {EMAIL_KINDS.map(([kind, label, hint]) => (
                      <div key={kind} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
                        </div>
                        <Choice
                          label={label + " emails"}
                          options={[["on", "On"], ["off", "Off"]]}
                          value={current.emails[kind] ? "on" : "off"}
                          disabled={busy}
                          onChoose={(v) => void switchEmail(kind, v === "on")}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <Feedback here="settings-email" {...fb} />
              </SectionCard>

              <SectionCard id="settings-bays" icon={Warehouse} title="Bays" intro="Add a bay, move it to another container, or bring back a removed one. The Bay board shows the working bays.">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-foreground">{baySummary(bayList.data)}</p>
                  <Button
                    type="button"
                    variant="outline"
                    aria-expanded={baysOpen}
                    aria-controls="settings-bays-panel"
                    onClick={() => setBaysOpen((open) => !open)}
                  >
                    {baysOpen ? "Hide bays" : "Show bays"}
                  </Button>
                </div>
                {baysOpen && (
                  <div id="settings-bays-panel">
                    <BayManager onChanged={() => void bayList.reload()} />
                  </div>
                )}
              </SectionCard>

              <SectionCard id="settings-danger" icon={Globe} title="Danger zone" intro={WEBSITE_INTRO} danger>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Customer website</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{websiteLine(current)}</p>
                  </div>
                  <Choice
                    label="Customer website"
                    value={current.maintenance ? "ON" : "LIVE"}
                    disabled={busy}
                    options={[
                      ["LIVE", "Live"],
                      ["ON", "Under maintenance"],
                    ]}
                    onChoose={(v) => {
                      if (v === "ON") setConfirming(true);
                      else void save({ maintenance: false }, "settings-danger");
                    }}
                  />
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!problem) void save({ maintenanceMessage: message }, "settings-danger");
                  }}
                  className="space-y-2 border-t border-border/70 pt-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="maintenance-message-input" className="text-xs font-semibold text-foreground">
                      Message customers see during maintenance (optional). The shop name and phone are always shown.
                    </label>
                    <span className={`text-xs font-mono ${message.length > 200 ? "font-bold text-rose-400" : "text-muted-foreground"}`}>
                      {message.length} / 200
                    </span>
                  </div>
                  <input
                    id="maintenance-message-input"
                    value={message}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="e.g. Scheduled system upgrade in progress. Back shortly!"
                    className={fieldClass}
                  />
                  {problem && (
                    <p role="alert" className="text-xs font-medium text-rose-400">
                      {problem}
                    </p>
                  )}
                  <div className="flex justify-end pt-1">
                    <Button type="submit" variant="outline" disabled={busy || Boolean(problem)}>
                      Save message
                    </Button>
                  </div>
                </form>
                <Feedback here="settings-danger" {...fb} />
              </SectionCard>
            </div>
          </div>

          {/* Maintenance Mode Confirmation Dialog */}
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogHeader>
              <DialogTitle>Turn on maintenance?</DialogTitle>
              <DialogDescription>{CONFIRM_MAINTENANCE}</DialogDescription>
            </DialogHeader>
            <div className="mt-5 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] min-w-[44px]"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="gold"
                className="min-h-[44px] min-w-[44px]"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  void save({ maintenance: true }, "settings-danger");
                }}
              >
                Turn on maintenance
              </Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}

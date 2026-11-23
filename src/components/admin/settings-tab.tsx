"use client";

import * as React from "react";
import { Globe, Gauge, Sliders, Mail, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brandConfig } from "@/config/brand";
import type { AdminShopSettings, EmailKind } from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./bookings/client";
import { CapSettings } from "./bookings/cap-settings";
import { HoursManager } from "./calendar/hours-manager";
import { fieldClass, LoadState } from "./bookings/use-admin-resource";
import { SectionCard } from "./settings/section-card";
import {
  bookingLine,
  BOOKING_INTRO,
  CONFIRM_MAINTENANCE,
  emailStatus,
  EMAIL_INTRO,
  LIMITS_INTRO,
  messageProblem,
  overviewRows,
  savedText,
  sectionFromSearch,
  settingsUrl,
  SETTINGS_SECTIONS,
  type SettingsSection,
  updateBody,
  websiteLine,
  WEBSITE_INTRO,
} from "./settings/settings-model";
import { describeError } from "./team/team-panel";
import { useKeptResource } from "./team/use-kept-resource";

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
      className="inline-flex shrink-0 gap-1 self-start rounded-lg border border-border bg-background p-1 shadow-inner sm:self-auto"
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
            className={`min-h-[44px] min-w-[44px] rounded-md px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
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

// P1-77: the result of a save shows next to the section that saved it.
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

const noSubscribe = () => () => {};
const TONE = { ok: "text-foreground", warn: "text-amber-400", bad: "text-rose-400" } as const;
const DOT = { ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400" } as const;

const EMAIL_KINDS: [EmailKind, string, string][] = [
  ["confirmation", "Booking received", "Sent to the customer once, when they book."],
  ["reminder", "1-day reminder", "Sent to the customer once, the day before drop-off."],
  ["car_ready", "Car ready", "Sent to the customer once, when the car is finished on the board."],
  ["shop_alerts", "Shop alerts", "New booking and deposit proof alerts to the shop inbox."],
];

// Admin only: the server refuses everyone else, and this screen says so plainly first.
// 2026-11-24: side tabs. One section on screen at a time, Overview first; the choice lives in ?section=.
export function SettingsTab({ role, onChanged }: { role: UserRole; onChanged: () => unknown }) {
  const isAdmin = role === "ADMIN";
  const settings = useKeptResource<AdminShopSettings>(isAdmin ? "/api/admin/settings" : null);
  // The link decides the first section (the server render has no URL, so Overview); a click then takes over.
  const search = React.useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const [picked, setPicked] = React.useState<SettingsSection | null>(null);
  const section = picked ?? sectionFromSearch(search);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [feedbackAt, setFeedbackAt] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<string | null>(null); // null: the message as saved
  const [limitsDay, setLimitsDay] = React.useState(today);
  const writing = React.useRef(false);
  const panel = React.useRef<HTMLDivElement>(null);
  const moved = React.useRef(false);

  React.useEffect(() => {
    // Only a choice moves focus; the first render leaves it where the portal put it.
    if (!moved.current) return;
    moved.current = false;
    document.getElementById("admin-content")?.scrollTo({ top: 0 });
    panel.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true }); // the chosen section's heading names it
  }, [section]);
  const choose = (id: SettingsSection) => {
    window.history.replaceState(null, "", settingsUrl(window.location.pathname, window.location.search, id));
    moved.current = true;
    setPicked(id);
  };

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-border bg-panel p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-base font-bold text-foreground">Access Restricted</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
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
  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,48rem)] lg:items-start lg:gap-10">
      {/* Phones: the list wraps into rows of chips (nothing in the admin scrolls sideways). */}
      <nav aria-label="Settings sections" className="mb-5 lg:sticky lg:top-0 lg:mb-0">
        <ul className="flex flex-wrap gap-2 lg:block lg:space-y-1">
          {SETTINGS_SECTIONS.map(([id, label]) => {
            const chosen = section === id, danger = id === "danger";
            return (
              <li key={id} className={danger ? "lg:mt-3 lg:border-t lg:border-border/70 lg:pt-3" : undefined}>
                <button
                  type="button"
                  aria-current={chosen ? "page" : undefined}
                  onClick={() => choose(id)}
                  className={`flex min-h-[44px] w-full items-center whitespace-nowrap rounded-md border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:border-transparent ${
                    chosen
                      ? danger
                        ? "border-rose-500/30 bg-rose-500/10 font-semibold text-rose-400 lg:border-rose-500/30"
                        : "border-primary/25 bg-primary/10 font-semibold text-primary lg:border-primary/25"
                      : danger
                        ? "border-border text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-400"
                        : "border-border text-muted-foreground hover:bg-card hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div ref={panel} className="min-w-0 space-y-6">
        {section === "hours" ? (
          <HoursManager />
        ) : section === "limits" ? (
          <SectionCard id="settings-limits" icon={Sliders} title="Daily limits" intro={LIMITS_INTRO}>
            <CapSettings date={limitsDay} onDateChange={setLimitsDay} onChanged={() => undefined} />
          </SectionCard>
        ) : (
          <>
            <LoadState loading={settings.loading && !current} error={settings.error} retry={settings.reload} />
            {current && section === "overview" && (
              <SectionCard id="settings-overview" icon={Gauge} title="Overview" intro={BOOKING_INTRO}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
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
                    onChoose={(v) => void save({ bookingPaused: v === "PAUSED" }, "settings-overview")}
                  />
                </div>
                <Feedback here="settings-overview" {...fb} />
                <dl className="divide-y divide-border/70 border-t border-border/70">
                  {overviewRows(current).map((row) => (
                    <div key={row.label} className="flex min-h-[52px] items-center justify-between gap-3 py-1.5">
                      <dt className="text-sm text-muted-foreground">{row.label}</dt>
                      <dd className="flex items-center gap-2">
                        <span className={"flex items-center gap-2 text-sm font-semibold " + TONE[row.tone]}>
                          <span aria-hidden="true" className={"h-2 w-2 rounded-full " + DOT[row.tone]} />
                          {row.value}
                        </span>
                        {row.section && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-[44px] text-muted-foreground"
                            aria-label={`Open ${SETTINGS_SECTIONS.find(([s]) => s === row.section)![1]} for ${row.label}`}
                            onClick={() => choose(row.section!)}
                          >
                            View
                          </Button>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </SectionCard>
            )}

            {current && section === "email" && (
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
                        <div className="min-w-0">
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
            )}

            {current && section === "danger" && (
              <SectionCard id="settings-danger" icon={Globe} title="Danger zone" intro={WEBSITE_INTRO} danger>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
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
                  <div className="flex items-start justify-between gap-3">
                    <label htmlFor="maintenance-message-input" className="text-xs font-semibold text-foreground">
                      Message customers see during maintenance (optional). The shop name and phone are always shown.
                    </label>
                    <span className={`shrink-0 text-xs tabular-nums ${message.length > 200 ? "font-bold text-rose-400" : "text-muted-foreground"}`}>
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
            )}
          </>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogHeader>
          <DialogTitle>Turn on maintenance?</DialogTitle>
          <DialogDescription>{CONFIRM_MAINTENANCE}</DialogDescription>
        </DialogHeader>
        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="outline" className="min-h-[44px] min-w-[44px]" onClick={() => setConfirming(false)}>
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
    </div>
  );
}

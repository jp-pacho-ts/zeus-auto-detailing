"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brandConfig } from "@/config/brand";
import type { AdminShopSettings, EmailKind } from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./bookings/client";
import { CapSettings } from "./bookings/cap-settings";
import { HoursManager } from "./calendar/hours-manager";
import { fieldClass, LoadState } from "./bookings/use-admin-resource";
import { SettingsCard, SettingsHeader } from "./settings/section-card";
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
const SECTION_TITLE = Object.fromEntries(SETTINGS_SECTIONS) as Record<SettingsSection, string>;
const SECTION_INTRO: Record<SettingsSection, string> = {
  overview: "How the shop is running right now.",
  hours: "When customers can book, and the days the shop is shut.",
  limits: LIMITS_INTRO,
  email: EMAIL_INTRO,
  danger: "Changes here affect every customer at once.",
};
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
  // The footer strip shows a save's result where that card saved, and its usual note otherwise.
  const footer = (here: string, note: React.ReactNode) => (feedbackAt === here && (saved || error) ? <Feedback at={feedbackAt} here={here} saved={saved} error={error} /> : note);
  // Wide screens: the list and the section sit centred together, so the spare width is even on both sides.
  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,56rem)] lg:items-start lg:justify-center lg:gap-10">
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

      <div ref={panel} className="min-w-0">
        <SettingsHeader id={"settings-" + section} title={SECTION_TITLE[section]} intro={SECTION_INTRO[section]} />
        <div id={"settings-" + section} className="space-y-6">
          {section === "hours" ? (
            <HoursManager />
          ) : section === "limits" ? (
            <SettingsCard title="Limits per line of work" hint="Leave a limit blank for no limit. A limit never goes below what is already booked.">
              <CapSettings date={limitsDay} onDateChange={setLimitsDay} onChanged={() => undefined} />
            </SettingsCard>
          ) : (
            <>
              <LoadState loading={settings.loading && !current} error={settings.error} retry={settings.reload} />
              {current && section === "overview" && (
                <>
                  <SettingsCard
                    title="Online booking"
                    description={bookingLine(current)}
                    hint={footer("settings-overview", BOOKING_INTRO)}
                  >
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
                  </SettingsCard>

                  <SettingsCard title="Shop status" description="What customers see and whether emails reach them." hint="Each line opens the section where it is changed.">
                    <dl className="-my-1 divide-y divide-border/70">
                      {overviewRows(current).map((row) => (
                        <div key={row.label} className="flex min-h-[52px] items-center justify-between gap-3 py-1">
                          <dt className="text-sm text-muted-foreground">{row.label}</dt>
                          <dd className="flex items-center gap-1">
                            <span className={"flex items-center gap-2 text-sm font-semibold " + TONE[row.tone]}>
                              <span aria-hidden="true" className={"h-2 w-2 rounded-full " + DOT[row.tone]} />
                              {row.value}
                            </span>
                            {row.section && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="min-h-[44px] gap-1 text-muted-foreground"
                                aria-label={`Open ${SECTION_TITLE[row.section]} for ${row.label}`}
                                onClick={() => choose(row.section!)}
                              >
                                Manage
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </SettingsCard>
                </>
              )}

              {current && section === "email" && (
                <>
                  <SettingsCard
                    title="Email delivery"
                    description={emailStatus(current)}
                    hint={
                      <>
                        Last 7 days:{" "}
                        <span className={current.email.failedLast7Days > 0 ? "font-semibold text-rose-400" : "font-semibold text-foreground"}>
                          {current.email.failedLast7Days} failed
                        </span>{" "}
                        · <span className="font-semibold text-foreground">{current.email.waitingLast7Days} waiting</span>
                      </>
                    }
                  />
                  <SettingsCard title="Which emails go out" description="Each email can be switched off on its own." hint={footer("settings-email", "A change applies to the next email of that kind.")}>
                    <div className="-my-3 divide-y divide-border/70">
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
                  </SettingsCard>
                </>
              )}

              {current && section === "danger" && (
                <>
                  <SettingsCard
                    title="Maintenance message"
                    description="Shown to customers while the site is under maintenance. The shop name and phone are always shown."
                    hint={
                      footer(
                        "settings-danger-message",
                        <span className={message.length > 200 ? "font-bold text-rose-400" : undefined}>{message.length} / 200 characters</span>,
                      )
                    }
                    action={
                      <Button type="submit" form="maintenance-message-form" variant="outline" className="min-h-[44px]" disabled={busy || Boolean(problem)}>
                        Save message
                      </Button>
                    }
                  >
                    <form
                      id="maintenance-message-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!problem) void save({ maintenanceMessage: message }, "settings-danger-message");
                      }}
                      className="space-y-2"
                    >
                      <label htmlFor="maintenance-message-input" className="sr-only">
                        Message customers see during maintenance (optional)
                      </label>
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
                    </form>
                  </SettingsCard>

                  <SettingsCard
                    danger
                    title="Customer website"
                    description={websiteLine(current)}
                    hint={footer("settings-danger", WEBSITE_INTRO)}
                  >
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
                  </SettingsCard>
                </>
              )}
            </>
          )}
        </div>
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

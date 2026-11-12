"use client";

import * as React from "react";
import {
  Globe,
  CalendarCheck2,
  Sliders,
  Mail,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Server,
  Lock,
} from "lucide-react";
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
  bookingLine,
  BOOKING_INTRO,
  CONFIRM_MAINTENANCE,
  emailCounts,
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
  icon: Icon,
  title,
  intro,
  badge,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  intro: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD_SHELL}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-raised text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{intro}</p>
          </div>
        </div>
        {badge && <div className="shrink-0 sm:self-center">{badge}</div>}
      </div>
      <div className="mt-5 space-y-4">{children}</div>
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
  async function save(change: Parameters<typeof updateBody>[1]) {
    if (!current || writing.current) return;
    writing.current = true;
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

  const message = draft ?? current?.maintenanceMessage ?? "";
  const problem = messageProblem(message);

  return (
    <div className="space-y-6">
      {/* Top Header & System Overview */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">System Settings</h2>
        </div>
        {current && (
          <div className="flex items-center gap-2">
            {current.maintenance ? (
              <span
                role="status"
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400"
              >
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Storefront Offline (Maintenance)
              </span>
            ) : (
              <span
                role="status"
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                Storefront Live
              </span>
            )}
          </div>
        )}
      </div>

      <LoadState loading={settings.loading && !current} error={settings.error} retry={settings.reload} />

      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {saved && (
        <div role="status" className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{saved}</span>
        </div>
      )}

      {current && (
        <div className="space-y-6">
          {/* Section 1: Customer Website & Maintenance Mode */}
          <SectionCard
            icon={Globe}
            title="Website"
            intro={WEBSITE_INTRO}
            badge={
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  current.maintenance
                    ? "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {current.maintenance ? "Maintenance Mode" : "Public Site Live"}
              </span>
            }
          >
            <div className="flex flex-col gap-4 rounded-lg border border-border/80 bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground">Storefront Status</p>
                <p className="text-xs text-muted-foreground mt-0.5">{websiteLine(current)}</p>
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
                  else void save({ maintenance: false });
                }}
              />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!problem) void save({ maintenanceMessage: message });
              }}
              className="space-y-2 rounded-lg border border-border/80 bg-panel p-4"
            >
              <div className="flex items-center justify-between">
                <label htmlFor="maintenance-message-input" className="text-xs font-semibold text-foreground">
                  Message customers see (optional). The shop name and phone are always shown.
                </label>
                <span className={`text-xs font-mono ${message.length > 200 ? "text-rose-400 font-bold" : "text-muted-foreground"}`}>
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
                <Button
                  type="submit"
                  variant="gold"
                  className="min-h-[44px] min-w-[44px] text-xs font-semibold shadow-sm"
                  disabled={busy || Boolean(problem)}
                >
                  Save message
                </Button>
              </div>
            </form>
          </SectionCard>

          {/* Section 2: Online Booking Controls */}
          <SectionCard
            icon={CalendarCheck2}
            title="Online booking"
            intro={BOOKING_INTRO}
            badge={
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  current.bookingPaused || current.bookingPausedByServer
                    ? "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {current.bookingPaused || current.bookingPausedByServer ? "Bookings Paused" : "Bookings Open"}
              </span>
            }
          >
            <div className="flex flex-col gap-4 rounded-lg border border-border/80 bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground">Public Scheduling Mode</p>
                <p className="text-xs text-muted-foreground mt-0.5">{bookingLine(current)}</p>
              </div>
              <Choice
                label="New bookings"
                value={current.bookingPaused || current.bookingPausedByServer ? "PAUSED" : "OPEN"}
                disabled={busy || current.bookingPausedByServer}
                options={[
                  ["OPEN", "Open"],
                  ["PAUSED", "Paused"],
                ]}
                onChoose={(v) => void save({ bookingPaused: v === "PAUSED" })}
              />
            </div>
          </SectionCard>

          {/* Section 3: Operating Hours & Closed Days */}
          <HoursManager />

          {/* Section 4: Daily Work & Capacity Limits */}
          <SectionCard
            icon={Sliders}
            title="Daily limits"
            intro={LIMITS_INTRO}
          >
            <div className="rounded-lg border border-border/80 bg-panel p-4">
              <label className="block max-w-xs text-xs font-semibold text-foreground">
                Day to change
                <input
                  type="date"
                  value={limitsDay}
                  onChange={(e) => {
                    if (e.target.value) setLimitsDay(e.target.value);
                  }}
                  className={`${fieldClass} mt-1`}
                />
              </label>
              <div className="mt-4 pt-4 border-t border-border/60">
                <CapSettings date={limitsDay} onChanged={() => undefined} />
              </div>
            </div>
          </SectionCard>

          {/* Section 5: Email Notification Dispatch */}
          <SectionCard
            icon={Mail}
            title="Email"
            intro={EMAIL_INTRO}
            badge={
              current.email.configured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  SMTP Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
                  <Server className="h-3.5 w-3.5" aria-hidden="true" />
                  Setup in Railway
                </span>
              )
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border/80 bg-panel p-4">
                <p className="text-xs font-semibold text-foreground">Email Dispatch (SMTP)</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{emailStatus(current)}</p>
              </div>
              <div className="rounded-lg border border-border/80 bg-panel p-4">
                <p className="text-xs font-semibold text-foreground">7-Day Outbox Activity</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{emailCounts(current)}</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-mono font-semibold ${current.email.failedLast7Days > 0 ? "border border-rose-500/30 bg-rose-500/10 text-rose-400" : "bg-white/5 text-muted-foreground"}`}>
                    Failed: {current.email.failedLast7Days}
                  </span>
                  <span className="inline-flex items-center rounded-md bg-white/5 px-2 py-0.5 text-xs font-mono text-muted-foreground">
                    Waiting: {current.email.waitingLast7Days}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

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
                  void save({ maintenance: true });
                }}
              >
                Turn on maintenance
              </Button>
            </div>
          </Dialog>
        </div>
      )}
    </div>
  );
}

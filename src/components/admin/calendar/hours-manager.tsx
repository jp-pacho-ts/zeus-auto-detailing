"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { brandConfig } from "@/config/brand";
import type { AdminSchedule, AdminWeekdayHours } from "@/lib/admin-schedule";
import { adminRequest } from "../bookings/client";
import { shopDate } from "../bookings/model";
import { dateClass, fieldBare, fieldClass, LoadState, useAdminResource } from "../bookings/use-admin-resource";
import { addDay } from "./calendar-model";
import { useAdminWrite, WriteFeedback } from "./use-admin-write";
import { SettingsCard } from "../settings/section-card";

// P1-20: ADMIN opening hours per weekday and closed dates. Customers only see open or closed
// days; the closed-date reason stays with staff. The server refuses to close a day that has
// bookings (LE 2026-10-28) and lists those dates.
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const longDay = (day: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(day + "T00:00:00Z"));

type Write = ReturnType<typeof useAdminWrite>;
// The day takes the free width; the times sit on the right like every other Settings control.
const ROW = "grid grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 py-1.5 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]";
const timeClass = fieldBare;

// A refused save keeps the edits on screen (the server says why); a saved one reloads.
function WeekForm({ schedule, write, onSaved }: { schedule: AdminSchedule; write: Write; onSaved: () => Promise<void> }) {
  const [days, setDays] = React.useState<AdminWeekdayHours[]>(schedule.days);
  const { busy, message, error, run } = write;
  const set = (dayOfWeek: number, change: Partial<AdminWeekdayHours>) =>
    setDays((all) => all.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...change } : d)));
  const today = shopDate();
  return (
    <form
      onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run("Opening hours saved.", () =>
            adminRequest("/api/admin/schedule/hours", { method: "PUT", body: { expectedVersion: schedule.version, days } }),
          );
          if (ok) await onSaved();
        }}
    >
      <SettingsCard
        id="settings-hours-week"
        title="Opening hours"
        description={
          schedule.startsOn === null
            ? "No opening hours yet: customers see every day as closed until you save."
            : schedule.startsOn > today
              ? `Customers can book from ${longDay(schedule.startsOn)}.`
              : "Customers can book any open day."
        }
        hint={message || error ? <WriteFeedback message={message} error={error} /> : "Tick a day to open it. Times go in 30-minute steps."}
        action={
          <>
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => void onSaved()}>
              Reload saved hours
            </Button>
            <Button type="submit" className="min-h-[44px]" disabled={busy}>
              Save opening hours
            </Button>
          </>
        }
      >
        {/* P1-77: one compact row per day (day, opens, closes) under one header. */}
        <div aria-hidden="true" className={ROW + " pb-0 text-xs font-semibold text-muted-foreground"}>
          <span>Day</span>
          <span>Opens</span>
          <span>Closes</span>
        </div>
        <ul className="divide-y divide-border">
          {days.map((d) => (
            <li key={d.dayOfWeek} className={ROW}>
              <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={d.open}
                  onChange={(e) => set(d.dayOfWeek, { open: e.target.checked })}
                  className="h-5 w-5 accent-[#c08818]"
                />
                {NAMES[d.dayOfWeek]}
              </label>
              {d.open ? (
                <>
                  <input type="time" step={1800} required aria-label={NAMES[d.dayOfWeek] + " opens"} value={d.openTime} onChange={(e) => set(d.dayOfWeek, { openTime: e.target.value })} className={timeClass} />
                  <input type="time" step={1800} required aria-label={NAMES[d.dayOfWeek] + " closes"} value={d.closeTime} onChange={(e) => set(d.dayOfWeek, { closeTime: e.target.value })} className={timeClass} />
                </>
              ) : (
                <span className="col-span-2 text-sm text-muted-foreground">Closed</span>
              )}
            </li>
          ))}
        </ul>
      </SettingsCard>
    </form>
  );
}

function ClosedDates({ schedule, write, onSaved }: { schedule: AdminSchedule; write: Write; onSaved: () => Promise<void> }) {
  const { busy, message, error, run } = write;
  const today = shopDate();
  return (
    <SettingsCard
      id="settings-hours-closed"
      title="Closed days"
      description="Holidays and other days the shop is shut."
      hint={message || error ? <WriteFeedback message={message} error={error} /> : "Customers only see the day as closed; the note stays with staff."}
    >
      <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget, data = new FormData(form), date = String(data.get("date")), reason = String(data.get("reason")).trim();
          const ok = await run(`${longDay(date)} is now closed.`, () =>
            adminRequest("/api/admin/schedule/closed-dates", { method: "POST", body: reason ? { date, reason } : { date } }),
          );
          if (ok) form.reset();
          await onSaved();
        }}
      >
        <label className="text-xs">
          Day
          <input name="date" type="date" required min={today} max={addDay(today, 365)} className={dateClass + " block"} />
        </label>
        <label className="min-w-0 flex-1 basis-48 text-xs">
          Note for staff (optional)
          <input name="reason" maxLength={200} placeholder="Holiday" autoComplete="off" className={fieldClass} />
        </label>
        <Button type="submit" disabled={busy}>
          Close this day
        </Button>
      </form>
      {schedule.closedDates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No closed days coming up.</p>
      ) : (
        <ul className="divide-y divide-border">
          {schedule.closedDates.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{longDay(c.date)}</span>
                <span className="block break-words text-xs text-muted-foreground">{c.reason}</span>
              </span>
              <Button
                variant="outline"
                disabled={busy}
                aria-label={`Open ${longDay(c.date)} again`}
                onClick={async () => {
                  await run(`${longDay(c.date)} is open again.`, () => adminRequest(`/api/admin/schedule/closed-dates/${c.id}`, { method: "DELETE", body: {} }));
                  await onSaved();
                }}
              >
                Open again
              </Button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </SettingsCard>
  );
}

export function HoursManager() {
  const schedule = useAdminResource<AdminSchedule>("/api/admin/schedule");
  const hoursWrite = useAdminWrite(), datesWrite = useAdminWrite();
  const reload = schedule.reload;
  return (
    <div className="space-y-6">
      <LoadState loading={schedule.loading} error={schedule.error} retry={schedule.reload} />
      {schedule.data && (
        <>
          <WeekForm key={schedule.data.version} schedule={schedule.data} write={hoursWrite} onSaved={reload} />
          <ClosedDates schedule={schedule.data} write={datesWrite} onSaved={reload} />
        </>
      )}
    </div>
  );
}

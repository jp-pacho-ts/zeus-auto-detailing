"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { brandConfig } from "@/config/brand";
import type { AdminSchedule, AdminWeekdayHours } from "@/lib/admin-schedule";
import { adminRequest } from "../bookings/client";
import { shopDate } from "../bookings/model";
import { fieldClass, LoadState, useAdminResource } from "../bookings/use-admin-resource";
import { addDay } from "./calendar-model";
import { useAdminWrite, WriteFeedback } from "./use-admin-write";

// P1-20: ADMIN opening hours per weekday and closed dates. Customers only see open or closed
// days; the closed-date reason stays with staff. The server refuses to close a day that has
// bookings (LE 2026-10-28) and lists those dates.
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const longDay = (day: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(day + "T00:00:00Z"));

type Write = ReturnType<typeof useAdminWrite>;

// A refused save keeps the edits on screen (the server says why); a saved one reloads.
function WeekForm({ schedule, write, onSaved }: { schedule: AdminSchedule; write: Write; onSaved: () => Promise<void> }) {
  const [days, setDays] = React.useState<AdminWeekdayHours[]>(schedule.days);
  const { busy, message, error, run } = write;
  const set = (dayOfWeek: number, change: Partial<AdminWeekdayHours>) =>
    setDays((all) => all.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...change } : d)));
  const today = shopDate();
  return (
    <section aria-label="Opening hours" className="space-y-4 rounded border border-border bg-[#121214] p-4">
      <div>
        <h2 className="font-bold">Opening hours</h2>
        <p className="text-xs text-muted-foreground">
          {schedule.startsOn === null
            ? "No opening hours yet: customers see every day as closed until you save."
            : schedule.startsOn > today
              ? `Customers can book from ${longDay(schedule.startsOn)}.`
              : "Customers can book any open day."}
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run("Opening hours saved.", () =>
            adminRequest("/api/admin/schedule/hours", { method: "PUT", body: { expectedVersion: schedule.version, days } }),
          );
          if (ok) await onSaved();
        }}
      >
        <ul className="divide-y divide-border">
          {days.map((d) => (
            <li key={d.dayOfWeek} className="flex flex-wrap items-end gap-3 py-3">
              <label className="flex min-h-[44px] w-36 items-center gap-2 text-sm font-semibold">
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
                  <label className="text-xs">
                    Opens
                    <input type="time" step={1800} required value={d.openTime} onChange={(e) => set(d.dayOfWeek, { openTime: e.target.value })} className={fieldClass} />
                  </label>
                  <label className="text-xs">
                    Closes
                    <input type="time" step={1800} required value={d.closeTime} onChange={(e) => set(d.dayOfWeek, { closeTime: e.target.value })} className={fieldClass} />
                  </label>
                </>
              ) : (
                <span className="min-h-[44px] py-3 text-sm text-muted-foreground">Closed</span>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            Save opening hours
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void onSaved()}>
            Reload saved hours
          </Button>
        </div>
        <WriteFeedback message={message} error={error} />
      </form>
    </section>
  );
}

function ClosedDates({ schedule, write, onSaved }: { schedule: AdminSchedule; write: Write; onSaved: () => Promise<void> }) {
  const { busy, message, error, run } = write;
  const today = shopDate();
  return (
    <section aria-label="Closed days" className="space-y-4 rounded border border-border bg-[#121214] p-4">
      <div>
        <h2 className="font-bold">Closed days</h2>
        <p className="text-xs text-muted-foreground">Holidays and other days the shop is shut. Customers only see the day as closed.</p>
      </div>
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
          <input name="date" type="date" required min={today} max={addDay(today, 365)} className={fieldClass} />
        </label>
        <label className="min-w-0 flex-1 basis-48 text-xs">
          Note for staff (optional)
          <input name="reason" maxLength={200} placeholder="Holiday" autoComplete="off" className={fieldClass} />
        </label>
        <Button type="submit" disabled={busy}>
          Close this day
        </Button>
      </form>
      <WriteFeedback message={message} error={error} />
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
    </section>
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

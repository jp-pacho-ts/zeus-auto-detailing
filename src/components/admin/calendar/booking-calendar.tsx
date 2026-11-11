"use client";
import * as React from "react";
import { AlertCircle, Calendar, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brandConfig } from "@/config/brand";
import type { AdminCalendar, AdminCalendarDay } from "@/lib/admin-schedule";
import type { AdminDayQueues } from "@/types/admin-contracts";
import type { BookingStatus, UserRole } from "@/types/contracts";
import { BookingDetail } from "../bookings/booking-detail";
import { shopDate, statusLabel } from "../bookings/model";
import { LoadState, useAdminResource } from "../bookings/use-admin-resource";
import { addDay, bookingCount, monthGrid, monthOf, shiftMonth, statusParts, weekOf } from "./calendar-model";

// P1-20: read-only booking calendar. Day cells come from /api/admin/calendar (counts only);
// tapping a day loads that day's bookings from the existing queue view.
const DOT: Record<BookingStatus, string> = {
  PENDING: "bg-amber-400",
  CONFIRMED: "bg-emerald-400",
  IN_PROGRESS: "bg-blue-400",
  COMPLETED: "bg-zinc-400",
  CANCELLED: "bg-rose-400",
};
export const STATUS_PILL: Record<BookingStatus, string> = {
  PENDING: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  CONFIRMED: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  IN_PROGRESS: "border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-400",
  COMPLETED: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400",
};
// The date string is already the Manila day, so it is formatted as UTC.
const format = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(brandConfig.locale, { timeZone: "UTC", ...options }).format(new Date(day + "T00:00:00Z"));
const longDay = (day: string) => format(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayDescription(date: string, info: AdminCalendarDay | undefined): string {
  if (!info) return longDay(date);
  const parts = statusParts(info).map((p) => `${p.count} ${statusLabel(p.status).toLowerCase()}`);
  return `${longDay(date)}: ${bookingCount(info.total)}${parts.length ? ` (${parts.join(", ")})` : ""}${info.closed ? ", shop closed" : ""}`;
}

function Dots({ info }: { info: AdminCalendarDay }) {
  return (
    <span className="flex flex-wrap gap-0.5" aria-hidden="true">
      {statusParts(info).flatMap((p) =>
        Array.from({ length: Math.min(p.count, 4) }, (_, i) => (
          <span key={p.status + i} className={`h-1.5 w-1.5 rounded-full ${DOT[p.status]}`} />
        )),
      )}
    </span>
  );
}

export function BookingCalendar({ role }: { role: UserRole }) {
  const today = shopDate();
  const [view, setView] = React.useState<"MONTH" | "WEEK">("MONTH"),
    [month, setMonth] = React.useState(() => monthOf(today)),
    [week, setWeek] = React.useState(() => weekOf(today)[0]),
    [day, setDay] = React.useState<string | null>(null),
    [booking, setBooking] = React.useState<string | null>(null);
  const weeks = view === "MONTH" ? monthGrid(month) : [weekOf(week)];
  const from = weeks[0][0], to = weeks.at(-1)!.at(-1)!;
  const calendar = useAdminResource<AdminCalendar>(`/api/admin/calendar?from=${from}&to=${to}`);
  const dayView = useAdminResource<AdminDayQueues>(day ? `/api/admin/queues?date=${day}` : null);
  const byDate = new Map(calendar.data?.days.map((d) => [d.date, d]) ?? []);
  const reloadCalendar = calendar.reload, reloadDay = dayView.reload;
  const changed = React.useCallback(async () => {
    await Promise.all([reloadCalendar(), reloadDay()]);
  }, [reloadCalendar, reloadDay]);

  function move(n: -1 | 1) {
    if (view === "MONTH") setMonth(shiftMonth(month, n));
    else setWeek(addDay(week, 7 * n));
  }
  function goToday() {
    setMonth(monthOf(today));
    setWeek(weekOf(today)[0]);
    setDay(today);
    setBooking(null);
  }
  const title = view === "MONTH" ? format(month + "-01", { month: "long", year: "numeric" }) : `${format(from, { day: "numeric", month: "short" })} to ${format(to, { day: "numeric", month: "short", year: "numeric" })}`;
  const dayBookings = dayView.data ? [...dayView.data.queues.flatMap((q) => q.bookings), ...dayView.data.legacy] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label={view === "MONTH" ? "Previous month" : "Previous week"} onClick={() => move(-1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <h2 className="min-w-0 text-base font-bold" aria-live="polite">
            {title}
          </h2>
          <Button variant="outline" size="icon" aria-label={view === "MONTH" ? "Next month" : "Next week"} onClick={() => move(1)}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={goToday}>
            Today
          </Button>
          <div role="group" aria-label="Calendar view" className="flex gap-2">
            {(["MONTH", "WEEK"] as const).map((v) => (
              <Button key={v} variant={view === v ? "default" : "outline"} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "MONTH" ? "Month" : "Week"}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <LoadState loading={calendar.loading} error={calendar.error} retry={calendar.reload} />

      {view === "MONTH" ? (
        <div className="rounded-xl border border-border bg-white dark:bg-[#121214] p-2 sm:p-3 shadow-xs">
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-bold text-stone-700 dark:text-muted-foreground" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weeks.flat().map((date) => {
              const info = byDate.get(date), inMonth = monthOf(date) === month, past = date < today;
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={dayDescription(date, info)}
                  aria-pressed={day === date}
                  onClick={() => {
                    setDay(date);
                    setBooking(null);
                  }}
                  className={`flex min-h-[56px] min-w-0 flex-col items-start gap-1 rounded-lg border p-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-[84px] sm:p-2 transition-colors ${
                    day === date
                      ? "border-primary bg-amber-500/10 dark:bg-primary/10"
                      : "border-border bg-white dark:bg-[#18181b] hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-stone-50 dark:hover:bg-[#202024]"
                  } ${inMonth && !past ? "" : "opacity-60 bg-stone-50 dark:bg-[#121214]"}`}
                >
                  <span className={`text-xs ${date === today ? "rounded bg-primary px-1 font-bold text-black" : "font-bold text-stone-900 dark:text-foreground"}`}>
                    {Number(date.slice(8))}
                  </span>
                  {info && info.total > 0 && <span className="text-sm font-bold tabular-nums sm:text-base text-stone-900 dark:text-foreground">{info.total}</span>}
                  {info && <Dots info={info} />}
                  {info?.closed && <span className="hidden text-[10px] text-stone-500 dark:text-muted-foreground font-medium sm:block">Closed</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-white dark:bg-[#121214]">
          {weeks[0].map((date) => {
            const info = byDate.get(date);
            return (
              <li key={date}>
                <button
                  type="button"
                  aria-pressed={day === date}
                  onClick={() => {
                    setDay(date);
                    setBooking(null);
                  }}
                  className={`flex min-h-[56px] w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${day === date ? "bg-amber-500/10 dark:bg-primary/10 font-bold" : "hover:bg-stone-50 dark:hover:bg-[#18181b]"} ${date < today ? "opacity-60" : ""}`}
                >
                  <span className="font-semibold">
                    {format(date, { weekday: "long", day: "numeric", month: "short" })}
                    {date === today && <span className="ml-2 text-xs text-primary">Today</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {info?.closed ? "Closed · " : ""}
                    {info ? bookingCount(info.total) : ""}
                    {info && statusParts(info).length > 0 && ` (${statusParts(info).map((p) => `${p.count} ${statusLabel(p.status).toLowerCase()}`).join(", ")})`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${DOT[s]}`} aria-hidden="true" /> {statusLabel(s)}
          </span>
        ))}
      </p>

      {day && (
        <CalendarDayModal
          day={day}
          dayView={dayView}
          dayBookings={dayBookings}
          onClose={() => setDay(null)}
          onSelectBooking={(id) => setBooking(id)}
        />
      )}
      {booking && (
        <BookingDetail
          key={booking}
          id={booking}
          role={role}
          queues={dayView.data?.queues ?? []}
          onChanged={changed}
          onClose={() => setBooking(null)}
        />
      )}
    </div>
  );
}

interface CalendarDayModalProps {
  day: string;
  dayView: ReturnType<typeof useAdminResource<AdminDayQueues>>;
  dayBookings: Array<{
    id: string;
    referenceCode: string;
    customerName: string;
    status: BookingStatus;
    serviceName: string;
    lines: Array<{ name: string; removed?: boolean }>;
  }>;
  onClose: () => void;
  onSelectBooking: (id: string) => void;
}

function CalendarDayModal({
  day,
  dayView,
  dayBookings,
  onClose,
  onSelectBooking,
}: CalendarDayModalProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) {
        return;
      }
      if (e.key === "Escape") {
        onClose();
      }
    };
    const area = document.getElementById("admin-content");
    const prevAreaOverflow = area?.style.overflow;
    if (area) area.style.overflow = "hidden";
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (area && prevAreaOverflow !== undefined) area.style.overflow = prevAreaOverflow;
      document.body.style.overflow = prevBodyOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-day-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4 sm:p-6 backdrop-blur-sm grid place-items-center"
    >
      <div
        className="fixed inset-0 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 my-auto flex w-full max-w-xl max-h-[calc(100vh-3rem)] flex-col rounded-2xl border border-border/90 bg-white dark:bg-[#121214] p-5 sm:p-6 text-foreground shadow-2xl overflow-y-auto before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/50 before:to-transparent before:z-30 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-border/70 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Calendar className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="calendar-day-modal-title" className="text-base sm:text-lg font-bold text-foreground">
                {longDay(day)}
              </h2>
              <p className="text-xs text-muted-foreground">
                {dayView.loading
                  ? "Loading appointments..."
                  : dayBookings.length === 0
                  ? "No bookings scheduled"
                  : `${dayBookings.length} booking${dayBookings.length === 1 ? "" : "s"} scheduled`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={dayView.loading}
              onClick={() => void dayView.reload()}
              className="h-8 gap-1.5 text-xs"
              title="Refresh day bookings"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${dayView.loading ? "animate-spin" : ""}`} aria-hidden="true" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close day view"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-stone-100 dark:hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <LoadState loading={dayView.loading} error={dayView.error} retry={dayView.reload} />

        {dayView.data?.closed && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Shop closed · {dayView.data.closed.reason}</span>
          </div>
        )}

        {dayView.data && !dayView.loading && dayBookings.length === 0 && (
          <div className="rounded-xl border border-border/70 bg-stone-50/60 dark:bg-zinc-900/40 p-6 text-center">
            <p className="text-sm font-medium text-foreground">No bookings on this day</p>
            <p className="text-xs text-muted-foreground mt-1">There are no customer bookings or work queue entries for this date.</p>
          </div>
        )}

        {dayBookings.length > 0 && (
          <ul className="space-y-2.5">
            {dayBookings.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onSelectBooking(b.id)}
                  className="group flex min-h-[48px] w-full items-start justify-between gap-3 rounded-xl border border-border bg-stone-50/50 dark:bg-zinc-900/40 p-3.5 text-left text-sm transition-all hover:border-primary/50 hover:bg-stone-100 dark:hover:bg-zinc-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="block break-all font-mono text-xs font-bold text-primary group-hover:underline">
                        {b.referenceCode}
                      </span>
                      <span className="block break-words font-semibold text-foreground">
                        {b.customerName}
                      </span>
                    </span>
                    <span className="block break-words text-xs text-muted-foreground line-clamp-2">
                      {b.lines.filter((l) => !l.removed).map((l) => l.name).join(", ") || b.serviceName}
                    </span>
                  </span>
                  <span className={`inline-flex shrink-0 items-center rounded border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_PILL[b.status]}`}>
                    {statusLabel(b.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

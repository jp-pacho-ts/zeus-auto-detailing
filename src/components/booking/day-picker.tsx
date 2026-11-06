"use client";

import { AlertCircle, CalendarDays, Check, ChevronLeft, MessageSquare, Phone } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { dayStateLabel } from "@/components/booking/day-booking";
import type { PublicDay } from "@/types/contracts";

// The booking wizard's day picker (ADR-005: days only, no times, counts or positions), shared with
// the private booking page's day change.
export const DAYS_PER_PAGE = 14;
export const todayInManila = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) =>
  new Date(new Date(day + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { dateStyle: "full", timeZone: "Asia/Manila" }).format(
    new Date(date + "T00:00:00+08:00"),
  );
export const shortDayLabel = (date: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(
    new Date(date + "T00:00:00+08:00"),
  );

const panel = "rounded-2xl border border-border bg-card p-4 sm:p-8";
const contact =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-colors";
const pager =
  "inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// P1-52: the days are laid out as a month calendar, Monday first. The days before the first one and after the last one are
// shown faded (they are not choices) so the weeks line up.
const mondayIndex = (date: string) => (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
const monthShort = (date: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { month: "short", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));

export interface DayPickerProps {
  data: { days: PublicDay[]; nextAvailableDay: string | null; onlineBookingStatus?: "OPEN" | "PAUSED" } | null;
  error: string;
  onRetry: () => void;
  selected: string;
  onSelect: (date: string) => void;
  fromDate: string;
  onPage: (fromDate: string) => void;
  multiDay: boolean;
  // The booking's own day when changing it: shown, never chosen.
  currentDay?: string;
  notice?: string;
}

// P1-19 W2: while online booking is paused there is nothing to choose, so the step offers the ways
// to book instead of a list of closed days. The customer's choices stay on the page.
function PausedPanel() {
  return (
    <section id="booking-days" aria-labelledby="days-title" className={panel}>
      <h2 id="days-title" tabIndex={-1} className="text-lg font-bold text-foreground">
        Online booking isn&apos;t open yet
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your choices are kept on this page. Call or message the shop to book your day.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`} className={contact + " bg-primary text-primary-foreground hover:bg-primary-hover"}>
          <Phone className="h-4 w-4" aria-hidden="true" />
          Call {brandConfig.displayPhone}
        </a>
        <a
          href={brandConfig.facebookMessengerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={contact + " border border-input bg-card text-foreground hover:border-primary"}
        >
          <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
          Message us on Messenger
        </a>
      </div>
    </section>
  );
}

export function DayPicker({ data, error, onRetry, selected, onSelect, fromDate, onPage, multiDay, currentDay, notice }: DayPickerProps) {
  const today = todayInManila();
  const lastDay = addDays(today, 90);
  if (data?.onlineBookingStatus === "PAUSED") return <PausedPanel />;
  const days = data?.days ?? [];
  const lead = days.length ? mondayIndex(days[0].date) : 0;
  const trail = days.length ? (7 - ((lead + days.length) % 7)) % 7 : 0;
  const faded = (date: string) => (
    <div key={"faded-" + date} aria-hidden="true" className="flex min-h-[64px] lg:min-h-[clamp(64px,9vh,84px)] items-center justify-center text-lg font-medium text-muted-foreground/50">
      {Number(date.slice(8))}
    </div>
  );
  return (
    <section id="booking-days" aria-labelledby="days-title" aria-busy={!data && !error} className={panel}>
      <div className="border-b border-border pb-3">
        <h2 id="days-title" tabIndex={-1} className="text-lg font-bold text-foreground">
          {multiDay ? "Available drop-off days" : "Available days"}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {shortDayLabel(fromDate)} – {shortDayLabel(addDays(fromDate, DAYS_PER_PAGE - 1))}
        </p>
      </div>

      {!data && !error && (
        <div role="status" className="mt-6 grid grid-cols-7 gap-1.5 sm:gap-2">
          <span className="sr-only">Loading days</span>
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted motion-safe:animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4">
          <p className="text-sm text-destructive">{error}</p>
          <button type="button" onClick={onRetry} className="mt-2 min-h-[44px] text-sm underline">
            Retry days
          </button>
        </div>
      )}

      {data && (
        <>
          <p role="status" aria-live="polite" className="my-3 text-sm text-muted-foreground">
            {data.nextAvailableDay
              ? `Next available day: ${dateLabel(data.nextAvailableDay)}.`
              : `No available day was found. Please call the shop at ${brandConfig.displayPhone}.`}
          </p>
          <fieldset>
            <legend className="sr-only">Days</legend>
            <div aria-hidden="true" className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-muted-foreground sm:gap-2">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {Array.from({ length: lead }, (_, i) => faded(addDays(days[0].date, i - lead)))}
              {days.map((d) => {
                const current = d.date === currentDay;
                const selectable = d.state === "AVAILABLE" && !current;
                const label = current ? "Your current day" : dayStateLabel(d.state);
                // A day that stopped being available is shown, but no longer chosen.
                const isSelected = selectable && selected === d.date;
                const dayNumber = Number(d.date.slice(8));
                // L5: unavailable days stay in sequence for orientation: dashed, crossed out and readable (not faded).
                return (
                  <label
                    key={d.date}
                    className={`relative flex min-h-[64px] lg:min-h-[clamp(64px,9vh,84px)] flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-card ${
                      !selectable
                        ? "cursor-not-allowed border border-dashed border-border bg-muted"
                        : isSelected
                          ? "border border-primary bg-primary text-primary-foreground"
                          : "cursor-pointer border border-input bg-background hover:border-primary"
                    }`}
                  >
                    <span className={`text-lg font-extrabold leading-none sm:text-2xl ${selectable ? "" : "text-muted-foreground line-through decoration-1"}`}>
                      {dayNumber}
                    </span>
                    {isSelected ? (
                      <>
                        <span className="hidden text-xs font-semibold leading-tight sm:block">Chosen</span>
                        <Check aria-hidden="true" className="h-3.5 w-3.5 sm:hidden" />
                      </>
                    ) : !selectable ? (
                      <span className="hidden text-xs leading-tight text-muted-foreground sm:block">{label}</span>
                    ) : dayNumber === 1 ? (
                      <span className="text-xs leading-tight text-muted-foreground">{monthShort(d.date)}</span>
                    ) : null}
                    <input
                      type="radio"
                      name="booking-day"
                      aria-label={`${dateLabel(d.date)}: ${label}`}
                      checked={isSelected}
                      disabled={!selectable}
                      onChange={() => onSelect(d.date)}
                      className="absolute inset-0 h-full w-full cursor-[inherit] opacity-0"
                    />
                  </label>
                );
              })}
              {Array.from({ length: trail }, (_, i) => faded(addDays(days[days.length - 1].date, i + 1)))}
            </div>
          </fieldset>
          <p className="mt-3 text-sm text-muted-foreground">Crossed-out days are fully booked or closed.</p>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onPage(addDays(fromDate, -DAYS_PER_PAGE) < today ? today : addDays(fromDate, -DAYS_PER_PAGE))}
          disabled={fromDate <= today}
          className={pager}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Earlier days
        </button>
        <button
          type="button"
          onClick={() => onPage(addDays(fromDate, DAYS_PER_PAGE))}
          disabled={addDays(fromDate, DAYS_PER_PAGE) > lastDay}
          className={pager}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          Later days
        </button>
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted p-3 text-sm text-muted-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>
          {notice ?? "Choosing a day doesn't hold a place. Your place is set when you send your booking request."}
          {multiDay && " This job takes more than one day: the chosen day is your drop-off day."}
        </p>
      </div>
    </section>
  );
}

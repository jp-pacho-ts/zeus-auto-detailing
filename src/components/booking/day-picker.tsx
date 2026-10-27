"use client";

import { AlertCircle, CalendarDays, ChevronLeft, MessageSquare, Phone } from "lucide-react";
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

const panel = "rounded border border-border bg-card p-4 sm:p-8";
const contact =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded px-5 py-3 text-sm font-bold transition-colors";

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
        <div role="status" className="mt-6 grid grid-cols-2 gap-3">
          <span className="sr-only">Loading days</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded bg-muted motion-safe:animate-pulse" />
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
          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="sr-only">Days</legend>
            {data.days.map((d) => {
              const current = d.date === currentDay;
              const selectable = d.state === "AVAILABLE" && !current;
              const label = current ? "Your current day" : dayStateLabel(d.state);
              // A day that stopped being available is shown, but no longer chosen.
              const isSelected = selectable && selected === d.date;
              // L5: unavailable days stay in sequence for orientation, readable (not faded) and dashed.
              return (
                <label
                  key={d.date}
                  className={`flex min-h-[64px] items-center justify-between gap-3 rounded border px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                    !selectable
                      ? "cursor-not-allowed border-dashed border-border bg-[#121214]"
                      : isSelected
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "cursor-pointer border-input bg-card hover:border-primary"
                  }`}
                >
                  <div>
                    <span className={`block font-semibold ${selectable ? "text-foreground" : "text-muted-foreground"}`}>{shortDayLabel(d.date)}</span>
                    <span className="block text-sm text-muted-foreground">{label}</span>
                  </div>
                  <input
                    type="radio"
                    name="booking-day"
                    aria-label={`${dateLabel(d.date)}: ${label}`}
                    checked={isSelected}
                    disabled={!selectable}
                    onChange={() => onSelect(d.date)}
                    className={`h-5 w-5 shrink-0 accent-primary ${selectable ? "" : "invisible"}`}
                  />
                </label>
              );
            })}
          </fieldset>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onPage(addDays(fromDate, -DAYS_PER_PAGE) < today ? today : addDays(fromDate, -DAYS_PER_PAGE))}
          disabled={fromDate <= today}
          className="inline-flex min-h-[44px] items-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Earlier days
        </button>
        <button
          type="button"
          onClick={() => onPage(addDays(fromDate, DAYS_PER_PAGE))}
          disabled={addDays(fromDate, DAYS_PER_PAGE) > lastDay}
          className="inline-flex min-h-[44px] items-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          Later days
        </button>
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded border border-border/60 bg-[#121214] p-3 text-sm text-muted-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>
          {notice ?? "Choosing a day doesn't hold a place. Your place is set when you send your booking request."}
          {multiDay && " This job takes more than one day: the chosen day is your drop-off day."}
        </p>
      </div>
    </section>
  );
}

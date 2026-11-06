"use client";

import * as React from "react";
import { Car, Check, X } from "lucide-react";
import { progressFor } from "@/lib/booking-lookup";
import type { BookingStatus } from "@/types/contracts";

// P1-49 (LE 2026-11-06, mock design A): where the booking stands, as a thick bar that fills from the left with a car riding its
// end. Status level only (LE 2026-10-21): what is being done to the car, which bay or who works on it stays with the shop.
// The fill is step-based. The data has four states and no percentage, so the bar stops in the middle of the current step's
// column (the label sits right under it) and a finished booking fills the bar. It animates in on load and, because the width is a
// CSS transition, again whenever the status changes while the page is open. prefers-reduced-motion removes every animation.
const SENTENCE: Record<BookingStatus, string> = {
  PENDING: "We have your booking",
  CONFIRMED: "Your booking is confirmed",
  IN_PROGRESS: "Your car is being detailed right now",
  COMPLETED: "Your booking is done",
  CANCELLED: "This booking is cancelled",
};
export const statusSentence = (status: BookingStatus) => SENTENCE[status];

const COLUMNS = 4;
export function progressPosition(step: number): { car: number; fill: number } {
  if (step <= 0) return { car: 0, fill: 0 };
  const middle = ((step - 0.5) * 100) / COLUMNS;
  return { car: middle, fill: step >= COLUMNS ? 100 : middle };
}

const slide = "transition-[width] duration-[1400ms] ease-[cubic-bezier(0.22,0.8,0.3,1)] motion-reduce:transition-none";

export function BookingProgress({ status }: { status: BookingStatus }) {
  const p = progressFor(status);
  // The bar starts empty and moves to the real step a moment after it is shown; the same move runs on every later change.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 80);
    return () => window.clearTimeout(timer);
  }, []);
  const at = progressPosition(ready ? p.step : 0);
  const finished = p.step >= COLUMNS;

  return (
    <div aria-labelledby="progress-title">
      <h3 id="progress-title" className="sr-only">
        Booking progress
      </h3>
      <p aria-live="polite" className="text-balance text-xl font-bold leading-snug text-foreground sm:text-2xl">
        {p.cancelled ? (
          <span className="inline-flex items-center gap-3 motion-safe:animate-zeus-fade">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-destructive text-destructive">
              <X className="h-5 w-5" aria-hidden="true" />
            </span>
            {statusSentence(status)}
          </span>
        ) : (
          statusSentence(status)
        )}
      </p>

      {p.cancelled ? (
        <div aria-hidden="true" className="mt-6 h-3.5 rounded-full border border-dashed border-border" />
      ) : (
        <>
          <div className="relative mt-6">
            <div
              role="progressbar"
              aria-label="Booking progress"
              aria-valuemin={1}
              aria-valuemax={COLUMNS}
              aria-valuenow={p.step}
              aria-valuetext={`Step ${p.step} of ${COLUMNS}: ${p.label}`}
              className="h-3.5 overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border"
            >
              <div className={"relative h-full overflow-hidden rounded-full bg-gradient-to-r from-primary/60 to-primary " + slide} style={{ width: `${at.fill}%` }}>
                {!finished && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 hidden w-1/3 bg-gradient-to-r from-transparent via-foreground/35 to-transparent motion-safe:block motion-safe:animate-zeus-shine"
                  />
                )}
              </div>
            </div>
            <div aria-hidden="true" className={"absolute left-0 top-1/2 h-0 " + slide} style={{ width: `${at.car}%` }}>
              <span
                className={
                  "absolute right-0 top-0 grid h-10 w-10 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border-2 border-primary bg-background text-primary transition-opacity duration-500 motion-reduce:transition-none " +
                  (ready ? "opacity-100" : "opacity-0")
                }
              >
                {!finished && <span className="absolute inset-0 hidden rounded-full border-2 border-primary motion-safe:block motion-safe:animate-zeus-ring" />}
                {finished ? <Check className="h-5 w-5" /> : <Car className="h-5 w-5" />}
              </span>
            </div>
          </div>

          <ol aria-label="Progress steps" className="mt-5 grid grid-cols-4">
            {p.steps.map((label, index) => {
              const state = index + 1 < p.step ? "done" : index + 1 === p.step ? "current" : "next";
              // What the eye sees follows the bar: a step lights up once the bar has reached it.
              const lit = ready ? state : "next";
              return (
                <li
                  key={label}
                  aria-current={state === "current" ? "step" : undefined}
                  style={{ transitionDelay: ready ? `${index * 280}ms` : "0ms" }}
                  className={
                    "flex flex-col items-center gap-1 px-0.5 text-center text-xs leading-tight transition-colors duration-500 motion-reduce:transition-none sm:text-sm " +
                    (lit === "next" ? "text-muted-foreground" : lit === "current" ? "font-bold text-foreground" : "font-semibold text-foreground")
                  }
                >
                  <Check aria-hidden="true" className={"h-3.5 w-3.5 text-primary " + (lit === "done" ? "" : "invisible")} />
                  <span>{label}</span>
                  {state === "done" && <span className="sr-only">(done)</span>}
                  {state === "current" && <span className="sr-only">(current step)</span>}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

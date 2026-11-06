import { Check, X } from "lucide-react";
import { progressFor } from "@/lib/booking-lookup";
import type { BookingStatus } from "@/types/contracts";

// P1-32 / P1-49: where the booking stands, as a stepped progress bar (LE 2026-11-06). Status level only:
// what is being done to the car, which bay or who works on it stays with the shop (LE 2026-10-21).
// It sits inside the booking summary card on the private booking page, so it draws no card of its own.
export function BookingProgress({ status }: { status: BookingStatus }) {
  const p = progressFor(status);
  return (
    <div aria-labelledby="progress-title">
      <h2 id="progress-title" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Booking progress
      </h2>
      {p.cancelled ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded border border-destructive/60 px-3 py-2 text-sm font-semibold text-destructive">
          <X className="h-4 w-4" aria-hidden="true" /> Cancelled
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Current status: <span className="font-semibold text-foreground">{p.label}</span>
          </p>
          <ol className="mt-5 flex" aria-label="Progress steps">
            {p.steps.map((label, index) => {
              const state = index + 1 < p.step ? "done" : index + 1 === p.step ? "current" : "next";
              return (
                <li key={label} aria-current={state === "current" ? "step" : undefined} className="relative flex flex-1 flex-col items-center text-center">
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className={"absolute right-1/2 top-4 h-1 w-full -translate-y-1/2 rounded-full " + (index + 1 <= p.step ? "bg-primary" : "bg-border")}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={
                      "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 " +
                      (state === "done"
                        ? "border-primary bg-primary text-primary-foreground"
                        : state === "current"
                          ? "border-primary bg-card ring-4 ring-primary/25"
                          : "border-border bg-card")
                    }
                  >
                    {state === "done" ? <Check className="h-4 w-4" /> : state === "current" ? <span className="h-3 w-3 rounded-full bg-primary" /> : null}
                  </span>
                  <span className={"mt-2 px-0.5 text-xs leading-tight sm:text-sm " + (state === "next" ? "text-muted-foreground" : "font-semibold text-foreground")}>
                    {label}
                  </span>
                  {state === "done" && <span className="sr-only"> (done)</span>}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

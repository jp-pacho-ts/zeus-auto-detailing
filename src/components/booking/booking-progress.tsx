import { Check, X } from "lucide-react";
import { progressFor } from "@/lib/booking-lookup";
import type { BookingStatus } from "@/types/contracts";

// P1-32: where the booking stands, in plain words. Status level only: what is being done to the car, which
// bay or who works on it stays with the shop (LE 2026-10-21). Used on the private booking page.
export function BookingProgress({ status }: { status: BookingStatus }) {
  const p = progressFor(status);
  return (
    <section aria-labelledby="progress-title" className="rounded border border-border bg-card p-4 sm:p-6">
      <h2 id="progress-title" className="text-base font-bold text-foreground">
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
          <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Progress steps">
            {p.steps.map((label, index) => {
              const state = index + 1 < p.step ? "done" : index + 1 === p.step ? "current" : "next";
              return (
                <li
                  key={label}
                  aria-current={state === "current" ? "step" : undefined}
                  className={
                    "flex min-h-[44px] items-center gap-2 rounded border px-3 py-2 text-sm " +
                    (state === "current"
                      ? "border-primary bg-primary/10 font-bold text-foreground"
                      : state === "done"
                        ? "border-border text-foreground"
                        : "border-border/60 text-muted-foreground")
                  }
                >
                  {state === "done" ? <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" /> : <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-current" />}
                  <span>{label}</span>
                  {state === "done" && <span className="sr-only"> (done)</span>}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

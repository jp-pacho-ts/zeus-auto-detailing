"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, LogOut, RefreshCw } from "lucide-react";
import { isMultiDay } from "@/components/booking/day-booking";
import { DayPicker, dateLabel, todayInManila } from "@/components/booking/day-picker";
import { DepositProofSection } from "@/components/booking/deposit-proof";
import { BookingLookupForm } from "@/components/booking/booking-lookup-form";
import { ContactShop, ManagedBookingDetails } from "@/components/booking/managed-booking-details";
import { PaymentInstructions } from "@/components/booking/payment-instructions";
import { reveal } from "@/components/booking/reveal";
import {
  MANAGE_HEADERS,
  canSendProof,
  freezeRequest,
  isAvailabilityData,
  isManagedView,
  isMutationData,
  manageActionError,
  parseLifecycle,
  sendFrozen,
  type FrozenRequest,
} from "@/components/booking/manage-booking";
import type { BookingCatalogResponse } from "@/types/catalog-contracts";
import type { ManagedDayAvailabilityData, ManagedDayBookingView, ManagedLookupData } from "@/types/contracts";

// P1-05 second pass: the private booking page (ADR-002, P1-04 contract). No URL parameters: the
// saved code is exchanged once for the HttpOnly session cookie, and every later call relies on that
// cookie. The code stays in memory only while it is typed and is dropped after the exchange.
const panel = "rounded border border-border bg-card p-6 sm:p-8";
const primary =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-foreground transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50";

type Phase = "loading" | "code" | "booking" | "error";
type Mode = "view" | "cancel" | "day";
type Action = { kind: "cancel" | "reschedule"; request: FrozenRequest; bookingDate?: string };

const waitText = (seconds: number | null) => "Too many tries. Wait " + (seconds ?? 60) + " seconds, then try again.";

export function ManageBooking() {
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [readError, setReadError] = React.useState("");
  const [readVersion, setReadVersion] = React.useState(0);
  const [view, setView] = React.useState<ManagedDayBookingView | null>(null);
  // P1-32: the masked phone and email shown after "reference code + last name" (never the full details).
  const [lookupContact, setLookupContact] = React.useState<ManagedLookupData["contact"] | null>(null);
  const [multiDay, setMultiDay] = React.useState(false);
  const [codeNotice, setCodeNotice] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("view");
  const [action, setAction] = React.useState<Action | null>(null);
  const [actionError, setActionError] = React.useState("");
  const [retryable, setRetryable] = React.useState(false);
  const [done, setDone] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [fromDate, setFromDate] = React.useState(todayInManila);
  const [days, setDays] = React.useState<{ key: string; data: ManagedDayAvailabilityData | null; error: string } | null>(null);
  const [daysVersion, setDaysVersion] = React.useState(0);
  const [day, setDay] = React.useState("");
  const alertRef = React.useRef<HTMLDivElement>(null);
  // Synchronous guards (review F1): handlers from one render cannot both pass a state check, so a
  // rapid repeat tap is refused here, before any key is minted or request sent.
  const actionBusy = React.useRef(false);
  // The unconfirmed change, if any: only its own retry may run until it settles (same key).
  const unconfirmedAction = React.useRef<Action | null>(null);

  const toCode = React.useCallback((notice: string) => {
    unconfirmedAction.current = null;
    setView(null);
    setLookupContact(null);
    setMode("view");
    setAction(null);
    setActionError("");
    setRetryable(false);
    setDone("");
    setCodeNotice(notice);
    setPhase("code");
  }, []);

  // The cookie session, if any, opens the booking directly.
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bookings/manage", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const result = parseLifecycle(await response.json(), isManagedView);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setView(result.data);
          setPhase("booking");
        } else if (result.error.code === "UNAUTHENTICATED") {
          setPhase("code");
        } else {
          setReadError(result.error.code === "RATE_LIMITED" ? waitText(result.error.retryAfterSeconds) : "Your booking could not be opened right now.");
          setPhase("error");
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setReadError("Your booking could not be opened. Check your connection.");
        setPhase("error");
      });
    return () => controller.abort();
  }, [readVersion]);

  // Multi-day jobs: the booked day is the drop-off day (the public catalog says which jobs).
  const serviceKey = view?.lines.map((l) => l.serviceId).join(",") ?? "";
  React.useEffect(() => {
    if (!serviceKey) return;
    const controller = new AbortController();
    fetch("/api/catalog", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result: BookingCatalogResponse) => {
        if (!controller.signal.aborted && result.ok) setMultiDay(isMultiDay(result.data, serviceKey.split(",")));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [serviceKey]);

  // Day states for a day change: this booking's queue, excluding the booking itself.
  const bookingId = view?.id;
  const daysKey = bookingId + "|" + fromDate + "|" + daysVersion;
  const liveDays = days?.key === daysKey ? days : null;
  React.useEffect(() => {
    if (mode !== "day" || !bookingId) return;
    let active = true;
    sendFrozen(fetch, freezeRequest("/api/bookings/manage/availability", { bookingId, fromDate, days: 14 }), isAvailabilityData).then((result) => {
      if (!active) return;
      if (result.ok) return setDays({ key: daysKey, data: result.data, error: "" });
      const shown = manageActionError(result.error);
      if (shown.signedOut) return toCode(shown.message);
      setDays({
        key: daysKey,
        data: null,
        error: result.error.code === "BOOKING_NOT_MANAGEABLE" ? "Please contact the shop to change this booking." : shown.retrySame ? "Could not load the days. Retry in a moment." : shown.message,
      });
    });
    return () => {
      active = false;
    };
  }, [mode, bookingId, fromDate, daysKey, toCode]);

  React.useEffect(() => {
    if (actionError) alertRef.current?.focus();
  }, [actionError]);

  // P1-19 W7: an opened panel and a finished change come into view with focus on their heading.
  React.useEffect(() => {
    if (mode === "day") reveal("days-title");
    if (mode === "cancel") reveal("cancel-title");
  }, [mode]);
  React.useEffect(() => {
    if (done) reveal("manage-result");
  }, [done]);

  const signOut = async () => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/bookings/manage/session", { method: "DELETE", headers: MANAGE_HEADERS, cache: "no-store", credentials: "same-origin" });
      if (response.status === 204) return toCode("You are signed out of your booking on this device.");
      setActionError("You could not be signed out right now. Try again, or close this browser window.");
    } catch {
      setActionError("You could not be signed out. Check your connection and try again.");
    } finally {
      actionBusy.current = false;
      setPending(false);
    }
  };

  // The action (and its key) is built only after the guard is taken; a retry passes the frozen one.
  const run = async (make: () => Action | null) => {
    if (actionBusy.current) return;
    const next = make();
    if (!next || (unconfirmedAction.current && next !== unconfirmedAction.current)) return;
    actionBusy.current = true;
    setPending(true);
    setActionError("");
    setDone("");
    setAction(next);
    try {
      const result = await sendFrozen(fetch, next.request, isMutationData);
      if (result.ok) {
        unconfirmedAction.current = null;
        setView(result.data.booking);
        setAction(null);
        setRetryable(false);
        setMode("view");
        setDay("");
        setDone(
          next.kind === "cancel"
            ? result.data.noChange ? "This booking was already cancelled." : "Your booking is cancelled."
            : result.data.noChange ? "Your booking stays on the same day." : "Your booking is moved to " + dateLabel(result.data.booking.bookingDate) + ".",
        );
        return;
      }
      const shown = manageActionError(result.error);
      unconfirmedAction.current = shown.retrySame ? next : null;
      if (shown.signedOut) return toCode(shown.message);
      setActionError(shown.message);
      setRetryable(shown.retrySame);
      if (shown.retrySame) return; // keep the frozen request: the retry sends the same key
      setAction(null);
      if (shown.currentBooking) {
        setView(shown.currentBooking);
        setMode("view");
      } else if (result.error.code === "FULLY_BOOKED" || result.error.code === "DAY_CLOSED") {
        setDay("");
        setDaysVersion((v) => v + 1);
      } else {
        setMode("view");
      }
    } finally {
      actionBusy.current = false;
      setPending(false);
    }
  };

  const cancelBooking = () =>
    run(() =>
      view
        ? {
            kind: "cancel",
            request: freezeRequest("/api/bookings/manage/cancellation", { bookingId: view.id, idempotencyKey: crypto.randomUUID(), expectedRevision: view.revision }),
          }
        : null,
    );
  const moveBooking = () =>
    run(() =>
      view && day
        ? {
            kind: "reschedule",
            bookingDate: day,
            request: freezeRequest("/api/bookings/manage/rescheduling", {
              bookingId: view.id,
              idempotencyKey: crypto.randomUUID(),
              expectedRevision: view.revision,
              bookingDate: day,
            }),
          }
        : null,
    );
  const leaveMode = () => {
    setMode("view");
    setDay("");
    setActionError("");
  };
  const locked = pending || retryable;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
        {/* P1-50 (LE 2026-11-06): no top bar. One clear way back to the landing page, first on the page in every state. */}
        <Link
          href="/"
          className="group mb-6 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-card py-2 pl-3 pr-5 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0">
            <ArrowLeft className="h-4 w-4" />
          </span>
          Back to home
        </Link>
        <div className="mb-6">
          <h1 className="text-2xl font-bold sm:text-3xl">{phase === "booking" ? "Your booking" : "Open your booking"}</h1>
          <p className="mt-2 text-base text-muted-foreground">
            {phase === "code" ? "Enter the reference code from your confirmation and the last name you booked with." : "This page is private to you. Days are in Philippine time."}
          </p>
        </div>

        <div className="space-y-5">
          {phase === "loading" && (
            <div role="status" className={panel}>
              Opening your booking…
            </div>
          )}

          {phase === "error" && (
            <div role="alert" className={panel}>
              <p>{readError}</p>
              <button
                type="button"
                onClick={() => {
                  setPhase("loading");
                  setReadVersion((v) => v + 1);
                }}
                className="mt-4 min-h-[44px] underline"
              >
                Try again
              </button>
            </div>
          )}

          {phase === "code" && (
            <>
              {codeNotice && (
                <p role="status" className="rounded border border-border/80 bg-[#121214] p-3 text-sm text-foreground">
                  {codeNotice}
                </p>
              )}
              <BookingLookupForm
                onFound={(data) => {
                  setLookupContact(data.contact);
                  setView(data.booking);
                  setPhase("booking");
                }}
              />
              <section aria-labelledby="lost-title">
                <h2 id="lost-title" className="text-base font-bold text-foreground">
                  Can&apos;t find it?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Check the spelling of your reference code and last name, or contact the shop.
                </p>
                <ContactShop />
              </section>
            </>
          )}

          {phase === "booking" && view && (
            <>
              {done && (
                <p
                  id="manage-result"
                  tabIndex={-1}
                  role="status"
                  className="scroll-mt-6 rounded border border-emerald-500/50 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-400 focus-visible:outline-none"
                >
                  {done}
                </p>
              )}
              {actionError && (
                <div ref={alertRef} tabIndex={-1} role="alert" className="rounded border border-destructive p-4 text-sm text-destructive">
                  <p className="font-semibold">{actionError}</p>
                  {retryable && action && (
                    <button type="button" onClick={() => void run(() => unconfirmedAction.current)} disabled={pending} className={primary + " mt-3"}>
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      {pending ? "Retrying…" : action.kind === "cancel" ? "Retry cancelling" : "Retry the day change"}
                    </button>
                  )}
                </div>
              )}

              <ManagedBookingDetails
                view={view}
                contact={lookupContact}
                multiDay={multiDay}
                busy={locked || mode !== "view"}
                onCancel={() => {
                  setDone("");
                  setActionError("");
                  setMode("cancel");
                }}
                onChangeDay={() => {
                  setDone("");
                  setActionError("");
                  setFromDate(todayInManila());
                  setMode("day");
                }}
              />

              {mode === "cancel" && (
                <section aria-labelledby="cancel-title" className={panel}>
                  <h2 id="cancel-title" tabIndex={-1} className="scroll-mt-6 text-lg font-bold text-foreground focus-visible:outline-none">
                    Cancel this booking?
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your place on {dateLabel(view.bookingDate)} is released. You cannot undo this online.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void cancelBooking()}
                      disabled={locked}
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pending ? "Cancelling…" : "Yes, cancel my booking"}
                    </button>
                    <button type="button" onClick={leaveMode} disabled={locked} className={secondary}>
                      Keep my booking
                    </button>
                  </div>
                </section>
              )}

              {mode === "day" && (
                <>
                  <DayPicker
                    data={liveDays?.data ?? null}
                    error={liveDays?.error ?? ""}
                    onRetry={() => setDaysVersion((v) => v + 1)}
                    selected={day}
                    onSelect={setDay}
                    fromDate={fromDate}
                    onPage={(next) => {
                      setDay("");
                      setFromDate(next);
                    }}
                    multiDay={multiDay}
                    currentDay={view.bookingDate}
                    notice="Choosing a day does not hold a place. Your booking moves only when you confirm the new day."
                  />
                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={() => void moveBooking()} disabled={!day || locked} className={primary}>
                      {pending ? "Moving…" : day ? "Move my booking to " + dateLabel(day) : "Choose a new day"}
                    </button>
                    <button type="button" onClick={leaveMode} disabled={locked} className={secondary}>
                      Keep my current day
                    </button>
                  </div>
                </>
              )}

              {/* W12: how to pay comes before the screenshot upload. */}
              {canSendProof(view) && <PaymentInstructions where="manage" referenceCode={view.referenceCode} />}
              <DepositProofSection view={view} onUpdated={setView} onSignedOut={toCode} />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
                <p className="text-sm text-muted-foreground">On a shared device, sign out when you are done.</p>
                <button type="button" onClick={() => void signOut()} disabled={pending} className={secondary}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

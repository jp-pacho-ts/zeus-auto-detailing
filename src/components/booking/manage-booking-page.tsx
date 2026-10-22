"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, FileText, LogOut, RefreshCw, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { isMultiDay } from "@/components/booking/day-booking";
import { DayPicker, dateLabel, todayInManila } from "@/components/booking/day-picker";
import { DepositProofSection } from "@/components/booking/deposit-proof";
import { ContactShop, ManagedBookingDetails } from "@/components/booking/managed-booking-details";
import { PaymentInstructions } from "@/components/booking/payment-instructions";
import {
  MANAGE_HEADERS,
  canSendProof,
  codeFromText,
  freezeRequest,
  isAvailabilityData,
  isManagedView,
  isMutationData,
  isSessionData,
  manageActionError,
  parseLifecycle,
  sendFrozen,
  type FrozenRequest,
} from "@/components/booking/manage-booking";
import type { BookingCatalogResponse } from "@/types/catalog-contracts";
import type { ManagedDayAvailabilityData, ManagedDayBookingView } from "@/types/contracts";

// P1-05 second pass: the private booking page (ADR-002, P1-04 contract). No URL parameters: the
// saved code is exchanged once for the HttpOnly session cookie, and every later call relies on that
// cookie. The code stays in memory only while it is typed and is dropped after the exchange.
const panel = "rounded border border-border bg-card p-6 sm:p-8";
const primary =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded border border-border bg-card px-5 py-3 text-sm font-bold text-foreground transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50";

type Phase = "loading" | "code" | "booking" | "error";
type Mode = "view" | "cancel" | "day";
type Action = { kind: "cancel" | "reschedule"; request: FrozenRequest; bookingDate?: string };

const waitText = (seconds: number | null) => "Too many tries. Wait " + (seconds ?? 60) + " seconds, then try again.";

export function ManageBooking() {
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [readError, setReadError] = React.useState("");
  const [readVersion, setReadVersion] = React.useState(0);
  const [view, setView] = React.useState<ManagedDayBookingView | null>(null);
  const [multiDay, setMultiDay] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [codeError, setCodeError] = React.useState("");
  const [codeNotice, setCodeNotice] = React.useState("");
  const [codePending, setCodePending] = React.useState(false);
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
  const codeBusy = React.useRef(false);
  // The unconfirmed change, if any: only its own retry may run until it settles (same key).
  const unconfirmedAction = React.useRef<Action | null>(null);

  const toCode = React.useCallback((notice: string) => {
    unconfirmedAction.current = null;
    setView(null);
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
    if (actionError || codeError) alertRef.current?.focus();
  }, [actionError, codeError]);

  const openCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (codeBusy.current) return;
    setCodeNotice("");
    const accessToken = codeFromText(code);
    if (!accessToken) {
      setCodeError("Enter your full booking code. It is long: paste it, or open the code file you saved.");
      return;
    }
    codeBusy.current = true;
    setCodePending(true);
    setCodeError("");
    try {
      const result = await sendFrozen(fetch, freezeRequest("/api/bookings/manage/session", { accessToken }), isSessionData);
      if (result.ok) {
        setCode("");
        setView(result.data.booking);
        setPhase("booking");
        return;
      }
      const e = result.error;
      setCodeError(
        e.code === "UNAUTHENTICATED" || e.code === "VALIDATION_ERROR"
          ? "This code did not open a booking. Check that you copied all of it, or contact the shop."
          : e.code === "RATE_LIMITED"
            ? waitText(e.retryAfterSeconds)
            : e.code === "BOOKING_NOT_MANAGEABLE"
              ? "Please contact the shop about this booking."
              : "Your booking could not be opened right now. Try again.",
      );
    } finally {
      codeBusy.current = false;
      setCodePending(false);
    }
  };

  const readCodeFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 16 * 1024) return setCodeError("This is not a booking code file.");
    const found = codeFromText(await file.text());
    if (!found) return setCodeError("No booking code was found in this file.");
    setCodeError("");
    setCode(found);
  };

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
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Return to home" className="inline-flex min-h-[44px] items-center">
            <Logo />
          </Link>
          <span className="text-sm text-muted-foreground">Your booking</span>
          <Link href="/" aria-label="Return to home" className="flex min-h-[44px] min-w-[44px] items-center justify-center">
            <X aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 max-w-3xl">
          <h1 className="text-2xl font-bold sm:text-3xl">{phase === "booking" ? "Your booking" : "Open your booking"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Days are shown in Asia/Manila (UTC+8). This page is private to you: keep your booking code to yourself.
          </p>
        </div>

        <div className="max-w-3xl space-y-6">
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
              <form onSubmit={(e) => void openCode(e)} className={panel} aria-labelledby="code-form-title">
                <h2 id="code-form-title" className="text-lg font-bold text-foreground">
                  Enter your booking code
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  You got this code when you booked. Paste it below, or open the code file you saved.
                </p>
                {codeNotice && (
                  <p role="status" className="mt-4 rounded border border-border/80 bg-[#121214] p-3 text-sm text-foreground">
                    {codeNotice}
                  </p>
                )}
                {codeError && (
                  <div ref={alertRef} tabIndex={-1} role="alert" className="mt-4 rounded border border-destructive p-3 text-sm text-destructive">
                    {codeError}
                  </div>
                )}
                <label htmlFor="booking-code" className="mt-5 block text-sm font-semibold text-foreground">
                  Booking code
                </label>
                <textarea
                  id="booking-code"
                  name="booking-code"
                  rows={4}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(codeError)}
                  className="mt-2 w-full rounded border border-input bg-card px-4 py-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="submit" disabled={codePending || !code.trim()} className={primary}>
                    {codePending ? "Opening…" : "Open my booking"}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <label className={secondary + " cursor-pointer"}>
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Open saved code file
                    <input type="file" accept=".txt,text/plain" className="sr-only" onChange={(e) => void readCodeFile(e.target.files?.[0])} />
                  </label>
                </div>
              </form>

              <section aria-labelledby="lost-title" className={panel}>
                <h2 id="lost-title" className="text-base font-bold text-foreground">
                  Lost your code?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  For your privacy, a booking cannot be opened with its reference or phone number. Contact the shop with your
                  booking reference and they will help you.
                </p>
                <ContactShop />
              </section>
            </>
          )}

          {phase === "booking" && view && (
            <>
              {done && (
                <p role="status" className="rounded border border-emerald-500/50 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-400">
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
                  <h2 id="cancel-title" className="text-lg font-bold text-foreground">
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
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-destructive px-5 py-3 text-sm font-bold text-destructive-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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

              <DepositProofSection view={view} onUpdated={setView} onSignedOut={toCode} />
              {canSendProof(view) && <PaymentInstructions where="manage" />}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
                <p className="text-xs text-zinc-400">On a shared device, sign out when you are done.</p>
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

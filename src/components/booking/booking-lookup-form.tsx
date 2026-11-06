"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { Logo } from "@/components/ui/logo";
import { freezeRequest, isLookupData, sendFrozen } from "@/components/booking/manage-booking";
import { TurnstileChallenge, type ChallengeStatus } from "@/components/booking/turnstile";
import type { ManagedLookupData } from "@/types/contracts";

// P1-32: "Manage booking" the airline way. The reference code and the last name open the booking, with the
// same security check as the booking form. Every failure reads the same, so the page never says whether the
// code or the name was wrong. The private-link route below it keeps working.
// P1-50 (LE 2026-11-06, mock L1): a boarding pass. The fields sit on the ticket, the logo, the security check and the
// button on its stub. Targets are 56 px high, labels are visible, focus is a 2 px ring with an offset, and the stub grows
// with the security check (the normal widget is 300 px) instead of clipping it.
const field =
  "mt-2 h-14 w-full rounded-xl border border-input bg-background px-4 text-lg text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const primary =
  "inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-base font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-60";
// The two half-circles cut into the tear-off edge. Across the top of the stub on a phone, down its left edge from md up.
export const ticketNotch =
  "before:absolute before:-left-[14px] before:-top-[14px] before:h-[26px] before:w-[26px] before:rounded-full before:border before:border-border before:bg-background before:content-[''] " +
  "after:absolute after:-right-[14px] after:-top-[14px] after:h-[26px] after:w-[26px] after:rounded-full after:border after:border-border after:bg-background after:content-[''] " +
  "md:after:left-[-14px] md:after:right-auto md:after:top-auto md:after:-bottom-[14px]";
// The normal security-check widget is a fixed 300 px wide; below 360 px it is rendered compact (same rule as the booking form).
const NARROW_QUERY = "(max-width: 359px)";

export const LOOKUP_TEXT = {
  notFound: "We couldn't find that booking. Check the reference code and last name.",
  tooMany: "Too many tries. Use the link in your confirmation email, or call the shop.",
  challenge: "Complete the security check again.",
  later: "We couldn't check that right now. Try again in a moment.",
};

export function BookingLookupForm({ onFound }: { onFound: (data: ManagedLookupData) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const [reference, setReference] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [token, setToken] = React.useState("");
  const [challenge, setChallenge] = React.useState<ChallengeStatus>("pending");
  const [challengeKey, setChallengeKey] = React.useState(0);
  const [error, setError] = React.useState("");
  const [shown, setShown] = React.useState(0); // bumps on every message so focus follows even a repeated one
  const [pending, setPending] = React.useState(false);
  const busy = React.useRef(false);
  const alertRef = React.useRef<HTMLParagraphElement>(null);
  const [narrow, setNarrow] = React.useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(NARROW_QUERY).matches));
  React.useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query) return;
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  React.useEffect(() => {
    if (shown > 0) alertRef.current?.focus();
  }, [shown]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    if (!reference.trim() || !lastName.trim()) {
      setError(LOOKUP_TEXT.notFound);
      return;
    }
    if (!token) {
      setError(LOOKUP_TEXT.challenge);
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await sendFrozen(fetch, freezeRequest("/api/bookings/manage/lookup", { referenceCode: reference, lastName, turnstileToken: token }), isLookupData);
      if (result.ok) {
        setLastName("");
        onFound(result.data);
        return;
      }
      setError(
        result.error.code === "NOT_FOUND"
          ? LOOKUP_TEXT.notFound
          : result.error.code === "RATE_LIMITED"
            ? LOOKUP_TEXT.tooMany
            : result.error.code === "CHALLENGE_FAILED"
              ? LOOKUP_TEXT.challenge
              : LOOKUP_TEXT.later,
      );
    } finally {
      // A security-check token works once: every answer needs a fresh one.
      setToken("");
      setChallengeKey((k) => k + 1);
      busy.current = false;
      setPending(false);
      setShown((n) => n + 1);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby="lookup-title" noValidate>
      <h2 id="lookup-title" className="sr-only">
        Find your booking
      </h2>
      <div className="grid overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="p-5 sm:p-8">
          {error && (
            <p ref={alertRef} tabIndex={-1} role="alert" className="mb-6 rounded-xl border border-destructive p-3 text-sm text-destructive">
              {error}{" "}
              {error === LOOKUP_TEXT.tooMany && (
                <a href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`} className="font-semibold underline">
                  {brandConfig.displayPhone}
                </a>
              )}
            </p>
          )}
          <label htmlFor="lookup-reference" className="block text-sm font-bold text-foreground">
            Reference code
          </label>
          <input
            id="lookup-reference"
            name="reference"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            aria-describedby="lookup-reference-hint"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="ZEUS-ABC123"
            className={field + " font-mono tracking-wider"}
          />
          <p id="lookup-reference-hint" className="mt-2 text-sm text-muted-foreground">
            It starts with ZEUS- and is in your confirmation.
          </p>
          <label htmlFor="lookup-last-name" className="mt-6 block text-sm font-bold text-foreground">
            Last name
          </label>
          <input
            id="lookup-last-name"
            name="lastName"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={100}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="As you booked"
            className={field}
          />
        </div>
        <div
          data-part="stub"
          className={
            "relative flex min-w-0 flex-col justify-between gap-5 border-t-2 border-dashed border-foreground/25 bg-gradient-to-br from-primary/15 to-card p-5 sm:p-6 md:border-l-2 md:border-t-0 " +
            ticketNotch
          }
        >
          <div data-part="stub-mark">
            <Logo />
          </div>
          <div className="min-w-0">
            {siteKey ? (
              <TurnstileChallenge key={challengeKey + (narrow ? "n" : "w")} siteKey={siteKey} action="booking_lookup" size={narrow ? "compact" : "normal"} onToken={setToken} onStatus={setChallenge} />
            ) : (
              <p role="alert" className="text-sm text-destructive">
                The security check is not set up. Please contact the shop.
              </p>
            )}
          </div>
          <button type="submit" disabled={pending || !siteKey || challenge === "failed"} className={primary}>
            {pending ? "Checking…" : "Find my booking"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  );
}

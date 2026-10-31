"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { freezeRequest, isLookupData, sendFrozen } from "@/components/booking/manage-booking";
import { TurnstileChallenge, type ChallengeStatus } from "@/components/booking/turnstile";
import type { ManagedLookupData } from "@/types/contracts";

// P1-32: "Manage booking" the airline way. The reference code and the last name open the booking, with the
// same security check as the booking form. Every failure reads the same, so the page never says whether the
// code or the name was wrong. The private-link route below it keeps working.
const field =
  "mt-2 w-full rounded border border-input bg-card px-4 py-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const primary =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

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
  const [pending, setPending] = React.useState(false);
  const busy = React.useRef(false);
  const alertRef = React.useRef<HTMLParagraphElement>(null);

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
      queueMicrotask(() => alertRef.current?.focus());
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="rounded border border-border bg-card p-6 sm:p-8" aria-labelledby="lookup-title" noValidate>
      <h2 id="lookup-title" className="text-lg font-bold text-foreground">
        Find your booking
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the reference code from your confirmation and the last name you booked with.
      </p>
      {error && (
        <p ref={alertRef} tabIndex={-1} role="alert" className="mt-4 rounded border border-destructive p-3 text-sm text-destructive">
          {error}{" "}
          {error === LOOKUP_TEXT.tooMany && (
            <a href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`} className="font-semibold underline">
              {brandConfig.displayPhone}
            </a>
          )}
        </p>
      )}
      <label htmlFor="lookup-reference" className="mt-5 block text-sm font-semibold text-foreground">
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
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="ZEUS-ABC123"
        className={field + " font-mono"}
      />
      <label htmlFor="lookup-last-name" className="mt-5 block text-sm font-semibold text-foreground">
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
        className={field}
      />
      <div className="mt-5">
        {siteKey ? (
          <TurnstileChallenge key={challengeKey} siteKey={siteKey} action="booking_lookup" onToken={setToken} onStatus={setChallenge} />
        ) : (
          <p role="alert" className="text-sm text-destructive">
            The security check is not set up. Please contact the shop.
          </p>
        )}
      </div>
      <button type="submit" disabled={pending || !siteKey || challenge === "failed"} className={primary + " mt-5"}>
        {pending ? "Checking…" : "Find my booking"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}

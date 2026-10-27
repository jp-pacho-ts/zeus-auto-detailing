"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy, Download, KeyRound, Printer } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { managementCodeFile } from "@/components/booking/manage-booking";
import type { ManagementAccessGrant } from "@/types/contracts";

// The private booking code from the create response (ADR-002). It is held in memory and shown
// once; saving it is the customer's choice (copy, a downloaded file or a printout). It is never
// put in a URL or in browser storage. P1-19 W6 (Ruling R1): called a "private code" because it is
// pasted, never opened; this browser keeps a 24-hour session from the booking, so the copy says so.
const action =
  "inline-flex min-h-[44px] items-center gap-2 rounded border border-input bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary";

const validUntil = (iso: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(iso));
// ADR-005: online changes close at 18:00 Manila on the day before the booked day.
const changesCloseAt = (bookingDate: string) => Date.parse(bookingDate + "T00:00:00+08:00") - 6 * 3600000;
const tel = `tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`;

export function ManagementCode({
  referenceCode,
  bookingDate,
  access,
  now = new Date(),
}: {
  referenceCode: string;
  bookingDate: string;
  access: ManagementAccessGrant | null;
  now?: Date;
}) {
  const [copied, setCopied] = React.useState(false);

  if (!access)
    return (
      <section aria-labelledby="code-title" className="rounded border border-border bg-card p-4 sm:p-8">
        <h2 id="code-title" className="text-base font-bold text-foreground">Your private code</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your private code could not be shown here. To change or cancel this booking, please contact the shop at{" "}
          <a href={tel} className="font-semibold text-primary hover:underline">
            {brandConfig.displayPhone}
          </a>
          .
        </p>
      </section>
    );

  const closed = now.getTime() >= changesCloseAt(bookingDate);
  const copy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(access.accessToken).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };
  const download = () => {
    const file = managementCodeFile({ referenceCode, bookingDate, accessToken: access.accessToken, expiresAt: access.expiresAt, origin: window.location.origin });
    const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section aria-labelledby="code-title" className="print-receipt-card rounded border border-primary/60 bg-card p-4 sm:p-8">
      <div className="flex items-center gap-3">
        <KeyRound aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" />
        <h2 id="code-title" className="text-lg font-bold text-foreground">Your private code</h2>
      </div>

      <p className="mt-3 text-base text-foreground">
        Your booking page shows your booking{closed ? "" : " and lets you change the day or cancel"}. This phone and browser open your booking
        without it for 24 hours. Save the private code to open it on another phone or later.
      </p>
      {closed && (
        <p role="note" className="mt-3 flex items-start gap-2.5 rounded border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Online changes for this booking are closed: they close at 6 PM the day before. To change or cancel, call the shop at{" "}
            <a href={tel} className="font-semibold underline">
              {brandConfig.displayPhone}
            </a>
            .
          </span>
        </p>
      )}

      <div className="no-print mt-4">
        <Link
          href="/book/manage"
          className="inline-flex min-h-[48px] items-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Open my booking page
        </Link>
      </div>

      <p
        aria-label="Private code"
        className="mt-5 select-all break-all rounded border border-border bg-[#121214] p-4 font-mono text-sm leading-relaxed text-foreground"
      >
        {access.accessToken}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Keep it private: anyone with it can see and change your booking. Valid until {validUntil(access.expiresAt)} (Philippine time).
      </p>

      <div className="no-print mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={action} aria-label="Copy private code">
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" aria-hidden="true" />
              <span>Copy code</span>
            </>
          )}
        </button>
        <button type="button" onClick={download} className={action}>
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>Download code</span>
        </button>
        <button type="button" onClick={() => window.print()} className={action}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          <span>Print code</span>
        </button>
      </div>
    </section>
  );
}

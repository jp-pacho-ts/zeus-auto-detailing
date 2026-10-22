"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy, Download, KeyRound, Printer } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { managementCodeFile } from "@/components/booking/manage-booking";
import type { ManagementAccessGrant } from "@/types/contracts";

// The private booking code from the create response (ADR-002). It is held in memory and shown
// once; saving it is the customer's choice (copy, a downloaded file or a printout). It is never
// put in a URL or in browser storage.
const action =
  "inline-flex min-h-[44px] items-center gap-2 rounded border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-zinc-500 hover:text-primary";

const validUntil = (iso: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(iso));

export function ManagementCode({
  referenceCode,
  bookingDate,
  access,
}: {
  referenceCode: string;
  bookingDate: string;
  access: ManagementAccessGrant | null;
}) {
  const [copied, setCopied] = React.useState(false);

  if (!access)
    return (
      <section aria-labelledby="code-title" className="rounded border border-border bg-card p-6 sm:p-8">
        <h2 id="code-title" className="text-base font-bold text-foreground">Your booking code</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your booking code could not be shown here. To change or cancel this booking, please contact the shop at{" "}
          <a href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`} className="font-semibold text-primary hover:underline">
            {brandConfig.displayPhone}
          </a>
          .
        </p>
      </section>
    );

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
    <section aria-labelledby="code-title" className="print-receipt-card rounded border border-primary/60 bg-card p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <KeyRound aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" />
        <h2 id="code-title" className="text-lg font-bold text-foreground">Your booking code</h2>
      </div>

      <div role="note" className="mt-4 flex items-start gap-2.5 rounded border border-warning/50 bg-warning/10 p-4 text-sm text-warning">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Save this code. You need it to change or cancel your booking.</p>
          <p className="mt-1">It is shown only on this page. Keep it private: anyone with it can change or cancel your booking.</p>
        </div>
      </div>

      <p
        aria-label="Booking code"
        className="mt-4 select-all break-all rounded border border-border bg-[#121214] p-4 font-mono text-xs leading-relaxed text-foreground"
      >
        {access.accessToken}
      </p>
      <p className="mt-2 text-xs text-zinc-400">Valid until {validUntil(access.expiresAt)} (Asia/Manila).</p>

      <div className="no-print mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={action} aria-label="Copy booking code">
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

      <p className="no-print mt-5 text-sm text-muted-foreground">
        On your booking page you can see your booking, change its day, cancel it or send a deposit screenshot.
      </p>
      <Link
        href="/book/manage"
        className="no-print mt-3 inline-flex min-h-[48px] items-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Open my booking page
      </Link>
    </section>
  );
}

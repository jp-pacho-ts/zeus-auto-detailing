"use client";

import Link from "next/link";
import { AlertTriangle, CalendarCheck } from "lucide-react";
import { brandConfig } from "@/config/brand";
import type { ManagementAccessGrant } from "@/types/contracts";

// P1-48 (LE 2026-11-06): the confirmation no longer shows the long private code. A customer finds
// their booking again with the reference code and last name (P1-32), so this card only says that
// and links to the page. The create response still carries the grant; it is simply not displayed.
const changesCloseAt = (bookingDate: string) => Date.parse(bookingDate + "T00:00:00+08:00") - 6 * 3600000; // ADR-005: 18:00 Manila the day before
const tel = `tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`;

export function ManagementCode({
  referenceCode,
  bookingDate,
  now = new Date(),
}: {
  referenceCode: string;
  bookingDate: string;
  access?: ManagementAccessGrant | null;
  now?: Date;
}) {
  const closed = now.getTime() >= changesCloseAt(bookingDate);

  return (
    <section aria-labelledby="manage-title" className="print-receipt-card rounded-2xl border border-primary/60 bg-card p-4 sm:p-8">
      <div className="flex items-center gap-3">
        <CalendarCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" />
        <h2 id="manage-title" className="text-lg font-bold text-foreground">Manage your booking</h2>
      </div>

      <p className="mt-3 text-base text-foreground">
        To see your booking{closed ? "" : ", change the day or cancel"}, open Manage booking and enter your reference code{" "}
        <span className="font-mono font-semibold">{referenceCode}</span> and your last name.
      </p>
      {closed && (
        <p role="note" className="mt-3 flex items-start gap-2.5 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
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
          className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Manage my booking
        </Link>
      </div>
    </section>
  );
}

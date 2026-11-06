"use client";

import { Check, Copy, Printer } from "lucide-react";
import { ticketNotch } from "@/components/booking/booking-lookup-form";

// P1-52 (LE 2026-11-06): "Booking received" as a boarding pass, the same ticket as the Manage booking lookup. The reference code
// and its status are on the main side; the booking's details are on the stub, past a dashed tear-off edge with two notches
// (vertical from md up, horizontal on a phone). Nothing here prices or decides anything: every value arrives ready to show.
export type TicketBooking = {
  referenceCode: string;
  statusWords: string;
  confirmed: boolean;
  dayLabel: string;
  arrival: string;
  multiDay: boolean;
  lines: { id: string; name: string; quantity: number; amount: string }[];
  vehicle: string;
  contact: string;
  total: { label: string; amount: string; note: string | null };
};

const action =
  "inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-input bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

export function BookingTicket({
  booking,
  copied,
  onCopy,
  onPrint,
}: {
  booking: TicketBooking;
  copied: boolean;
  onCopy: () => void;
  onPrint: () => void;
}) {
  return (
    <section
      aria-labelledby="reference-title"
      className="print-receipt-card grid overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[minmax(0,1fr)_330px]"
    >
      <div className="min-w-0 p-5 sm:p-8">
        <p className="text-sm text-muted-foreground">Booking reference</p>
        <h2
          id="reference-title"
          className="mt-1 break-all font-mono text-3xl font-extrabold tracking-wider text-foreground sm:text-4xl"
        >
          {booking.referenceCode}
        </h2>
        <p className="mt-3 inline-block rounded-full bg-primary/15 px-3.5 py-1.5 text-sm font-semibold text-primary">{booking.statusWords}</p>
        <p className="mt-4 text-base text-foreground">
          {booking.confirmed ? "Your booking is confirmed." : "Your request is sent. The shop will text or call you to confirm."}
        </p>
        <p className="mt-2 text-base text-foreground">
          <strong>{booking.dayLabel}.</strong> {booking.arrival}
          {booking.multiDay && " This job takes more than one day: this is your drop-off day, and the shop tells you when your car is ready."}
        </p>
        <div className="no-print mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onCopy} className={action} aria-label="Copy booking reference">
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden="true" />
                <span>Copy reference</span>
              </>
            )}
          </button>
          <button type="button" onClick={onPrint} className={action}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            <span>Print receipt</span>
          </button>
        </div>
      </div>
      <div
        data-part="stub"
        className={
          "relative min-w-0 border-t-2 border-dashed border-foreground/25 bg-gradient-to-br from-primary/15 to-card p-5 sm:p-6 md:border-l-2 md:border-t-0 " +
          ticketNotch
        }
      >
        <h3 id="details-title" className="text-base font-bold text-foreground">
          Booking details
        </h3>
        <dl className="mt-3 divide-y divide-border/60 text-sm">
          <div className="py-3">
            <dt className="text-muted-foreground">Services</dt>
            <dd className="mt-0.5 text-foreground">
              <ul className="space-y-1">
                {booking.lines.map((l) => (
                  <li key={l.id} className="break-words">
                    <span className="font-semibold">
                      {l.name}
                      {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                    </span>{" "}
                    <span className="text-muted-foreground">· {l.amount}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="py-3">
            <dt className="text-muted-foreground">Vehicle</dt>
            <dd className="mt-0.5 break-words text-foreground">{booking.vehicle}</dd>
          </div>
          <div className="py-3">
            <dt className="text-muted-foreground">Your contact</dt>
            <dd className="mt-0.5 break-words text-foreground">{booking.contact}</dd>
          </div>
          <div className="py-3">
            <dt className="text-muted-foreground">{booking.total.label}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{booking.total.amount}</dd>
            {booking.total.note && <p className="mt-0.5 text-sm text-muted-foreground">{booking.total.note}</p>}
          </div>
        </dl>
      </div>
    </section>
  );
}

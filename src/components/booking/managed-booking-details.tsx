import { CalendarClock, MessageSquare, Phone, XCircle } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { lineAmount, quoteTotal } from "@/components/booking/day-booking";
import { dateLabel } from "@/components/booking/day-picker";
import { BookingProgress } from "@/components/booking/booking-progress";
import { bookingStatusWords, selfServiceNotice } from "@/components/booking/manage-booking";
import type { ManagedDayBookingView } from "@/types/contracts";

// The customer's own booking, status only (LE 2026-10-21, ADR-005 §12-13): no bay, worker,
// position, line progress or staff text. Only the listed view fields are ever rendered.
// P1-49 (LE 2026-11-06, mock design A): a hero card (reference, status, progress), then tiles, then the two actions.
const panel = "rounded border border-border bg-card p-6 sm:p-8";
const tile = "rounded-lg border border-border bg-card px-5 py-4";
const tileLabel = "text-sm text-muted-foreground";
const cutoffLabel = (iso: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(iso));

export function ContactShop({ referenceCode }: { referenceCode?: string }) {
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <a
        href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
        className="inline-flex min-h-[44px] items-center gap-2 rounded border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
        Call the shop ({brandConfig.displayPhone})
      </a>
      <a
        href={`${brandConfig.facebookMessengerUrl}?text=${encodeURIComponent(
          referenceCode ? `Hi, I have a question about booking ${referenceCode}.` : "Hi, I need help with my private booking code.",
        )}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center gap-2 rounded border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
        Message on Facebook Messenger
      </a>
    </div>
  );
}

export function ManagedBookingDetails({
  view,
  multiDay,
  busy,
  onCancel,
  onChangeDay,
  contact,
}: {
  view: ManagedDayBookingView;
  multiDay: boolean;
  busy: boolean;
  onCancel: () => void;
  onChangeDay: () => void;
  contact?: { phone: string; email: string | null } | null;
}) {
  // A booking opened by reference code and last name carries no money at all (P1-32 F1): show no price and no total then.
  const total =
    view.totalPriceCentavos === undefined
      ? null
      : quoteTotal({
          totalPriceCentavos: view.totalPriceCentavos,
          estimatedTotalCentavos: view.estimatedTotalCentavos ?? null,
          lines: view.lines.map((l) => ({ priceStatus: l.priceStatus ?? "PRICED" })),
        });
  const notice = selfServiceNotice(view);
  return (
    <section aria-labelledby="booking-title" className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,rgb(var(--primary)/0.16),transparent_55%)]"
        />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Booking reference</p>
              <h2 id="booking-title" className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl">
                {view.referenceCode}
              </h2>
            </div>
            <p className="whitespace-nowrap rounded-full border border-primary/40 bg-primary/15 px-3 py-1.5 text-sm font-bold text-primary">
              {bookingStatusWords(view.status)}
            </p>
          </div>
          <div className="mt-7">
            <BookingProgress status={view.status} />
          </div>
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className={tile}>
          <dt className={tileLabel}>{multiDay ? "Drop-off day" : "Day"}</dt>
          <dd className="mt-1 font-bold text-foreground">
            {dateLabel(view.bookingDate)} · {view.timezone}
          </dd>
          {multiDay && <p className="mt-1 text-sm text-muted-foreground">This job takes more than one day; the shop tells you when your car is ready.</p>}
        </div>
        <div className={tile}>
          <dt className={tileLabel}>Vehicle size</dt>
          <dd className="mt-1 font-bold text-foreground">{view.vehicleCategoryName}</dd>
        </div>
        <div className={tile + " sm:col-span-2"}>
          <dt className={tileLabel}>Services</dt>
          <dd className="mt-1 text-foreground">
            <ul className="space-y-1">
              {view.lines.map((l) => (
                <li key={l.serviceId} className="break-words">
                  <span className="font-bold">
                    {l.name}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                  </span>{" "}
                  {l.priceStatus !== undefined && l.subtotalCentavos !== undefined && l.referenceSubtotalCentavos !== undefined && (
                    <span className="text-sm text-muted-foreground">
                      · {lineAmount({ priceStatus: l.priceStatus, subtotalCentavos: l.subtotalCentavos, referenceSubtotalCentavos: l.referenceSubtotalCentavos })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {total && (
          <div className={tile + " sm:col-span-2"}>
            <dt className={tileLabel}>{total.label}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{total.amount}</dd>
            {total.note && <p className="mt-0.5 text-sm text-muted-foreground">{total.note}</p>}
          </div>
        )}
        {contact && (
          <div className={tile + " sm:col-span-2"}>
            <dt className={tileLabel}>Contact details on file</dt>
            <dd className="mt-1 font-bold text-foreground">
              <span>{contact.phone}</span>
              {contact.email && (
                <>
                  {" · "}
                  <span className="break-all">{contact.email}</span>
                </>
              )}
            </dd>
            <p className="mt-1 text-sm text-muted-foreground">To change them, contact the shop.</p>
          </div>
        )}
      </dl>

      {notice ? (
        <div className="rounded-lg border border-border/80 bg-surface p-4">
          <p className="text-sm font-semibold text-foreground">{notice}</p>
          {view.status !== "CANCELLED" && view.status !== "COMPLETED" && <ContactShop referenceCode={view.referenceCode} />}
        </div>
      ) : (
        <div className={panel}>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onChangeDay}
              disabled={busy}
              className="inline-flex min-h-[48px] items-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Change day
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex min-h-[48px] items-center gap-2 rounded border border-destructive/60 px-5 py-3 text-sm font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancel booking
            </button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">You can change the day or cancel online until {cutoffLabel(view.selfServiceCutoff)}.</p>
        </div>
      )}
    </section>
  );
}

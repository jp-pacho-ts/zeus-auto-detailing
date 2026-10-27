import { CalendarClock, MessageSquare, Phone, ShieldCheck, XCircle } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { lineAmount, quoteTotal } from "@/components/booking/day-booking";
import { dateLabel } from "@/components/booking/day-picker";
import { bookingStatusWords, selfServiceNotice } from "@/components/booking/manage-booking";
import type { ManagedDayBookingView } from "@/types/contracts";

// The customer's own booking, status only (LE 2026-10-21, ADR-005 §12-13): no bay, worker,
// position, line progress or staff text. Only the listed view fields are ever rendered.
const panel = "rounded border border-border bg-card p-6 sm:p-8";
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
}: {
  view: ManagedDayBookingView;
  multiDay: boolean;
  busy: boolean;
  onCancel: () => void;
  onChangeDay: () => void;
}) {
  const total = quoteTotal(view);
  const notice = selfServiceNotice(view);
  return (
    <section aria-labelledby="booking-title" className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <ShieldCheck aria-hidden="true" className="h-8 w-8 shrink-0 text-primary" />
          <div>
            <p className="text-sm text-muted-foreground">Booking reference</p>
            <h2 id="booking-title" className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl">
              {view.referenceCode}
            </h2>
          </div>
        </div>
        <p className="rounded bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">{bookingStatusWords(view.status)}</p>
      </div>

      <dl className="mt-4 divide-y divide-border/60 text-sm">
        <div className="py-3">
          <dt className="text-sm text-muted-foreground">{multiDay ? "Drop-off day" : "Day"}</dt>
          <dd className="mt-0.5 font-bold text-foreground">
            {dateLabel(view.bookingDate)} · {view.timezone}
          </dd>
          {multiDay && (
            <p className="mt-0.5 text-sm text-muted-foreground">This job takes more than one day; the shop tells you when your car is ready.</p>
          )}
        </div>
        <div className="py-3">
          <dt className="text-sm text-muted-foreground">Vehicle size</dt>
          <dd className="mt-0.5 text-foreground">{view.vehicleCategoryName}</dd>
        </div>
        <div className="py-3">
          <dt className="text-sm text-muted-foreground">Services</dt>
          <dd className="mt-0.5 text-foreground">
            <ul className="space-y-1">
              {view.lines.map((l) => (
                <li key={l.serviceId} className="break-words">
                  <span className="font-semibold">
                    {l.name}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                  </span>{" "}
                  <span className="text-sm text-muted-foreground">· {lineAmount(l)}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="py-3">
          <dt className="text-sm text-muted-foreground">{total.label}</dt>
          <dd className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{total.amount}</dd>
          {total.note && <p className="mt-0.5 text-sm text-muted-foreground">{total.note}</p>}
        </div>
      </dl>

      {notice ? (
        <div className="mt-4 rounded border border-border/80 bg-[#121214] p-4">
          <p className="text-sm font-semibold text-foreground">{notice}</p>
          {view.status !== "CANCELLED" && view.status !== "COMPLETED" && <ContactShop referenceCode={view.referenceCode} />}
        </div>
      ) : (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">You can change the day or cancel online until {cutoffLabel(view.selfServiceCutoff)}.</p>
          <div className="mt-3 flex flex-wrap gap-3">
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
        </div>
      )}
    </section>
  );
}

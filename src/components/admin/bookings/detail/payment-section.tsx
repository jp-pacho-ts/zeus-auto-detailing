import { Button } from "@/components/ui/button";
import type { AdminBookingDetail } from "@/types/admin-contracts";
import { parsePaymentDetails, paymentModeLabel } from "../model";
import { fieldClass } from "../use-admin-resource";
import { DepositBadge } from "../deposit-badge";
import { dangerText, doneButton, label, panel, panelHead, sectionTitle, sentAt, type Write } from "./shared";

export function PaymentSection({ b, admin, disabled, write }: { b: AdminBookingDetail; admin: boolean; disabled: boolean; write: Write }) {
  return (
    <section aria-label="Payment" className={panel}>
      <div className={panelHead}>
        <h3 className={sectionTitle}>Payment and deposit</h3>
        <DepositBadge status={b.depositStatus} showNone />
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <p className="text-sm">
          <span className="text-muted-foreground">Pays by</span>{" "}
          <span className="font-medium text-foreground">{paymentModeLabel(parsePaymentDetails(b.notes).mode)}</span>
        </p>
        {b.depositProofs.length === 0 ? (
          <p className="text-sm text-muted-foreground">The customer has not sent a deposit screenshot.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {b.depositProofs.map((p, i) => {
              const src = `/api/admin/bookings/${b.id}/deposit-proofs/${p.id}`;
              return (
                <li key={p.id} className="space-y-1">
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-lg border border-border bg-black hover:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {/* A private, staff-only image: next/image would route it through the public optimizer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`Deposit screenshot ${i + 1}, sent ${sentAt(p.createdAt)}`}
                      width={p.width}
                      height={p.height}
                      loading="lazy"
                      className="h-32 w-full object-contain"
                    />
                  </a>
                  <p className="text-xs text-muted-foreground">{sentAt(p.createdAt)} · opens full size</p>
                </li>
              );
            })}
          </ul>
        )}
        {admin && b.snapshot === "QUEUE_V3" && (
          <form
            className="space-y-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              // The clicked button carries the decision.
              const f = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
              const reason = String(f.get("depositReason") ?? "").trim();
              void write("/deposit", { status: String(f.get("depositStatus")), ...(reason ? { reason } : {}) });
            }}
          >
            <label className={`block ${label}`}>
              Note for the shop record (optional, staff only)
              <input name="depositReason" maxLength={500} placeholder="e.g. Verified GCash Ref #123456789" className={fieldClass} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button name="depositStatus" value="RECEIVED" size="sm" disabled={disabled || b.depositStatus === "RECEIVED"} className={doneButton}>
                Mark deposit received
              </Button>
              <Button
                name="depositStatus"
                value="REJECTED"
                size="sm"
                variant="outline"
                disabled={disabled || b.depositStatus === "REJECTED" || b.depositProofs.length === 0}
                className={dangerText}
              >
                Mark deposit rejected
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

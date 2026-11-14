import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBookingDetail, AdminDayQueues } from "@/types/admin-contracts";
import { fieldClass, Select, dateClass } from "../use-admin-resource";
import { dangerText, label, panel, primary, sectionTitle, submit, type Write } from "./shared";

const row = "group";
const rowSummary =
  "flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5 [&::-webkit-details-marker]:hidden";
const rowHint = "ml-auto hidden text-right text-xs font-normal text-muted-foreground sm:block";
const chevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />;
const rowPad = "px-4 pb-4 sm:px-5";
const rowBody = `space-y-3 ${rowPad}`;

// Less frequent and risky actions, grouped at the end. Each opens in place; every confirm stays as it was.
export function ManageSection({
  b,
  admin,
  open,
  disabled,
  write,
  queues,
  typed,
  setTyped,
}: {
  b: AdminBookingDetail;
  admin: boolean;
  open: boolean;
  disabled: boolean;
  write: Write;
  queues: AdminDayQueues["queues"];
  typed: string;
  setTyped: (value: string) => void;
}) {
  const email = (type: "reminder" | "confirmation" | "turn", what: string) => {
    if (b.customerEmail && window.confirm(`Send the "${what}" email to ${b.customerEmail}?`)) void write("/notify", type === "turn" ? {} : { type });
  };
  const canMove = admin && open && b.snapshot === "QUEUE_V3" && ["PENDING", "CONFIRMED"].includes(b.status);
  if (!open && !admin) return null;
  return (
    <section aria-label="Manage booking" className={panel}>
      <h3 className={`border-b border-border px-4 py-3 sm:px-5 ${sectionTitle}`}>Manage booking</h3>
      <div className="divide-y divide-border">
        {open && (
          <details className={row}>
            <summary className={`${rowSummary} text-foreground`}>
              <span>Email the customer</span>
              <span className={rowHint}>{b.customerEmail ? "3 messages" : "No email on file"}</span>
              {chevron}
            </summary>
            <div className={rowBody}>
              {!b.customerEmail && <p className="text-xs text-muted-foreground">No email on file. Add one with Edit details.</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={disabled || !b.customerEmail} onClick={() => email("confirmation", "booking received")}>
                  Booking received
                </Button>
                <Button variant="outline" size="sm" disabled={disabled || !b.customerEmail} onClick={() => email("reminder", "see you tomorrow")}>
                  Reminder for tomorrow
                </Button>
                <Button variant="outline" size="sm" disabled={disabled || !b.customerEmail} onClick={() => email("turn", "your turn is coming up")}>
                  Your turn is coming up
                </Button>
              </div>
            </div>
          </details>
        )}

        {canMove && (
          <details className={row}>
            <summary className={`${rowSummary} text-foreground`}>
              <span>Reschedule</span>
              <span className={rowHint}>Move to another day or queue</span>
              {chevron}
            </summary>
            <form
              onSubmit={(e) =>
                submit(e, (f) => {
                  if (window.confirm("Move this booking to the selected day and queue?"))
                    void write("/move", { toDate: String(f.get("date")), toQueueCode: String(f.get("queue")) });
                })
              }
              className={`${rowPad} grid items-end gap-2 sm:grid-cols-3`}
            >
              <label className={label}>
                New date
                <input type="date" name="date" required defaultValue={b.bookingDate} className={dateClass + " block"} />
              </label>
              <label className={label}>
                Queue
                <Select name="queue" defaultValue={b.queueCode ?? ""}>
                  {queues
                    .filter((q) => q.isActive)
                    .map((q) => (
                      <option key={q.code} value={q.code}>
                        {q.name}
                      </option>
                    ))}
                </Select>
              </label>
              <Button variant="outline" disabled={disabled}>
                Move booking
              </Button>
            </form>
          </details>
        )}

        {admin && open && (
          <details className={row}>
            <summary className={`${rowSummary} ${dangerText}`}>
              <span>Decline booking</span>
              <span className={rowHint}>Frees its place; you can reinstate it later</span>
              {chevron}
            </summary>
            <form
              onSubmit={(e) =>
                submit(e, (f) => {
                  if (window.confirm("Decline this booking and release its capacity?")) void write("/decline", { reason: String(f.get("reason")) });
                })
              }
              className={`${rowPad} flex flex-wrap items-end gap-2`}
            >
              <p className="basis-full text-xs text-muted-foreground">Frees its place in the queue. You can reinstate it later.</p>
              <label className={`${label} min-w-0 flex-1 basis-full sm:basis-0`}>
                Reason
                <input name="reason" required maxLength={500} placeholder="Reason for declining this booking" className={fieldClass} />
              </label>
              <Button variant="destructive" disabled={disabled}>
                Decline booking
              </Button>
            </form>
          </details>
        )}

        {admin && (
          <details className={row}>
            <summary className={`${rowSummary} ${dangerText}`}>
              <span id="delete-booking-title">Delete booking</span>
              <span className={rowHint}>Permanent; type the reference to confirm</span>
              {chevron}
            </summary>
            <form
              aria-labelledby="delete-booking-title"
              onSubmit={(e) => submit(e, (f) => void write("/delete", { reference: String(f.get("reference")) }))}
              className={rowBody}
            >
              <p className="text-xs text-muted-foreground">
                Deleting removes this booking, its services, any deposit proof and its place on the board for good. It also removes it from
                history, from the day&apos;s counts and from any totals built from completed jobs. A short record that you deleted it is kept.
              </p>
              <label className={`block ${label}`}>
                Type {b.referenceCode} to confirm
                <input name="reference" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} className={fieldClass} />
              </label>
              <Button variant="destructive" disabled={disabled || typed !== b.referenceCode}>
                Delete booking
              </Button>
            </form>
          </details>
        )}
      </div>
    </section>
  );
}

// Reinstate is the only way back for a declined booking, so it sits at the top of the body.
export function ReinstateBanner({ disabled, write }: { disabled: boolean; write: Write }) {
  return (
    <section aria-label="Reinstate booking" className="space-y-3 rounded-xl border border-rose-600/30 bg-rose-500/5 p-4 sm:p-5">
      <div>
        <h3 className={sectionTitle}>Declined by the shop</h3>
        <p className="text-xs text-muted-foreground">Reinstate it to put it back in the queue. Capacity is checked first.</p>
      </div>
      <form
        onSubmit={(e) =>
          submit(e, (f) => {
            if (window.confirm("Reinstate this shop-declined booking? Capacity will be checked."))
              void write("/status", { status: "PENDING", reason: String(f.get("reason")) });
          })
        }
        className="flex flex-wrap items-end gap-2"
      >
        <label className={`${label} min-w-0 flex-1 basis-full sm:basis-0`}>
          Reason
          <input name="reason" required maxLength={500} placeholder="Reason for reinstating" className={fieldClass} />
        </label>
        <Button disabled={disabled} className={primary}>
          Reinstate booking
        </Button>
      </form>
    </section>
  );
}

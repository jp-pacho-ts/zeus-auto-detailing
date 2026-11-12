import * as React from "react";
import { Banknote, Clock, CreditCard, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBookingDetail } from "@/types/admin-contracts";
import { formatNotesWithPayment, parsePaymentDetails, type PaymentMode } from "../model";
import { fieldClass } from "../use-admin-resource";
import { label, panel, primary, quiet, sectionTitle, type Write } from "./shared";

const MODES = [
  { value: "CASH", label: "Cash", Icon: Banknote },
  { value: "CARD", label: "Card (POS)", Icon: CreditCard },
  { value: "ONLINE_QR", label: "Online / QR", Icon: QrCode },
  { value: "PENDING", label: "Pending", Icon: Clock },
] as const;

// Not keyed by revision (unlike the other sections), so a failed save keeps what was typed.
export function CustomerSection({
  b,
  admin,
  busy,
  disabled,
  write,
}: {
  b: AdminBookingDetail;
  admin: boolean;
  busy: boolean;
  disabled: boolean;
  write: Write;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [model, setModel] = React.useState("");
  const [plate, setPlate] = React.useState("");
  const [mode, setMode] = React.useState<PaymentMode>("PENDING");
  const [notes, setNotes] = React.useState("");
  const parsed = parsePaymentDetails(b.notes);

  const start = () => {
    setName(b.customerName);
    setPhone(b.customerPhone);
    setEmail(b.customerEmail ?? "");
    setModel(b.vehicleModel);
    setPlate(b.vehiclePlate ?? "");
    const p = parsePaymentDetails(b.notes);
    setMode(p.mode);
    setNotes(p.notes);
    setEditing(true);
  };

  if (editing)
    return (
      <form
        aria-label="Edit customer and vehicle"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await write(
            "",
            {
              customerName: name.trim(),
              customerPhone: phone.trim(),
              customerEmail: email.trim() ? email.trim() : null,
              vehicleModel: model.trim(),
              vehiclePlate: plate.trim() ? plate.trim() : null,
              notes: formatNotesWithPayment(mode, notes),
            },
            "PATCH",
          );
          if (ok) setEditing(false);
        }}
        className={`${panel} space-y-4 p-4 sm:p-5`}
      >
        <h3 className={sectionTitle}>Edit customer and vehicle</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <label className={label}>
            Customer name *
            <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={fieldClass} disabled={disabled} />
          </label>
          <label className={label}>
            Customer phone *
            <input required value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} className={fieldClass} disabled={disabled} />
          </label>
          <label className={label}>
            Customer email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} className={fieldClass} disabled={disabled} />
          </label>
          <label className={label}>
            Vehicle model *
            <input required value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} className={fieldClass} disabled={disabled} />
          </label>
          <label className={`${label} sm:col-span-2 lg:col-span-1`}>
            Vehicle plate
            <input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} className={fieldClass} disabled={disabled} />
          </label>
          <fieldset className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <legend className={label}>Mode of payment</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              {MODES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={mode === opt.value}
                  onClick={() => setMode(opt.value)}
                  className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    mode === opt.value
                      ? "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-300"
                      : "border-border bg-raised text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <opt.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label className={`${label} sm:col-span-2 lg:col-span-1`}>
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} className={fieldClass} disabled={disabled} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled} className={primary}>
            Save changes
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );

  return (
    <section aria-label="Customer and vehicle" className={`${panel} p-4 sm:p-5`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className={sectionTitle}>Customer</h3>
        {admin && (
          <button type="button" onClick={start} disabled={disabled} className={`${quiet} min-h-[36px]`}>
            Edit details
          </button>
        )}
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className={label}>Phone</dt>
          <dd>
            <a href={`tel:${b.customerPhone}`} className="font-medium text-foreground hover:underline">
              {b.customerPhone}
            </a>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={label}>Email</dt>
          <dd className="truncate">
            {b.customerEmail ? (
              <a href={`mailto:${b.customerEmail}`} className="font-medium text-foreground hover:underline">
                {b.customerEmail}
              </a>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </dd>
        </div>
        {parsed.notes && (
          <div>
            <dt className={label}>Notes</dt>
            <dd className="whitespace-pre-wrap break-words text-foreground">{parsed.notes}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

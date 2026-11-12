import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBookingDetail, AdminLine } from "@/types/admin-contracts";
import type { BookingCatalog } from "@/types/catalog-contracts";
import { centavos, money, statusLabel } from "../model";
import { fieldClass, LoadState } from "../use-admin-resource";
import { dangerText, label, panel, panelHead, primary, sectionTitle, statusPill, submit, type Write } from "./shared";

const segment: Record<AdminLine["workStatus"], string> = {
  WAITING: "bg-zinc-500/25 font-semibold text-foreground",
  IN_PROGRESS: "bg-amber-500 font-semibold text-zinc-950",
  DONE: "bg-emerald-600 font-semibold text-white",
};

function ServiceRow({
  b,
  line,
  admin,
  open,
  disabled,
  write,
  setError,
}: {
  b: AdminBookingDetail;
  line: AdminLine;
  admin: boolean;
  open: boolean;
  disabled: boolean;
  write: Write;
  setError: (message: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const editorId = React.useId();
  const editable = b.snapshot === "QUEUE_V3" && !line.removed;
  // Price and remove were offered only to an admin on an open booking; that does not change.
  const canEdit = editable && admin && open;
  const forQuote = line.effectivePriceCentavos === null;
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="order-1 min-w-0 flex-1">
          <p className={`text-sm font-medium ${line.removed ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {line.name}
            {line.quantity > 1 ? ` × ${line.quantity}` : ""}
            {line.removed ? " (removed)" : ""}
          </p>
          <p className={`text-xs ${forQuote && !line.removed ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            {forQuote
              ? `For quote${line.referenceSubtotalCentavos === null ? "" : ` · estimate ${money(line.referenceSubtotalCentavos)}`}`
              : line.kind === "BASE"
                ? "Base service"
                : "Add-on"}
          </p>
        </div>
        {editable && open ? (
          <div
            role="group"
            aria-label={`${line.name} progress`}
            className="order-4 inline-flex basis-full rounded-lg border border-border bg-raised p-0.5 sm:order-2 sm:basis-auto"
          >
            {(["WAITING", "IN_PROGRESS", "DONE"] as const).map((workStatus) => (
              <button
                key={workStatus}
                type="button"
                aria-label={line.name + ": " + statusLabel(workStatus)}
                aria-pressed={line.workStatus === workStatus}
                disabled={disabled || line.workStatus === workStatus}
                onClick={() => void write(`/lines/${line.id}/status`, { workStatus })}
                className={`min-h-[44px] flex-1 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default sm:min-h-[34px] sm:flex-none ${
                  line.workStatus === workStatus ? segment[workStatus] : "text-muted-foreground hover:text-foreground disabled:opacity-50"
                }`}
              >
                {statusLabel(workStatus)}
              </button>
            ))}
          </div>
        ) : (
          <span className={`order-4 sm:order-2 ${statusPill(line.workStatus)}`}>{statusLabel(line.workStatus)}</span>
        )}
        <p className={`order-2 w-24 text-right text-sm tabular-nums sm:order-3 ${forQuote ? "text-muted-foreground" : "font-medium text-foreground"}`}>
          {forQuote ? "Not set" : money(line.effectivePriceCentavos!)}
        </p>
        {canEdit && (
          <button
            type="button"
            aria-label={`Edit ${line.name}`}
            aria-expanded={editing}
            aria-controls={editorId}
            title="Price or remove"
            onClick={() => setEditing((v) => !v)}
            className={`order-3 grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:order-4 sm:h-9 sm:w-9 ${editing ? "bg-raised text-foreground" : ""}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {canEdit && editing && (
        <div id={editorId} className="mt-3 space-y-3 rounded-lg border border-border bg-raised p-3">
          <form
            className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(e) =>
              submit(e, (f) => {
                const price = centavos(String(f.get("price")));
                if (price === null) {
                  setError("Enter a price with at most two decimal places.");
                  return;
                }
                if (window.confirm("Set the final price for this service?"))
                  void write(`/lines/${line.id}/price`, { priceCentavos: price, reason: String(f.get("reason")) });
              })
            }
          >
            <label className={label}>
              Final price ({money(0).replace(/[\d.,\s]/g, "")})
              <input
                name="price"
                inputMode="decimal"
                required
                pattern="[0-9]+(\.[0-9]{1,2})?"
                defaultValue={line.staffPriceCentavos === null ? "" : String(line.staffPriceCentavos / 100)}
                className={fieldClass}
              />
            </label>
            <label className={`${label} min-w-0`}>
              Why this price
              <input name="reason" required maxLength={500} placeholder="e.g. Heavy stain extraction" className={fieldClass} />
            </label>
            <Button size="sm" disabled={disabled} className={`${primary} h-11`}>
              {line.staffPriceCentavos === null ? "Set price" : "Change price"}
            </Button>
          </form>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(`Remove ${line.name}? Its original receipt stays unchanged.`)) void write(`/lines/${line.id}/remove`, {});
            }}
            className={`min-h-[36px] text-xs font-medium hover:underline disabled:opacity-50 ${dangerText}`}
          >
            Remove service
          </button>
        </div>
      )}
    </li>
  );
}

export function ServicesSection({
  b,
  admin,
  open,
  disabled,
  write,
  setError,
  catalog,
}: {
  b: AdminBookingDetail;
  admin: boolean;
  open: boolean;
  disabled: boolean;
  write: Write;
  setError: (message: string) => void;
  catalog: { data: BookingCatalog | null; loading: boolean; error: string | null; reload: () => unknown };
}) {
  const t = b.totals;
  return (
    <section aria-label="Services" className={panel}>
      <div className={panelHead}>
        <h3 className={sectionTitle}>Services</h3>
        {b.lines.length > 0 && <span className="text-xs text-muted-foreground">Price</span>}
      </div>
      <ul className="divide-y divide-border">
        {b.lines.map((line) => (
          <ServiceRow key={line.id} b={b} line={line} admin={admin} open={open} disabled={disabled} write={write} setError={setError} />
        ))}
        {b.lines.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground sm:px-5">{b.serviceName} (older booking, no service list)</li>
        )}
      </ul>

      {admin && open && b.snapshot === "QUEUE_V3" && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <LoadState loading={catalog.loading} error={catalog.error} retry={catalog.reload} />
          {catalog.data && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => submit(e, (f) => void write("/lines", { serviceId: String(f.get("service")), quantity: Number(f.get("quantity")) }))}
            >
              <label className={`${label} min-w-0 flex-1 basis-full sm:basis-0`}>
                Add service
                <select name="service" required className={fieldClass} defaultValue="">
                  <option value="" disabled>
                    Choose a service
                  </option>
                  {catalog.data.services
                    .filter(
                      (s) =>
                        !b.lines.some((l) => !l.removed && l.serviceId === s.id) &&
                        s.offers.some(
                          (o) =>
                            o.vehicleCategoryId === catalog.data!.vehicleCategories.find((v) => v.code === b.sizeCode)?.id &&
                            o.onlineBooking !== "UNAVAILABLE",
                        ),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.unit === "PANEL" ? " (per panel)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className={`${label} w-20`}>
                Qty
                <input name="quantity" type="number" min={1} max={20} defaultValue={1} required className={fieldClass} />
              </label>
              <Button variant="outline" disabled={disabled}>
                Add service
              </Button>
            </form>
          )}
        </div>
      )}

      <dl className="space-y-1 border-t border-border bg-raised/50 px-4 py-3 text-sm tabular-nums sm:px-5">
        <div className="flex justify-between gap-4 text-base font-semibold text-foreground">
          <dt>Total now</dt>
          <dd>{money(t.currentTotalCentavos)}</dd>
        </div>
        {t.forQuoteCount > 0 && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <dt>For quote</dt>
            <dd>
              {t.forQuoteCount} {t.forQuoteCount === 1 ? "service" : "services"}
            </dd>
          </div>
        )}
        {t.forQuoteCount > 0 && t.currentEstimateCentavos !== null && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <dt>Estimated total</dt>
            <dd>{money(t.currentEstimateCentavos)}</dd>
          </div>
        )}
        {t.receiptTotalCentavos !== t.currentTotalCentavos && (
          <div className="flex justify-between gap-4 text-xs text-muted-foreground">
            <dt>When booked</dt>
            <dd>{t.receiptTotalCentavos === null ? "For quote" : money(t.receiptTotalCentavos)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

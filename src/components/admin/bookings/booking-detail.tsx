"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type {
  AdminDayBoard,
  AdminBookingDetail,
  AdminDayQueues,
  AdminWriteResult,
  AdminNotifyResult,
  AdminDeleteResult,
} from "@/types/admin-contracts";
import type { BookingCatalog } from "@/types/catalog-contracts";
import type { UserRole } from "@/types/contracts";
import { BODY_TYPE_LABEL, type VehicleBodyType } from "@/types/catalog-contracts";
import { adminRequest, AdminRequestError } from "./client";
import {
  centavos,
  money,
  notifyNotice,
  statusActions,
  statusLabel,
  totalLabel,
  parsePaymentDetails,
  formatNotesWithPayment,
  paymentModeLabel,
  type PaymentMode,
} from "./model";
import { boardProgress, plateLabel, writeFeedback } from "./board-model";
import { shopDate } from "./model";
import { fieldClass, LoadState, useAdminResource } from "./use-admin-resource";
import { DepositBadge } from "./deposit-badge";
import { RefreshCw, X, AlertCircle, Check, Banknote, CreditCard, QrCode, Clock } from "lucide-react";

const sentAt = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
// History codes such as STATUS_CHANGED read as "Status changed".
const actionLabel = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ");

const card = "rounded-xl border border-border bg-panel p-4 sm:p-5";
const sectionTitle = "text-sm font-semibold text-foreground";
const label = "text-xs text-muted-foreground";
const primary = "bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400";
const quiet = "text-xs font-medium text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-400";
const fold = "group rounded-xl border border-border bg-panel";
const foldSummary =
  "flex min-h-[44px] cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-foreground sm:px-5";

function statusPill(status: string) {
  const tone =
    status === "COMPLETED" || status === "DONE"
      ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : status === "IN_PROGRESS"
        ? "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : status === "CONFIRMED"
          ? "border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-400"
          : status === "CANCELLED"
            ? "border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
            : "border-border bg-raised text-muted-foreground";
  return `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`;
}

export function BookingDetail({
  id,
  role,
  queues,
  onChanged,
  onClose,
}: {
  id: string;
  role: UserRole;
  queues: AdminDayQueues["queues"];
  onChanged: () => unknown;
  onClose: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    dialog.current?.showModal();
  }, []);
  // P1-30: the page behind a modal must not scroll. The dashboard scrolls inside #admin-content, which
  // a native modal leaves wheel-scrollable, so lock it while the dialog exists. The cleanup restores
  // it on every way out (Escape, Close, a delete, the board unmounting).
  React.useEffect(() => {
    const area = document.getElementById("admin-content");
    if (!area) return;
    const previous = area.style.overflow;
    area.style.overflow = "hidden";
    return () => {
      area.style.overflow = previous;
    };
  }, []);
  const resource = useAdminResource<AdminBookingDetail>(`/api/admin/bookings/${id}`),
    b = resource.data;
  const catalog = useAdminResource<BookingCatalog>(role === "ADMIN" ? "/api/catalog" : null);
  const workers = useAdminResource<AdminDayBoard>(role === "ADMIN" ? "/api/admin/board?date=" + shopDate() : null);
  const [busy, setBusy] = React.useState(false),
    [uncertain, setUncertain] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [notice, setNotice] = React.useState<string | null>(null),
    [conflict, setConflict] = React.useState<AdminBookingDetail | null>(null),
    [typed, setTyped] = React.useState("");
  const [editingDetails, setEditingDetails] = React.useState(false);
  type Recalc = { before: { staffId: string; name: string; amountCentavos: number }[]; after: { staffId: string; name: string; amountCentavos: number }[] };
  const [recalc, setRecalc] = React.useState<Recalc | null>(null);
  async function recalculate() {
    if (writing.current || !window.confirm("Recalculate this booking's commission with today's service and worker rates? Paid or adjusted commission is never changed.")) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setRecalc(await adminRequest<Recalc>(`/api/admin/bookings/${id}/commission`, { method: "POST", body: {} }));
    } catch (e) {
      if (e instanceof AdminRequestError && e.status === 401) return window.location.replace("/admin/login");
      setError(e instanceof AdminRequestError ? writeFeedback(e.detail).message : "Couldn't reach the shop server. Try again.");
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const [editName, setEditName] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editModel, setEditModel] = React.useState("");
  const [editPlate, setEditPlate] = React.useState("");
  const [editPaymentMode, setEditPaymentMode] = React.useState<PaymentMode>("PENDING");
  const [editNotes, setEditNotes] = React.useState("");

  const startEditDetails = () => {
    if (!b) return;
    setEditName(b.customerName);
    setEditPhone(b.customerPhone);
    setEditEmail(b.customerEmail ?? "");
    setEditModel(b.vehicleModel);
    setEditPlate(b.vehiclePlate ?? "");
    const parsed = parsePaymentDetails(b.notes);
    setEditPaymentMode(parsed.mode);
    setEditNotes(parsed.notes);
    setEditingDetails(true);
  };
  const mounted = React.useRef(true),
    writing = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function write(path: string, body: Record<string, unknown>, method = "POST"): Promise<boolean> {
    if (!b || writing.current || conflict || uncertain) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const beforeWorkers = b.assignedWorkers ?? [];
      const result = await adminRequest<AdminWriteResult | AdminNotifyResult | AdminDeleteResult>(
        `/api/admin/bookings/${id}${path}`,
        { method, body: { ...body, expectedRevision: b.revision } },
      );
      if (!mounted.current) return false;
      if ("deleted" in result) {
        // The booking is gone: refresh the board or list behind this dialog, then close it.
        void onChanged();
        onClose();
        return true;
      }
      resource.setData(result.booking);
      void onChanged();
      const droppedWorkers = beforeWorkers.filter(
        (w) => !result.booking.assignedWorkers.some((nw) => nw.staffId === w.staffId),
      );
      if (path === "/status" && (body as { status?: string }).status === "PENDING" && droppedWorkers.length > 0) {
        const names = droppedWorkers.map((w) => w.name).join(", ");
        setNotice(
          `Booking reinstated. ${names} ${droppedWorkers.length === 1 ? "is" : "are"} no longer active and ${droppedWorkers.length === 1 ? "was" : "were"} removed from the booking.`,
        );
      } else {
        setNotice(
          "notice" in result
            ? notifyNotice(result.notice, result.reason)
            : result.noChange
              ? "No change was needed."
              : "Booking updated.",
        );
      }
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      if (e instanceof AdminRequestError) {
        if (e.status === 401) {
          window.location.replace("/admin/login");
          return false;
        }
        if (e.detail.code === "VERSION_CONFLICT" && e.currentBooking) setConflict(e.currentBooking);
        if (e.commitState === "UNKNOWN") setUncertain(true);
        setError(writeFeedback(e.detail).message);
      } else {
        setUncertain(true);
        setError("Couldn't reach the shop server. Refresh before retrying a change.");
      }
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function submit(e: React.FormEvent<HTMLFormElement>, run: (form: FormData) => void) {
    e.preventDefault();
    run(new FormData(e.currentTarget));
  }
  const admin = role === "ADMIN",
    disabled = busy || Boolean(conflict) || uncertain,
    open = b && ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status),
    canAssignStaff =
      admin && Boolean(b && ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(b.status) && b.snapshot === "QUEUE_V3");

  const progress = b ? boardProgress(b.lines) : { done: 0, total: 0 };
  const parsedPayment = parsePaymentDetails(b?.notes);
  const email = (type: "reminder" | "confirmation" | "turn", what: string) => {
    if (b?.customerEmail && window.confirm(`Send the "${what}" email to ${b.customerEmail}?`))
      void write("/notify", type === "turn" ? {} : { type });
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="booking-detail-title"
      className="fixed inset-0 m-auto flex max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/80"
    >
      {/* Header: who, which booking, where it stands, and the one next step. */}
      <div className="sticky top-0 z-20 border-b border-border bg-panel px-4 py-3 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Booking details</p>
            <h2 id="booking-detail-title" className="truncate text-lg font-bold text-foreground">
              {b ? b.customerName : "Loading…"}
            </h2>
            {b && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md border border-amber-600/30 bg-amber-500/10 px-2 py-0.5 font-mono font-bold text-amber-700 dark:text-amber-400">
                  {b.referenceCode}
                </span>
                <span className={statusPill(b.status)}>{statusLabel(b.status)}</span>
                <span>Drop-off {b.bookingDate}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              className="hover:bg-raised"
              size="icon"
              disabled={busy}
              aria-label="Refresh details"
              title="Refresh"
              onClick={() => {
                setConflict(null);
                setError(null);
                setUncertain(false);
                void resource.reload();
              }}
            >
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="hover:bg-raised" disabled={busy} onClick={onClose} aria-label="Close details" title="Close">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {b && statusActions(b, role).some((s) => s !== "PENDING") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {statusActions(b, role)
              .filter((s) => s !== "PENDING")
              .map((status) => (
                <Button
                  key={status}
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    if (status !== "COMPLETED" || window.confirm("Mark this booking done? All active services must be done."))
                      void write("/status", { status });
                  }}
                  className={status === "COMPLETED" ? "bg-emerald-600 font-semibold text-white hover:bg-emerald-500" : primary}
                >
                  {status === "CONFIRMED" ? "Confirm booking" : status === "IN_PROGRESS" ? "Start work" : "Mark done"}
                </Button>
              ))}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <LoadState loading={resource.loading} error={resource.error} retry={resource.reload} />
        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-600/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
            <Check className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {conflict && (
          <div className="rounded-xl border border-amber-600/40 bg-amber-500/10 p-4">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Someone else changed this booking. Your change was not applied. Review the latest version first.
            </p>
            <Button
              className={`mt-3 ${primary}`}
              disabled={busy}
              onClick={() => {
                resource.setData(conflict);
                setConflict(null);
                setError(null);
              }}
            >
              Review current booking
            </Button>
          </div>
        )}

        {b && (
          <div key={b.revision} className="space-y-4" aria-busy={busy}>
            {editingDetails ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await write(
                    "",
                    {
                      customerName: editName.trim(),
                      customerPhone: editPhone.trim(),
                      customerEmail: editEmail.trim() ? editEmail.trim() : null,
                      vehicleModel: editModel.trim(),
                      vehiclePlate: editPlate.trim() ? editPlate.trim() : null,
                      notes: formatNotesWithPayment(editPaymentMode, editNotes),
                    },
                    "PATCH",
                  );
                  if (ok) setEditingDetails(false);
                }}
                className={`${card} space-y-4`}
              >
                <h3 className={sectionTitle}>Edit customer & vehicle</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={label}>
                    Customer name *
                    <input required value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} className={fieldClass} disabled={disabled} />
                  </label>
                  <label className={label}>
                    Customer phone *
                    <input required value={editPhone} onChange={(e) => setEditPhone(e.target.value)} maxLength={30} className={fieldClass} disabled={disabled} />
                  </label>
                  <label className={label}>
                    Customer email
                    <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} maxLength={120} className={fieldClass} disabled={disabled} />
                  </label>
                  <label className={label}>
                    Vehicle model *
                    <input required value={editModel} onChange={(e) => setEditModel(e.target.value)} maxLength={80} className={fieldClass} disabled={disabled} />
                  </label>
                  <label className={`${label} sm:col-span-2`}>
                    Vehicle plate
                    <input value={editPlate} onChange={(e) => setEditPlate(e.target.value)} maxLength={20} className={fieldClass} disabled={disabled} />
                  </label>
                  <fieldset className="space-y-1.5 sm:col-span-2">
                    <legend className={label}>Mode of payment</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          { value: "CASH", label: "Cash", Icon: Banknote },
                          { value: "CARD", label: "Card (POS)", Icon: CreditCard },
                          { value: "ONLINE_QR", label: "Online / QR", Icon: QrCode },
                          { value: "PENDING", label: "Pending", Icon: Clock },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={disabled}
                          aria-pressed={editPaymentMode === opt.value}
                          onClick={() => setEditPaymentMode(opt.value)}
                          className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            editPaymentMode === opt.value
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
                  <label className={`${label} sm:col-span-2`}>
                    Notes
                    <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} maxLength={1000} rows={3} className={fieldClass} disabled={disabled} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={disabled} className={primary}>
                    Save changes
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setEditingDetails(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <section aria-label="Customer and vehicle" className={card}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className={sectionTitle}>Customer & vehicle</h3>
                  {admin && (
                    <button type="button" onClick={startEditDetails} disabled={disabled} className={quiet}>
                      Edit details
                    </button>
                  )}
                </div>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
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
                  <div className="sm:col-span-2">
                    <dt className={label}>Vehicle · plate · size</dt>
                    <dd className="font-medium text-foreground">{`${b.vehicleModel} · ${plateLabel(b.vehiclePlate)} · ${b.sizeCode ?? "Older booking"}${b.bodyType ? " " + (BODY_TYPE_LABEL[b.bodyType as VehicleBodyType] ?? b.bodyType) : ""}`}</dd>
                  </div>
                  {parsedPayment.notes && (
                    <div className="sm:col-span-2">
                      <dt className={label}>Notes</dt>
                      <dd className="whitespace-pre-wrap break-words text-foreground">{parsedPayment.notes}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            {/* Services */}
            <section aria-label="Services" className={`${card} space-y-3`}>
              <div className="flex items-center justify-between">
                <h3 className={sectionTitle}>Services</h3>
                {progress.total > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {progress.done} of {progress.total} done
                  </span>
                )}
              </div>
              <ul className="divide-y divide-border">
                {b.lines.map((line) => {
                  const editable = b.snapshot === "QUEUE_V3" && !line.removed;
                  return (
                    <li key={line.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${line.removed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                            {line.name}
                            {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                            {line.removed ? " (removed)" : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {line.effectivePriceCentavos === null
                              ? `For quote${line.referenceSubtotalCentavos === null ? "" : ` · estimate ${money(line.referenceSubtotalCentavos)}`}`
                              : money(line.effectivePriceCentavos)}
                          </p>
                        </div>
                        {!(editable && open) && <span className={statusPill(line.workStatus)}>{statusLabel(line.workStatus)}</span>}
                      </div>
                      {editable && open && (
                        <div className="flex flex-wrap items-center gap-2">
                          <div role="group" aria-label={`${line.name} progress`} className="inline-flex overflow-hidden rounded-lg border border-border">
                            {(["WAITING", "IN_PROGRESS", "DONE"] as const).map((workStatus) => (
                              <button
                                key={workStatus}
                                type="button"
                                aria-label={line.name + ": " + statusLabel(workStatus)}
                                aria-pressed={line.workStatus === workStatus}
                                disabled={disabled || line.workStatus === workStatus}
                                onClick={() => void write(`/lines/${line.id}/status`, { workStatus })}
                                className={`min-h-[36px] px-3 text-xs font-medium transition-colors disabled:cursor-default ${
                                  line.workStatus === workStatus
                                    ? "bg-amber-500 text-zinc-950"
                                    : "bg-raised text-muted-foreground hover:text-foreground disabled:opacity-50"
                                }`}
                              >
                                {statusLabel(workStatus)}
                              </button>
                            ))}
                          </div>
                          {admin && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                if (window.confirm(`Remove ${line.name}? Its original receipt stays unchanged.`))
                                  void write(`/lines/${line.id}/remove`, {});
                              }}
                              className="ml-auto text-xs font-medium text-rose-700 hover:underline disabled:opacity-50 dark:text-rose-400"
                            >
                              Remove service
                            </button>
                          )}
                        </div>
                      )}
                      {editable && admin && b.status !== "CANCELLED" && b.status !== "COMPLETED" && (
                        <details>
                          <summary className={`${quiet} cursor-pointer list-none`}>
                            {line.staffPriceCentavos === null ? "Set price" : "Change price"}
                          </summary>
                          <form
                            className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-raised p-3"
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
                            <label className={`${label} min-w-0 flex-1 basis-full sm:basis-0`}>
                              Why this price
                              <input name="reason" required maxLength={500} placeholder="e.g. Heavy stain extraction" className={fieldClass} />
                            </label>
                            <Button size="sm" disabled={disabled} className={primary}>
                              Save price
                            </Button>
                          </form>
                        </details>
                      )}
                    </li>
                  );
                })}
                {b.lines.length === 0 && <li className="text-sm text-muted-foreground">{b.serviceName} (older booking, no service list)</li>}
              </ul>

              {admin && open && b.snapshot === "QUEUE_V3" && (
                <div className="border-t border-border pt-3">
                  <LoadState loading={catalog.loading} error={catalog.error} retry={catalog.reload} />
                  {catalog.data && (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) =>
                        submit(e, (f) => void write("/lines", { serviceId: String(f.get("service")), quantity: Number(f.get("quantity")) }))
                      }
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
            </section>

            {/* Payment: total, how they pay, and the deposit proof */}
            <section aria-label="Payment" className={`${card} space-y-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className={sectionTitle}>Payment</h3>
                  <p className="mt-1 font-mono text-xl font-bold text-foreground">{totalLabel(b.totals)}</p>
                  {b.totals.receiptTotalCentavos !== b.totals.currentTotalCentavos && (
                    <p className="text-xs text-muted-foreground">
                      When booked:{" "}
                      {b.totals.receiptTotalCentavos === null ? "For quote" : money(b.totals.receiptTotalCentavos)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className={label}>Pays by</p>
                  <p className="text-sm font-medium text-foreground">{paymentModeLabel(parsedPayment.mode)}</p>
                </div>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium text-foreground">Deposit</h4>
                  <DepositBadge status={b.depositStatus} showNone />
                </div>
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
                            className="block overflow-hidden rounded-lg border border-border bg-black hover:border-amber-500 focus-visible:ring-2 focus-visible:ring-primary"
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
                          <p className="text-xs text-muted-foreground">
                            {sentAt(p.createdAt)} · opens full size
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {admin && b.snapshot === "QUEUE_V3" && (
                  <form
                    className="space-y-3"
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
                      <Button
                        name="depositStatus"
                        value="RECEIVED"
                        size="sm"
                        disabled={disabled || b.depositStatus === "RECEIVED"}
                        className="bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
                      >
                        Mark deposit received
                      </Button>
                      <Button
                        name="depositStatus"
                        value="REJECTED"
                        size="sm"
                        variant="outline"
                        disabled={disabled || b.depositStatus === "REJECTED" || b.depositProofs.length === 0}
                        className="text-rose-700 dark:text-rose-400"
                      >
                        Mark deposit rejected
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </section>

            {/* Staff */}
            <section aria-label="Assigned staff" className={`${card} space-y-3`}>
              <h3 className={sectionTitle}>Assigned staff</h3>
              {b.assignedWorkers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one assigned yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {b.assignedWorkers.map((w) => (
                    <li key={w.staffId} className="flex items-center gap-1 rounded-full border border-border bg-raised py-1 pl-3 pr-1 text-sm text-foreground">
                      <span>
                        {w.name}
                        {w.isActive ? "" : " (inactive)"}
                      </span>
                      {canAssignStaff ? (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => void write("/workers/" + w.staffId, {}, "DELETE")}
                          aria-label={`Remove ${w.name}`}
                          title={`Remove ${w.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-50 dark:hover:text-rose-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="pr-2" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canAssignStaff && (
                <>
                  <LoadState loading={workers.loading} error={workers.error} retry={workers.reload} />
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => submit(e, (f) => void write("/workers/" + String(f.get("worker")), {}, "PUT"))}
                  >
                    <label className={`${label} min-w-0 flex-1`}>
                      Add a worker
                      <select name="worker" className={fieldClass} required disabled={disabled} defaultValue="">
                        <option value="" disabled>
                          Choose an active worker
                        </option>
                        {workers.data?.workers
                          .filter((w) => !b.assignedWorkers.some((a) => a.staffId === w.staffId))
                          .map((w) => (
                            <option key={w.staffId} value={w.staffId}>
                              {w.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button variant="outline" disabled={disabled}>
                      Assign worker
                    </Button>
                  </form>
                </>
              )}
              {admin && b.status === "COMPLETED" && b.snapshot === "QUEUE_V3" && (
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Changed a service or worker rate? Work this booking&apos;s commission out again.</p>
                    <Button variant="outline" size="sm" disabled={disabled} onClick={() => void recalculate()}>
                      Recalculate commission
                    </Button>
                  </div>
                  {recalc && (
                    <table className="w-full text-sm" aria-label="Commission before and after">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1 font-medium">Worker</th>
                          <th className="py-1 text-right font-medium">Before</th>
                          <th className="py-1 text-right font-medium">Now</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...new Set([...recalc.before, ...recalc.after].map((r) => r.staffId))].map((staffId) => {
                          const was = recalc.before.find((r) => r.staffId === staffId), now = recalc.after.find((r) => r.staffId === staffId);
                          return (
                            <tr key={staffId} className="border-t border-border">
                              <td className="py-1.5 text-foreground">{(now ?? was)!.name}</td>
                              <td className="py-1.5 text-right text-muted-foreground">{was ? money(was.amountCentavos) : "—"}</td>
                              <td className="py-1.5 text-right font-semibold text-foreground">{now ? money(now.amountCentavos) : "—"}</td>
                            </tr>
                          );
                        })}
                        {recalc.after.length === 0 && recalc.before.length === 0 && (
                          <tr><td colSpan={3} className="py-1.5 text-muted-foreground">No commission on this booking: no worker assigned or no service earns one.</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </section>

            {/* Reinstate is the only way back for a declined booking, so it stays in view. */}
            {statusActions(b, role).includes("PENDING") && (
              <section aria-label="Reinstate booking" className={`${card} space-y-3`}>
                <h3 className={sectionTitle}>Reinstate booking</h3>
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
            )}

            {/* Less frequent actions, folded away */}
            {open && (
              <details className={fold}>
                <summary className={foldSummary}>More actions</summary>
                <div className="space-y-5 border-t border-border p-4 sm:p-5">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground">Email the customer</h4>
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

                  {admin && b.snapshot === "QUEUE_V3" && ["PENDING", "CONFIRMED"].includes(b.status) && (
                    <div className="space-y-2 border-t border-border pt-4">
                      <h4 className="text-sm font-medium text-foreground">Reschedule</h4>
                      <form
                        onSubmit={(e) =>
                          submit(e, (f) => {
                            if (window.confirm("Move this booking to the selected day and queue?"))
                              void write("/move", { toDate: String(f.get("date")), toQueueCode: String(f.get("queue")) });
                          })
                        }
                        className="grid items-end gap-2 sm:grid-cols-3"
                      >
                        <label className={label}>
                          New date
                          <input type="date" name="date" required defaultValue={b.bookingDate} className={fieldClass} />
                        </label>
                        <label className={label}>
                          Queue
                          <select name="queue" defaultValue={b.queueCode ?? ""} className={fieldClass}>
                            {queues
                              .filter((q) => q.isActive)
                              .map((q) => (
                                <option key={q.code} value={q.code}>
                                  {q.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <Button variant="outline" disabled={disabled}>
                          Move booking
                        </Button>
                      </form>
                    </div>
                  )}

                  {admin && (
                    <div className="space-y-2 border-t border-border pt-4">
                      <h4 className="text-sm font-medium text-rose-700 dark:text-rose-400">Decline booking</h4>
                      <p className="text-xs text-muted-foreground">Frees its place in the queue. You can reinstate it later.</p>
                      <form
                        onSubmit={(e) =>
                          submit(e, (f) => {
                            if (window.confirm("Decline this booking and release its capacity?"))
                              void write("/decline", { reason: String(f.get("reason")) });
                          })
                        }
                        className="flex flex-wrap items-end gap-2"
                      >
                        <label className={`${label} min-w-0 flex-1 basis-full sm:basis-0`}>
                          Reason
                          <input name="reason" required maxLength={500} placeholder="Reason for declining this booking" className={fieldClass} />
                        </label>
                        <Button variant="destructive" disabled={disabled}>
                          Decline booking
                        </Button>
                      </form>
                    </div>
                  )}
                </div>
              </details>
            )}

            <details className={fold}>
              <summary className={foldSummary}>
                <span>History</span>
                <span className="text-xs font-normal text-muted-foreground">{b.history.length} changes</span>
              </summary>
              <ul className="space-y-2 border-t border-border p-4 text-xs text-muted-foreground sm:p-5">
                {b.history.map((h) => (
                  <li key={h.id}>
                    {[sentAt(h.createdAt), actionLabel(h.action), h.actorName ?? (h.source === "CUSTOMER" ? "Customer" : null), h.reason]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </details>

            {admin && (
              <details className="group rounded-xl border border-rose-600/30 bg-panel">
                <summary className={`${foldSummary} text-rose-700 dark:text-rose-400`}>
                  <span id="delete-booking-title">Delete booking</span>
                </summary>
                <form
                  aria-labelledby="delete-booking-title"
                  onSubmit={(e) => submit(e, (f) => void write("/delete", { reference: String(f.get("reference")) }))}
                  className="space-y-3 border-t border-rose-600/20 p-4 sm:p-5"
                >
                  <p className="text-xs text-muted-foreground">
                    Deleting removes this booking, its services, any deposit proof and its place on the board for good. It also
                    removes it from history, from the day&apos;s counts and from any totals built from completed jobs. A short
                    record that you deleted it is kept.
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
        )}
      </div>
    </dialog>
  );
}

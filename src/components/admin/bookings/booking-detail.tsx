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
import {
  Phone,
  Mail,
  FileText,
  Users,
  RefreshCw,
  X,
  Edit3,
  Send,
  CreditCard,
  Banknote,
  QrCode,
  Store,
  Calendar,
  AlertCircle,
  Check,
  Clock,
  ShieldAlert,
  UserCheck,
} from "lucide-react";

const sentAt = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

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
  const resource = useAdminResource<AdminBookingDetail>(
      `/api/admin/bookings/${id}`,
    ),
    b = resource.data;
  const catalog = useAdminResource<BookingCatalog>(
      role === "ADMIN" ? "/api/catalog" : null,
    );
  const workers = useAdminResource<AdminDayBoard>(
    role === "ADMIN" ? "/api/admin/board?date=" + shopDate() : null,
  );
  const [busy, setBusy] = React.useState(false),
    [uncertain, setUncertain] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [notice, setNotice] = React.useState<string | null>(null),
    [conflict, setConflict] = React.useState<AdminBookingDetail | null>(null),
    [typed, setTyped] = React.useState("");
  const [editingDetails, setEditingDetails] = React.useState(false);
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
  async function write(
    path: string,
    body: Record<string, unknown>,
    method = "POST",
  ): Promise<boolean> {
    if (!b || writing.current || conflict || uncertain) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const beforeWorkers = b.assignedWorkers ?? [];
      const result = await adminRequest<
        AdminWriteResult | AdminNotifyResult | AdminDeleteResult
      >(`/api/admin/bookings/${id}${path}`, {
        method,
        body: { ...body, expectedRevision: b.revision },
      });
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
            ? notifyNotice(result.notice)
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
        if (e.detail.code === "VERSION_CONFLICT" && e.currentBooking)
          setConflict(e.currentBooking);
        if (e.commitState === "UNKNOWN") setUncertain(true);
        setError(writeFeedback(e.detail).message);
      } else {
        setUncertain(true);
        setError(
          "Couldn't reach the shop server. Refresh before retrying a change.",
        );
      }
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function submit(
    e: React.FormEvent<HTMLFormElement>,
    run: (form: FormData) => void,
  ) {
    e.preventDefault();
    run(new FormData(e.currentTarget));
  }
  const admin = role === "ADMIN",
    disabled = busy || Boolean(conflict) || uncertain,
    open = b && ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status),
    canAssignStaff = admin && Boolean(b && ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(b.status) && b.snapshot === "QUEUE_V3");

  const progress = b ? boardProgress(b.lines) : { done: 0, total: 0 };
  const progressPercent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const parsedPayment = parsePaymentDetails(b?.notes);

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="booking-detail-title"
      className="fixed inset-0 m-auto max-h-[88vh] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/85 backdrop: flex flex-col"
    >
      {/* Sticky Header */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-stone-50/95 dark:bg-panel/95 px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="booking-detail-title" className="text-lg font-bold tracking-tight text-foreground">
                Booking details
              </h2>
              {b && (
                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                  {b.referenceCode}
                </span>
              )}
            </div>
            {b && (
              <p className="text-xs text-muted-foreground">
                {b.bookingDate} · Revision {b.revision}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setConflict(null);
              setError(null);
              setUncertain(false);
              void resource.reload();
            }}
            className="h-9 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            <span>Refresh details</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onClose}
            className="h-9 gap-1.5 text-xs"
          >
            <X className="h-4 w-4" />
            <span>Close details</span>
          </Button>
        </div>
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 sm:p-6">
        <LoadState
          loading={resource.loading}
          error={resource.error}
          retry={resource.reload}
        />
        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-sm text-rose-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-300">
            <Check className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {conflict && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm text-amber-200">
              Someone changed this booking. Review revision {conflict.revision}{" "}
              before submitting a new action. Your change was not applied.
            </p>
            <Button
              className="mt-3 bg-amber-500 text-zinc-950 hover:bg-amber-400"
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
          <div key={b.revision} className="space-y-5" aria-busy={busy}>
            {editingDetails ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formattedNotes = formatNotesWithPayment(editPaymentMode, editNotes);
                  const ok = await write(
                    "",
                    {
                      customerName: editName.trim(),
                      customerPhone: editPhone.trim(),
                      customerEmail: editEmail.trim() ? editEmail.trim() : null,
                      vehicleModel: editModel.trim(),
                      vehiclePlate: editPlate.trim() ? editPlate.trim() : null,
                      notes: formattedNotes,
                    },
                    "PATCH",
                  );
                  if (ok) setEditingDetails(false);
                }}
                className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <Edit3 className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-amber-400">Edit Booking Details</h3>
                  </div>
                  <span className="font-mono text-xs font-semibold text-amber-300">{b.referenceCode}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-zinc-300">
                    Customer name *
                    <input
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={80}
                      className={fieldClass}
                      disabled={disabled}
                    />
                  </label>
                  <label className="text-xs text-zinc-300">
                    Customer phone *
                    <input
                      required
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      maxLength={30}
                      className={fieldClass}
                      disabled={disabled}
                    />
                  </label>
                  <label className="text-xs text-zinc-300">
                    Customer email
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      maxLength={120}
                      className={fieldClass}
                      disabled={disabled}
                    />
                  </label>
                  <label className="text-xs text-zinc-300">
                    Vehicle model *
                    <input
                      required
                      value={editModel}
                      onChange={(e) => setEditModel(e.target.value)}
                      maxLength={80}
                      className={fieldClass}
                      disabled={disabled}
                    />
                  </label>
                  <label className="text-xs text-zinc-300 sm:col-span-2">
                    Vehicle plate
                    <input
                      value={editPlate}
                      onChange={(e) => setEditPlate(e.target.value)}
                      maxLength={20}
                      className={fieldClass}
                      disabled={disabled}
                    />
                  </label>
                  <div className="sm:col-span-2 space-y-1.5">
                    <span className="block text-xs font-semibold text-zinc-300">
                      Mode of payment
                    </span>
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
                          onClick={() => setEditPaymentMode(opt.value)}
                          className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            editPaymentMode === opt.value
                              ? "border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs"
                              : "border-border bg-stone-50/50 dark:bg-zinc-800/80 text-muted-foreground hover:border-zinc-500 hover:text-foreground"
                          }`}
                        >
                          <opt.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="text-xs text-zinc-300 sm:col-span-2">
                    Notes
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      maxLength={1000}
                      rows={3}
                      className={fieldClass}
                      disabled={disabled}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 pt-2 border-t border-amber-500/20">
                  <Button type="submit" disabled={disabled} className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400">
                    Save changes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setEditingDetails(false)}
                    className="border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              /* Executive Overview 3-Card Grid */
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Customer Profile Card */}
                <div className="flex flex-col justify-between rounded-xl border border-zinc-800/80 bg-panel p-4 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/60">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Customer
                      </span>
                      {admin && (
                        <button
                          type="button"
                          onClick={startEditDetails}
                          disabled={disabled}
                          className="flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 hover:underline disabled:opacity-50"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>Edit details</span>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-raised text-xs font-bold text-foreground">
                        {b.customerName ? b.customerName.slice(0, 2).toUpperCase() : "??"}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{b.customerName}</p>
                        <a
                          href={`tel:${b.customerPhone}`}
                          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-amber-400 transition-colors"
                        >
                          <Phone className="h-3 w-3" />
                          <span>{b.customerPhone}</span>
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-2.5">
                      <Mail className="h-3 w-3 shrink-0" />
                      {b.customerEmail ? (
                        <a href={`mailto:${b.customerEmail}`} className="truncate hover:text-amber-400">
                          {b.customerEmail}
                        </a>
                      ) : (
                        <span className="text-zinc-500">No email</span>
                      )}
                    </div>
                  </div>
                  {parsedPayment.notes && (
                    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-xs text-zinc-300">
                      <div className="flex items-center gap-1 font-medium text-zinc-400 mb-1">
                        <FileText className="h-3 w-3" />
                        <span>Notes</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words">{parsedPayment.notes}</p>
                    </div>
                  )}
                </div>

                {/* Vehicle & Status Card */}
                <div className="flex flex-col justify-between rounded-xl border border-zinc-800/80 bg-panel p-4 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/60">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Vehicle & Status
                      </span>
                      <span className="inline-flex items-center rounded border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 text-xs font-bold text-zinc-300">
                        Size {b.sizeCode ?? "Legacy"}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {/* CRITICAL FORMAT FOR UNIT TESTS: Toyota Vios · QA 101 · S */}
                      <p className="text-sm font-semibold text-white">
                        {b.vehicleModel} · {plateLabel(b.vehiclePlate)} · {b.sizeCode ?? "Legacy"}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {b.bookingDate} · {statusLabel(b.status)} · Revision {b.revision}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Booking Status</span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        b.status === "COMPLETED"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : b.status === "IN_PROGRESS"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                            : b.status === "CONFIRMED"
                              ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                              : b.status === "CANCELLED"
                                ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                                : "border-zinc-700 bg-zinc-800/80 text-zinc-300"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          b.status === "IN_PROGRESS" ? " bg-amber-400" : "bg-current"
                        }`}
                      />
                      {statusLabel(b.status)}
                    </span>
                  </div>
                </div>

                {/* Financial Overview Card */}
                <div className="flex flex-col justify-between rounded-xl border border-zinc-800/80 bg-panel p-4 shadow-sm sm:col-span-2 lg:col-span-1">
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/60">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Financial Summary
                      </span>
                      <DepositBadge status={b.depositStatus} showNone />
                    </div>
                    <div className="space-y-1">
                      <p className="font-mono text-xl font-bold tracking-tight text-amber-400">
                        {totalLabel(b.totals)}
                      </p>
                      <p className="text-xs text-zinc-400">
                        Original receipt:{" "}
                        {b.totals.receiptTotalCentavos === null
                          ? "For quote"
                          : money(b.totals.receiptTotalCentavos)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/60 space-y-2 text-xs text-zinc-400">
                    <div className="flex items-center justify-between">
                      <span>Payment mode</span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          parsedPayment.mode === "CASH"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : parsedPayment.mode === "CARD"
                              ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                              : parsedPayment.mode === "ONLINE_QR"
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                : parsedPayment.mode === "WALK_IN"
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                  : "border-zinc-700 bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {parsedPayment.mode === "CASH" ? (
                          <Banknote className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : parsedPayment.mode === "CARD" ? (
                          <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : parsedPayment.mode === "ONLINE_QR" ? (
                          <QrCode className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : parsedPayment.mode === "WALK_IN" ? (
                          <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span>{paymentModeLabel(parsedPayment.mode)}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Reference code</span>
                      <span className="font-mono text-xs font-semibold text-amber-400">{b.referenceCode}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Action Bar */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/80 bg-panel p-3 shadow-sm">
              {admin && !editingDetails && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={startEditDetails}
                  className="border-zinc-700 bg-zinc-800/60 text-xs text-zinc-200 hover:bg-zinc-700 hover:text-white"
                >
                  <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                  Edit details
                </Button>
              )}
              {statusActions(b, role)
                .filter((s) => s !== "PENDING")
                .map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      if (
                        status !== "COMPLETED" ||
                        window.confirm(
                          "Complete this booking? All active services must be done.",
                        )
                      )
                        void write("/status", { status });
                    }}
                    className={
                      status === "COMPLETED"
                        ? "bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-500"
                        : status === "IN_PROGRESS"
                          ? "bg-amber-500 font-semibold text-zinc-950 shadow-sm hover:bg-amber-400"
                          : "bg-sky-600 font-semibold text-white shadow-sm hover:bg-sky-500"
                    }
                  >
                    {status === "CONFIRMED"
                      ? "Confirm booking"
                      : status === "IN_PROGRESS"
                        ? "Start booking"
                        : "Complete booking"}
                  </Button>
                ))}
              {open && (
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || !b.customerEmail}
                    title={!b.customerEmail ? "No customer email on file" : undefined}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Send appointment reminder email to ${b.customerEmail}?`,
                        )
                      )
                        void write("/notify", { type: "reminder" });
                    }}
                    className="border-zinc-800 bg-zinc-900/80 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  >
                    <Send className="mr-1.5 h-3 w-3" />
                    Send reminder
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || !b.customerEmail}
                    title={!b.customerEmail ? "No customer email on file" : undefined}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Resend booking confirmation email to ${b.customerEmail}?`,
                        )
                      )
                        void write("/notify", { type: "confirmation" });
                    }}
                    className="border-zinc-800 bg-zinc-900/80 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  >
                    Resend confirmation
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Send the fixed turn notice to this customer's email?",
                        )
                      )
                        void write("/notify", {});
                    }}
                    className="border-zinc-800 bg-zinc-900/80 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  >
                    Notify customer
                  </Button>
                </div>
              )}
            </div>

            {/* Services & Line Items Card */}
            <div className="rounded-xl border border-zinc-800/80 bg-panel p-4.5 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Services · {progress.done}/{progress.total} done{" "}
                      {b.snapshot === "LEGACY" && "· Legacy receipt"}
                    </h3>
                    <p className="text-xs text-zinc-400">Individual service progress and quotes</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-400">{progressPercent}% complete</span>
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Service Items List */}
              <div className="space-y-3">
                {b.lines.map((line) => (
                  <div
                    key={line.id}
                    className="rounded-xl border border-zinc-800/70 bg-card p-3.5 space-y-3 transition-colors hover:border-zinc-700/80"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {line.name} × {line.quantity}
                          {line.removed ? " · Removed" : ""}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {line.effectivePriceCentavos === null
                            ? `For quote${line.referenceSubtotalCentavos === null ? "" : ` · Estimate ${money(line.referenceSubtotalCentavos)}`}`
                            : money(line.effectivePriceCentavos)}{" "}
                          · {statusLabel(line.workStatus)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${
                          line.workStatus === "DONE"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : line.workStatus === "IN_PROGRESS"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                              : "border-zinc-700 bg-zinc-800/80 text-zinc-400"
                        }`}
                      >
                        {statusLabel(line.workStatus)}
                      </span>
                    </div>

                    {b.snapshot === "QUEUE_V3" && !line.removed && (
                      <div className="space-y-3 border-t border-zinc-800/60 pt-3">
                        {open && (
                          <div className="flex flex-wrap items-center gap-2">
                            {(["WAITING", "IN_PROGRESS", "DONE"] as const).map(
                              (workStatus) => (
                                <Button
                                  key={workStatus}
                                  size="sm"
                                  aria-label={
                                    line.name + ": " + statusLabel(workStatus)
                                  }
                                  aria-pressed={line.workStatus === workStatus}
                                  variant="outline"
                                  disabled={
                                    disabled || line.workStatus === workStatus
                                  }
                                  onClick={() =>
                                    void write(`/lines/${line.id}/status`, {
                                      workStatus,
                                    })
                                  }
                                  className={`text-xs ${
                                    line.workStatus === workStatus
                                      ? "border-amber-500/40 bg-amber-500/20 text-amber-300 font-semibold"
                                      : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                                  }`}
                                >
                                  {statusLabel(workStatus)}
                                </Button>
                              ),
                            )}
                            {admin && (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={disabled}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Remove ${line.name}? Its original receipt stays unchanged.`,
                                    )
                                  )
                                    void write(`/lines/${line.id}/remove`, {});
                                }}
                                className="text-xs sm:ml-auto"
                              >
                                Remove service
                              </Button>
                            )}
                          </div>
                        )}
                        {admin && b.status !== "CANCELLED" && b.status !== "COMPLETED" && (
                          <form
                            className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5"
                            onSubmit={(e) =>
                              submit(e, (f) => {
                                const price = centavos(String(f.get("price")));
                                if (price === null) {
                                  setError(
                                    "Enter a price with at most two decimal places.",
                                  );
                                  return;
                                }
                                if (
                                  window.confirm(
                                    "Set the final price for this service?",
                                  )
                                )
                                  void write(`/lines/${line.id}/price`, {
                                    priceCentavos: price,
                                    reason: String(f.get("reason")),
                                  });
                              })
                            }
                          >
                            <label className="text-xs text-zinc-300">
                              Final price ({money(0).replace(/[\d.,\s]/g, "")})
                              <input
                                name="price"
                                inputMode="decimal"
                                required
                                pattern="[0-9]+(\.[0-9]{1,2})?"
                                defaultValue={
                                  line.staffPriceCentavos === null
                                    ? ""
                                    : String(line.staffPriceCentavos / 100)
                                }
                                className={fieldClass}
                              />
                            </label>
                            <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs text-zinc-300">
                              Price reason
                              <input
                                name="reason"
                                required
                                maxLength={500}
                                placeholder="e.g. Heavy stain extraction addition"
                                className={fieldClass}
                              />
                            </label>
                            <Button size="sm" disabled={disabled} className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400">
                              Set price
                            </Button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {b.lines.length === 0 && (
                  <p className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 text-sm text-zinc-400">
                    {b.serviceName} · Historical receipt
                  </p>
                )}
              </div>

              {/* Add Service Section */}
              {admin && open && b.snapshot === "QUEUE_V3" && (
                <div className="border-t border-zinc-800/60 pt-3">
                  <LoadState
                    loading={catalog.loading}
                    error={catalog.error}
                    retry={catalog.reload}
                  />
                  {catalog.data && (
                    <form
                      className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5"
                      onSubmit={(e) =>
                        submit(
                          e,
                          (f) =>
                            void write("/lines", {
                              serviceId: String(f.get("service")),
                              quantity: Number(f.get("quantity")),
                            }),
                        )
                      }
                    >
                      <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs text-zinc-300">
                        Add service
                        <select
                          name="service"
                          required
                          className={fieldClass}
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Choose a current service
                          </option>
                          {catalog.data.services
                            .filter(
                              (s) =>
                                !b.lines.some(
                                  (l) => !l.removed && l.serviceId === s.id,
                                ) &&
                                s.offers.some(
                                  (o) =>
                                    o.vehicleCategoryId ===
                                      catalog.data!.vehicleCategories.find(
                                        (v) => v.code === b.sizeCode,
                                      )?.id && o.onlineBooking !== "UNAVAILABLE",
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
                      <label className="text-xs text-zinc-300">
                        Quantity
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={20}
                          defaultValue={1}
                          required
                          className={fieldClass}
                        />
                      </label>
                      <Button disabled={disabled} className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400">
                        Add service
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* Assigned Staff Section */}
            <section aria-label="Assigned staff" className="rounded-xl border border-zinc-800/80 bg-panel p-4.5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Assigned staff</h3>
                    <p className="text-xs text-zinc-400">Detailers assigned to perform this job</p>
                  </div>
                </div>
                <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-300">
                  {b.assignedWorkers?.length ?? 0} detailers
                </span>
              </div>

              {/* Detailer Chips */}
              <div className="space-y-2">
                <p className="break-words text-sm text-zinc-300">
                  {b.assignedWorkers
                    ?.map((w) => w.name + (w.isActive ? "" : " (inactive)"))
                    .join(", ") || "Unassigned"}
                </p>

                {b.assignedWorkers && b.assignedWorkers.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {b.assignedWorkers.map((w) => (
                      <div
                        key={w.staffId}
                        className="flex items-center gap-2 rounded-lg border border-zinc-700/80 bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-200"
                      >
                        <UserCheck className="h-3.5 w-3.5 text-amber-400" />
                        <span className="font-medium">{w.name}</span>
                        {!w.isActive && <span className="text-rose-400">(inactive)</span>}
                        {canAssignStaff && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              void write("/workers/" + w.staffId, {}, "DELETE")
                            }
                            className="ml-1 rounded text-zinc-400 hover:text-rose-400 transition-colors"
                            title={`Remove ${w.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canAssignStaff && (
                <div className="space-y-3 border-t border-zinc-800/60 pt-3">
                  <LoadState
                    loading={workers.loading}
                    error={workers.error}
                    retry={workers.reload}
                  />
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(e) =>
                      submit(
                        e,
                        (f) =>
                          void write(
                            "/workers/" + String(f.get("worker")),
                            {},
                            "PUT",
                          ),
                      )
                    }
                  >
                    <label className="min-w-0 flex-1 text-xs text-zinc-300">
                      Add assigned worker
                      <select
                        name="worker"
                        className={fieldClass}
                        required
                        disabled={disabled}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Choose an active worker
                        </option>
                        {workers.data?.workers
                          .filter(
                            (w) =>
                              !b.assignedWorkers.some(
                                (a) => a.staffId === w.staffId,
                              ),
                          )
                          .map((w) => (
                            <option key={w.staffId} value={w.staffId}>
                              {w.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button disabled={disabled} className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400">
                      Assign worker
                    </Button>
                  </form>
                  {/* Keep fallback remove buttons for tests and accessibility */}
                  <div className="flex flex-wrap gap-2">
                    {b.assignedWorkers.map((w) => (
                      <Button
                        key={w.staffId}
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          void write("/workers/" + w.staffId, {}, "DELETE")
                        }
                        className="border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
                      >
                        Remove {w.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Deposit Verification Card */}
            <section aria-label="Deposit" className="rounded-xl border border-zinc-800/80 bg-panel p-4.5 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
                    <CreditCard className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Deposit</h3>
                    <p className="text-xs text-zinc-400">Customer deposit payment verification</p>
                  </div>
                </div>
                <DepositBadge status={b.depositStatus} showNone />
              </div>

              {b.depositProofs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    The customer has not sent a deposit screenshot.
                  </p>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {b.depositProofs.map((p, i) => {
                    const src = `/api/admin/bookings/${b.id}/deposit-proofs/${p.id}`;
                    return (
                      <li key={p.id} className="space-y-1.5">
                        <a
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative block overflow-hidden rounded-xl border border-zinc-800 bg-black transition-all hover:border-amber-500/60 focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {/* A private, staff-only image: next/image would route it through the public optimizer. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt={`Deposit screenshot ${i + 1}, sent ${sentAt(p.createdAt)}`}
                            width={p.width}
                            height={p.height}
                            loading="lazy"
                            className="h-40 w-full object-contain transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                            <span className="rounded-md border border-amber-500/40 bg-zinc-900/90 px-2.5 py-1 text-xs font-semibold text-amber-400">
                              View full image ↗
                            </span>
                          </div>
                        </a>
                        <p className="text-xs text-muted-foreground">
                          Screenshot {i + 1} · {sentAt(p.createdAt)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}

              {admin && b.snapshot === "QUEUE_V3" && (
                <form
                  className="space-y-3 border-t border-zinc-800/60 pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // The clicked button carries the decision.
                    const f = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
                    const reason = String(f.get("depositReason") ?? "").trim();
                    void write("/deposit", {
                      status: String(f.get("depositStatus")),
                      ...(reason ? { reason } : {}),
                    });
                  }}
                >
                  <label className="block text-xs text-zinc-300">
                    Note for the shop record (optional, staff only)
                    <input
                      name="depositReason"
                      maxLength={500}
                      placeholder="e.g. Verified GCash Ref #123456789"
                      className={fieldClass}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      name="depositStatus"
                      value="RECEIVED"
                      disabled={disabled || b.depositStatus === "RECEIVED"}
                      className="bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
                    >
                      Mark deposit received
                    </Button>
                    <Button
                      name="depositStatus"
                      value="REJECTED"
                      variant="outline"
                      disabled={
                        disabled ||
                        b.depositStatus === "REJECTED" ||
                        b.depositProofs.length === 0
                      }
                      className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      Mark deposit rejected
                    </Button>
                  </div>
                </form>
              )}
            </section>

            {/* Queue Movement & Operational Controls */}
            {admin &&
              b.snapshot === "QUEUE_V3" &&
              ["PENDING", "CONFIRMED"].includes(b.status) && (
                <div className="rounded-xl border border-zinc-800/80 bg-panel p-4.5 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-zinc-800/60 pb-2">
                    <Calendar className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-bold text-white">Reschedule & Queue Placement</h3>
                  </div>
                  <form
                    onSubmit={(e) =>
                      submit(e, (f) => {
                        if (
                          window.confirm(
                            "Move this booking to the selected day and queue?",
                          )
                        )
                          void write("/move", {
                            toDate: String(f.get("date")),
                            toQueueCode: String(f.get("queue")),
                          });
                      })
                    }
                    className="grid items-end gap-3 sm:grid-cols-3"
                  >
                    <label className="text-xs text-zinc-300">
                      Move to date
                      <input
                        type="date"
                        name="date"
                        required
                        defaultValue={b.bookingDate}
                        className={fieldClass}
                      />
                    </label>
                    <label className="text-xs text-zinc-300">
                      Move to queue
                      <select
                        name="queue"
                        defaultValue={b.queueCode ?? ""}
                        className={fieldClass}
                      >
                        {queues
                          .filter((q) => q.isActive)
                          .map((q) => (
                            <option key={q.code} value={q.code}>
                              {q.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button disabled={disabled} className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400">
                      Move booking
                    </Button>
                  </form>
                </div>
              )}

            {/* Decline Form */}
            {admin && open && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4.5 space-y-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-400" />
                  <h3 className="text-sm font-bold text-rose-400">Decline booking</h3>
                </div>
                <form
                  onSubmit={(e) =>
                    submit(e, (f) => {
                      if (
                        window.confirm(
                          "Decline this booking and release its capacity?",
                        )
                      )
                        void write("/decline", { reason: String(f.get("reason")) });
                    })
                  }
                  className="flex flex-wrap items-end gap-3"
                >
                  <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs text-zinc-300">
                    Decline reason
                    <input
                      name="reason"
                      required
                      maxLength={500}
                      placeholder="Reason for declining this booking"
                      className={fieldClass}
                    />
                  </label>
                  <Button variant="destructive" disabled={disabled}>
                    Decline booking
                  </Button>
                </form>
              </div>
            )}

            {/* Reinstate Form */}
            {statusActions(b, role).includes("PENDING") && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4.5 space-y-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-amber-400">Reinstate booking</h3>
                </div>
                <form
                  onSubmit={(e) =>
                    submit(e, (f) => {
                      if (
                        window.confirm(
                          "Reinstate this shop-declined booking? Capacity will be checked.",
                        )
                      )
                        void write("/status", {
                          status: "PENDING",
                          reason: String(f.get("reason")),
                        });
                    })
                  }
                  className="flex flex-wrap items-end gap-3"
                >
                  <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs text-zinc-300">
                    Reinstate reason
                    <input
                      name="reason"
                      required
                      maxLength={500}
                      placeholder="Reason for reinstating"
                      className={fieldClass}
                    />
                  </label>
                  <Button disabled={disabled} className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400">
                    Reinstate booking
                  </Button>
                </form>
              </div>
            )}

            {/* Audit History (Collapsible) */}
            <details className="group rounded-xl border border-zinc-800/80 bg-panel p-4 transition-colors">
              <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-sm font-bold text-zinc-300 transition-colors hover:text-white">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span>Audit history</span>
                </div>
                <span className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs font-normal text-zinc-400">
                  {b.history.length} events
                </span>
              </summary>
              <ul className="mt-3 space-y-2 border-t border-zinc-800/60 pt-3 text-xs text-muted-foreground">
                {b.history.map((h) => (
                  <li key={h.id}>
                    {[h.createdAt, h.action, h.actorName ?? (h.source === "CUSTOMER" ? "Customer" : null), h.reason]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </details>

            {/* Danger Zone: Delete Booking (Admin only) */}
            {admin && (
              <details className="group rounded-xl border border-rose-500/30 bg-rose-950/10 p-4 transition-colors">
                <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-sm font-bold text-rose-400 transition-colors hover:text-rose-300">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-rose-400" />
                    <span id="delete-booking-title">Delete booking</span>
                  </div>
                  <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-400">
                    Danger zone
                  </span>
                </summary>
                <form
                  aria-labelledby="delete-booking-title"
                  onSubmit={(e) =>
                    submit(e, (f) => {
                      void write("/delete", { reference: String(f.get("reference")) });
                    })
                  }
                  className="mt-3 space-y-3 border-t border-rose-500/20 pt-3"
                >
                  <p className="text-xs text-muted-foreground">
                    Deleting removes this booking, its services, any deposit proof and its place on
                    the board for good. It also removes it from history, from the day&apos;s counts
                    and from any totals built from completed jobs. A short record that you deleted
                    it is kept.
                  </p>
                  <label className="block text-xs text-zinc-300">
                    Type {b.referenceCode} to confirm
                    <input
                      name="reference"
                      autoComplete="off"
                      spellCheck={false}
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      className={fieldClass}
                    />
                  </label>
                  <Button
                    variant="destructive"
                    disabled={disabled || typed !== b.referenceCode}
                  >
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

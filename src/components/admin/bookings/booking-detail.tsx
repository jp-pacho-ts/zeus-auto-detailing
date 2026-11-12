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
import { notifyNotice, statusActions, shopDate } from "./model";
import { writeFeedback } from "./board-model";
import { LoadState, useAdminResource } from "./use-admin-resource";
import { AlertCircle, Check } from "lucide-react";
import { primary, nextStep } from "./detail/shared";
import { DetailHeader, NextStep } from "./detail/header";
import { SummaryStrip } from "./detail/summary-strip";
import { ServicesSection } from "./detail/services-section";
import { PaymentSection } from "./detail/payment-section";
import { CustomerSection } from "./detail/customer-section";
import { CrewSection, type Recalc } from "./detail/crew-section";
import { ActivitySection } from "./detail/activity-section";
import { ManageSection, ReinstateBanner } from "./detail/manage-section";
import { DetailSkeleton } from "./detail/detail-skeleton";

// P1-68: this file keeps the state, the write calls and the dialog shell. The sections in ./detail are
// presentational. Every action, confirm and revision/conflict guard is unchanged.
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
  const title = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    dialog.current?.showModal();
    // showModal focuses the first control (Refresh); start on the heading instead.
    title.current?.focus();
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
  const [recalc, setRecalc] = React.useState<Recalc | null>(null);
  const mounted = React.useRef(true),
    writing = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function recalculate() {
    if (writing.current || !window.confirm("Recalculate this booking's commission with today's service and worker rates? Paid or adjusted commission is never changed.")) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setRecalc(await adminRequest<Recalc>(`/api/admin/bookings/${id}/commission`, { method: "POST", body: {} }));
      // The Commissions screen may already be open: it reloads on this event so the new records show at once.
      window.dispatchEvent(new Event("zeus:commissions-changed"));
    } catch (e) {
      if (e instanceof AdminRequestError && e.status === 401) return window.location.replace("/admin/login");
      setError(e instanceof AdminRequestError ? writeFeedback(e.detail).message : "Couldn't reach the shop server. Try again.");
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
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
  const admin = role === "ADMIN",
    disabled = busy || Boolean(conflict) || uncertain,
    open = Boolean(b && ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status)),
    canAssignStaff =
      admin && Boolean(b && ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(b.status) && b.snapshot === "QUEUE_V3");
  const step = b ? nextStep(b, role) : null;
  const refresh = () => {
    setConflict(null);
    setError(null);
    setUncertain(false);
    void resource.reload();
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="booking-detail-title"
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none flex-col overflow-hidden bg-background p-0 text-foreground backdrop:bg-black/80 sm:m-auto sm:h-[min(92dvh,880px)] sm:w-[calc(100%-2rem)] sm:max-w-[1120px] sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl"
    >
      <DetailHeader
        b={b}
        queues={queues}
        step={step}
        busy={busy}
        disabled={disabled}
        write={write}
        titleRef={title}
        onRefresh={refresh}
        onClose={onClose}
      />

      {/* The only scrolling area. Messages stick to its top so they are seen without scrolling back. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {(error || notice || conflict) && (
          <div className="sticky top-0 z-10 space-y-2 bg-background/95 p-4 pb-0 backdrop-blur-sm sm:px-6">
            {/* A conflict has its own fuller message below; do not say it twice. */}
            {error && !conflict && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-600/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{error}</span>
                {uncertain && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
                    Refresh
                  </Button>
                )}
              </div>
            )}
            {notice && (
              <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
                <Check className="h-4 w-4 shrink-0" />
                <span>{notice}</span>
              </div>
            )}
            {conflict && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-600/40 bg-amber-500/10 p-3">
                <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">
                  Someone else changed this booking. Your change was not applied. Review the latest version first.
                </p>
                <Button
                  size="sm"
                  className={primary}
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
          </div>
        )}

        {resource.loading && <DetailSkeleton />}
        {resource.error && (
          <div className="p-4 sm:p-6">
            <LoadState loading={false} error={resource.error} retry={resource.reload} />
          </div>
        )}

        {b && (
          <div aria-busy={busy}>
            <SummaryStrip b={b} />
            <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
              {statusActions(b, role).includes("PENDING") && (
                <div className="lg:col-span-2">
                  <ReinstateBanner key={b.revision} disabled={disabled} write={write} />
                </div>
              )}
              {/* Keyed by revision: after each change, the forms start from the saved booking. */}
              <div key={b.revision} className="min-w-0 space-y-4">
                <ServicesSection b={b} admin={admin} open={open} disabled={disabled} write={write} setError={setError} catalog={catalog} />
                <PaymentSection b={b} admin={admin} disabled={disabled} write={write} />
              </div>
              <div className="min-w-0 space-y-4">
                <CustomerSection b={b} admin={admin} busy={busy} disabled={disabled} write={write} />
                <CrewSection
                  key={b.revision}
                  b={b}
                  admin={admin}
                  canAssignStaff={canAssignStaff}
                  disabled={disabled}
                  write={write}
                  workers={workers}
                  recalc={recalc}
                  onRecalculate={() => void recalculate()}
                />
                <ActivitySection history={b.history} />
              </div>
              <div key={`manage-${b.revision}`} className="lg:col-span-2">
                <ManageSection b={b} admin={admin} open={open} disabled={disabled} write={write} queues={queues} typed={typed} setTyped={setTyped} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Below lg the header has no room for the next step, so it stays in reach here. */}
      {step && (
        <footer className="border-t border-border bg-panel px-4 py-3 lg:hidden">
          <NextStep step={step} disabled={disabled} write={write} className="flex items-center" />
        </footer>
      )}
    </dialog>
  );
}

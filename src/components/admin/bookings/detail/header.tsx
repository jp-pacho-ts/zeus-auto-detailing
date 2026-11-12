import * as React from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBookingDetail, AdminDayQueues } from "@/types/admin-contracts";
import { BODY_TYPE_LABEL, type VehicleBodyType } from "@/types/catalog-contracts";
import { statusLabel } from "../model";
import { plateLabel } from "../board-model";
import { doneButton, nextStep, primary, shopDay, statusPill, type Write } from "./shared";

// The one next status step, with its reason when it cannot be taken yet. Shown in the header from lg and in
// the dialog footer below lg, so it is always in reach.
export function NextStep({
  step,
  disabled,
  write,
  className = "",
}: {
  step: NonNullable<ReturnType<typeof nextStep>>;
  disabled: boolean;
  write: Write;
  className?: string;
}) {
  const reasonId = React.useId();
  return (
    <div className={`gap-x-3 gap-y-1 ${className}`}>
      {step.reason && (
        <p id={reasonId} className="min-w-0 flex-1 text-xs text-muted-foreground lg:flex-none">
          {step.reason}
        </p>
      )}
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {step.actions.length === 0 ? (
          <Button disabled aria-describedby={reasonId} className={doneButton}>
            Mark done
          </Button>
        ) : (
          step.actions.map((status, i) => (
            <Button
              key={status}
              disabled={disabled}
              variant={i > 0 ? "outline" : undefined}
              onClick={() => {
                if (status !== "COMPLETED" || window.confirm("Mark this booking done? All active services must be done."))
                  void write("/status", { status });
              }}
              className={status === "COMPLETED" ? doneButton : i === 0 ? primary : ""}
            >
              {status === "CONFIRMED" ? "Confirm booking" : status === "IN_PROGRESS" ? "Start work" : "Mark done"}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}

export function DetailHeader({
  b,
  queues,
  step,
  busy,
  disabled,
  write,
  titleRef,
  onRefresh,
  onClose,
}: {
  b: AdminBookingDetail | null;
  queues: AdminDayQueues["queues"];
  step: ReturnType<typeof nextStep>;
  busy: boolean;
  disabled: boolean;
  write: Write;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const queue = b?.queueCode ? (queues.find((q) => q.code === b.queueCode)?.name ?? b.queueCode) : null;
  const body = b?.bodyType ? (BODY_TYPE_LABEL[b.bodyType as VehicleBodyType] ?? b.bodyType) : "";
  return (
    <header className="border-b border-border bg-panel px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="booking-detail-title" ref={titleRef} tabIndex={-1} className="min-w-0 truncate text-lg font-semibold text-foreground outline-none sm:text-xl">
              {b ? b.customerName : "Booking details"}
            </h2>
            {b && <span className={statusPill(b.status)}>{statusLabel(b.status)}</span>}
          </div>
          {b && (
            <>
              {/* One text node: booking-detail.test.ts reads this line whole. */}
              <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                {`${b.vehicleModel} · ${plateLabel(b.vehiclePlate)} · ${b.sizeCode ?? "Older booking"}${body ? " " + body : ""}`}
              </p>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <div className="flex gap-1.5">
                  <dt>Ref</dt>
                  <dd className="font-mono font-semibold text-foreground">{b.referenceCode}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>Drop-off</dt>
                  <dd className="text-foreground">{shopDay(b.bookingDate)}</dd>
                </div>
                {queue && (
                  <div className="flex gap-1.5">
                    <dt>Queue</dt>
                    <dd className="text-foreground">
                      {queue}
                      {b.queuePosition ? `, #${b.queuePosition}` : ""}
                    </dd>
                  </div>
                )}
                {b.bay && (
                  <div className="flex gap-1.5">
                    <dt>Bay</dt>
                    <dd className="text-foreground">{b.bay.name}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </div>
        {step && <NextStep step={step} disabled={disabled} write={write} className="hidden flex-col-reverse items-end lg:flex" />}
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-raised" disabled={busy} aria-label="Refresh details" title="Refresh" onClick={onRefresh}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-raised" disabled={busy} onClick={onClose} aria-label="Close details" title="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type {
  AdminBay,
  AdminDayBoard,
  AdminBookingDetail,
  AdminDayQueues,
  AdminWriteResult,
  AdminNotifyResult,
} from "@/types/admin-contracts";
import type { BookingCatalog } from "@/types/catalog-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./client";
import {
  centavos,
  money,
  statusActions,
  statusLabel,
  totalLabel,
} from "./model";
import { boardProgress, plateLabel, writeFeedback } from "./board-model";
import { shopDate } from "./model";
import { fieldClass, LoadState, useAdminResource } from "./use-admin-resource";
import { DepositBadge } from "./deposit-badge";

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
  const resource = useAdminResource<AdminBookingDetail>(
      `/api/admin/bookings/${id}`,
    ),
    b = resource.data;
  const bays = useAdminResource<AdminBay[]>("/api/admin/bays"),
    catalog = useAdminResource<BookingCatalog>(
      role === "ADMIN" ? "/api/catalog" : null,
    );
  const workers = useAdminResource<AdminDayBoard>(
    role === "ADMIN" ? "/api/admin/board?date=" + shopDate() : null,
  );
  const [busy, setBusy] = React.useState(false),
    [uncertain, setUncertain] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [notice, setNotice] = React.useState<string | null>(null),
    [conflict, setConflict] = React.useState<AdminBookingDetail | null>(null);
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
  ) {
    if (!b || writing.current || conflict || uncertain) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminRequest<AdminWriteResult | AdminNotifyResult>(
        `/api/admin/bookings/${id}${path}`,
        { method, body: { ...body, expectedRevision: b.revision } },
      );
      if (!mounted.current) return;
      resource.setData(result.booking);
      void onChanged();
      setNotice(
        "notice" in result
          ? {
              SENT: "Customer email sent.",
              NOT_SENT: "Customer email was not sent. Try again later.",
              NO_EMAIL: "No customer email address is on file.",
            }[result.notice]
          : result.noChange
            ? "No change was needed."
            : "Booking updated.",
      );
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof AdminRequestError) {
        if (e.status === 401) {
          window.location.replace("/admin/login");
          return;
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
    open = b && ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="booking-detail-title"
      className="fixed max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded border border-border bg-[#121214] p-4 text-foreground backdrop:bg-black/80 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="booking-detail-title" className="text-lg font-bold">
          Booking details
        </h2>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Close details
        </Button>
      </div>
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={resource.reload}
      />
      {error && (
        <p role="alert" className="mt-4 text-sm text-rose-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {conflict && (
        <div className="my-4 rounded border border-primary p-4">
          <p className="text-sm">
            Someone changed this booking. Review revision {conflict.revision}{" "}
            before submitting a new action. Your change was not applied.
          </p>
          <Button
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
        <div key={b.revision} className="mt-4 space-y-5" aria-busy={busy}>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="font-mono font-bold text-primary">
                {b.referenceCode}
              </p>
              <p>{b.customerName}</p>
              <p>{b.customerPhone}</p>
              <p>{b.customerEmail ?? "No email"}</p>
            </div>
            <div>
              <p>
                {b.bookingDate} · {statusLabel(b.status)} · Revision{" "}
                {b.revision}
              </p>
              <p>
                {b.vehicleModel} · {plateLabel(b.vehiclePlate)}{" "}
                · {b.sizeCode ?? "Legacy"}
              </p>
              <p>{totalLabel(b.totals)}</p>
              <p>
                Original receipt:{" "}
                {b.totals.receiptTotalCentavos === null
                  ? "For quote"
                  : money(b.totals.receiptTotalCentavos)}
              </p>
            </div>
          </div>
          {b.notes && (
            <p className="whitespace-pre-wrap break-words text-sm">{b.notes}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {statusActions(b, role)
              .filter((s) => s !== "PENDING")
              .map((status) => (
                <Button
                  key={status}
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
                >
                  {status === "CONFIRMED"
                    ? "Confirm booking"
                    : status === "IN_PROGRESS"
                      ? "Start booking"
                      : "Complete booking"}
                </Button>
              ))}
            {open && (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "Send the fixed turn notice to this customer's email?",
                    )
                  )
                    void write("/notify", {});
                }}
              >
                Notify customer
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConflict(null);
                setError(null);
                setUncertain(false);
                void resource.reload();
              }}
            >
              Refresh details
            </Button>
          </div>
          {admin && open && (
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
              <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs">
                Decline reason
                <input
                  name="reason"
                  required
                  maxLength={500}
                  className={fieldClass}
                />
              </label>
              <Button variant="destructive" disabled={disabled}>
                Decline booking
              </Button>
            </form>
          )}
          {statusActions(b, role).includes("PENDING") && (
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
              <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs">
                Reinstate reason
                <input
                  name="reason"
                  required
                  maxLength={500}
                  className={fieldClass}
                />
              </label>
              <Button disabled={disabled}>Reinstate booking</Button>
            </form>
          )}
          {admin &&
            b.snapshot === "QUEUE_V3" &&
            ["PENDING", "CONFIRMED"].includes(b.status) && (
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
                <label className="text-xs">
                  Move to date
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={b.bookingDate}
                    className={fieldClass}
                  />
                </label>
                <label className="text-xs">
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
                <Button disabled={disabled}>Move booking</Button>
              </form>
            )}
          <section aria-label="Deposit" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold">Deposit</h3>
              <DepositBadge status={b.depositStatus} showNone />
            </div>
            {b.depositProofs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The customer has not sent a deposit screenshot.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-3">
                {b.depositProofs.map((p, i) => {
                  const src = `/api/admin/bookings/${b.id}/deposit-proofs/${p.id}`;
                  return (
                    <li key={p.id} className="space-y-1">
                      <a
                        href={src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded border border-border bg-black focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {/* A private, staff-only image: next/image would route it through the public optimizer. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Deposit screenshot ${i + 1}, sent ${sentAt(p.createdAt)}`}
                          width={p.width}
                          height={p.height}
                          loading="lazy"
                          className="h-40 w-full object-contain"
                        />
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
                className="space-y-2"
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
                <label className="block text-sm">
                  Note for the shop record (optional, staff only)
                  <input
                    name="depositReason"
                    maxLength={500}
                    className={fieldClass}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    name="depositStatus"
                    value="RECEIVED"
                    disabled={disabled || b.depositStatus === "RECEIVED"}
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
                      b.depositStatus === "NONE"
                    }
                  >
                    Mark deposit rejected
                  </Button>
                </div>
              </form>
            )}
          </section>
          <section aria-label="Assigned staff" className="space-y-3">
            <h3 className="font-bold">Assigned staff</h3>
            <p className="break-words text-sm">
              {b.assignedWorkers
                ?.map((w) => w.name + (w.isActive ? "" : " (inactive)"))
                .join(", ") || "Unassigned"}
            </p>
            {admin && open && b.snapshot === "QUEUE_V3" && (
              <>
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
                  <label className="min-w-0 flex-1 text-xs">
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
                  <Button disabled={disabled}>Assign worker</Button>
                </form>
                {b.assignedWorkers.map((w) => (
                  <Button
                    key={w.staffId}
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void write("/workers/" + w.staffId, {}, "DELETE")
                    }
                  >
                    Remove {w.name}
                  </Button>
                ))}
              </>
            )}
          </section>
          <div className="space-y-3">
            <h3 className="font-bold">
              Services · {boardProgress(b.lines).done}/
              {boardProgress(b.lines).total} done{" "}
              {b.snapshot === "LEGACY" && "· Legacy receipt"}
            </h3>
            {b.lines.map((line) => (
              <div
                key={line.id}
                className="rounded border border-border bg-[#18181b] p-3"
              >
                <p className="text-sm font-semibold">
                  {line.name} × {line.quantity}
                  {line.removed ? " · Removed" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {line.effectivePriceCentavos === null
                    ? `For quote${line.referenceSubtotalCentavos === null ? "" : ` · Estimate ${money(line.referenceSubtotalCentavos)}`}`
                    : money(line.effectivePriceCentavos)}{" "}
                  · {statusLabel(line.workStatus)}
                </p>
                {b.snapshot === "QUEUE_V3" && !line.removed && (
                  <div className="mt-3 space-y-3">
                    {open && (
                      <div className="flex flex-wrap gap-2">
                        {(["WAITING", "IN_PROGRESS", "DONE"] as const).map(
                          (workStatus) => (
                            <Button
                              key={workStatus}
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
                            >
                              {statusLabel(workStatus)}
                            </Button>
                          ),
                        )}
                        {admin && (
                          <Button
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
                          >
                            Remove service
                          </Button>
                        )}
                      </div>
                    )}
                    {admin && b.status !== "CANCELLED" && (
                      <form
                        className="flex flex-wrap items-end gap-2"
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
                        <label className="text-xs">
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
                        <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs">
                          Price reason
                          <input
                            name="reason"
                            required
                            maxLength={500}
                            className={fieldClass}
                          />
                        </label>
                        <Button disabled={disabled}>Set price</Button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            ))}
            {b.lines.length === 0 && (
              <p className="text-sm">{b.serviceName} · Historical receipt</p>
            )}
          </div>
          {admin && open && b.snapshot === "QUEUE_V3" && (
            <>
              <LoadState
                loading={catalog.loading}
                error={catalog.error}
                retry={catalog.reload}
              />
              {catalog.data && (
                <form
                  className="flex flex-wrap items-end gap-3"
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
                  <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs">
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
                  <label className="text-xs">
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
                  <Button disabled={disabled}>Add service</Button>
                </form>
              )}
            </>
          )}
          {admin && open && b.snapshot === "QUEUE_V3" && (
            <>
              <LoadState
                loading={bays.loading}
                error={bays.error}
                retry={bays.reload}
              />
              {bays.data && (
                <form
                  className="grid items-end gap-3 sm:grid-cols-3"
                  onSubmit={(e) =>
                    submit(
                      e,
                      (f) =>
                        void write(
                          "/bay",
                          {
                            date: String(f.get("date")),
                            bayId: String(f.get("bay")) || null,
                          },
                          "PUT",
                        ),
                    )
                  }
                >
                  <label className="text-xs">
                    Bay date
                    <input
                      name="date"
                      type="date"
                      required
                      min={b.bookingDate}
                      defaultValue={
                        b.bookingDate > shopDate() ? b.bookingDate : shopDate()
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="text-xs">
                    Assign bay
                    <select
                      name="bay"
                      defaultValue={b.occupancy?.bay.id ?? ""}
                      className={fieldClass}
                    >
                      <option value="">Unassigned</option>
                      {bays.data
                        .filter((bay) => bay.isActive)
                        .map((bay) => (
                          <option key={bay.id} value={bay.id}>
                            {bay.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button disabled={disabled}>Save bay assignment</Button>
                </form>
              )}
              <ul className="text-xs text-muted-foreground">
                {b.bays.map((a) => (
                  <li key={a.date}>
                    {a.date} · {a.bay.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary className="min-h-[44px] cursor-pointer text-sm font-bold">
              Audit history
            </summary>
            <ul className="space-y-2 text-xs text-muted-foreground">
              {b.history.map((h) => (
                <li key={h.id}>
                  {h.createdAt} · {h.action} · {h.actorName}
                  {h.reason && ` · ${h.reason}`}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </dialog>
  );
}

import "server-only";
import type { BookingStatus } from "@prisma/client";
import type {
  AdminNotifyResult,
  AdminQueueDay,
  AdminWriteResult,
} from "@/types/admin-contracts";
import { brandConfig } from "@/config/brand";
import {
  AddLineSchema,
  AdminDaySchema,
  AdminIdSchema,
  AdminQueueCodeSchema,
  BayAssignSchema,
  BookingStatusWriteSchema,
  DeclineSchema,
  LinePriceSchema,
  FinishBookingSchema,
  LineStatusSchema,
  MoveSchema,
  NotifySchema,
  RemoveLineSchema,
  ReorderSchema,
  BookingDetailsUpdateSchema,
} from "@/lib/admin-validation";
import { STATUS_NO_OP_ROLES } from "@/server/auth/policy";
import type { StaffTx } from "@/server/auth/db-admission";
import { dropAssignment } from "./workers-write";
import { loadCurrentRelease } from "@/server/catalog-read";
import { offerBooking } from "@/server/catalog-pricing";
import {
  addDays,
  authorize,
  dateCarrier,
  dayEnd,
  dayStart,
  isoDay,
  manilaDate,
  parse,
  type AdminOptions,
  type StaffActor,
} from "./context";
import { closedDay, committed, effectiveCap } from "./capacity";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import {
  audit,
  bump,
  conflict,
  detailOrThrow,
  loadForWrite,
  mutate,
} from "./mutation";
import { canPerform, type AdminOp } from "./roles";
import { unavailableSender } from "./notice";
import { bookingInclude, toQueueBooking } from "./views";
import { lockBookingDates } from "@/server/bookings-locks";

const OPEN: BookingStatus[] = ["PENDING", "CONFIRMED", "IN_PROGRESS"];
const today = (o: AdminOptions) => manilaDate(o.now?.() ?? new Date());
const dayLabel = new Intl.DateTimeFormat(brandConfig.locale, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// P1-28: work (a bay, a started service, IN_PROGRESS, COMPLETED) waits for the booked Manila
// day; confirming ahead does not. Returns the staff message, or null once the day has come.
export function startDayRefusal(bookedDay: string, now: string): string | null {
  if (now >= bookedDay) return null;
  return `This booking is for ${dayLabel.format(dateCarrier(bookedDay))}. It can start on that day.`;
}
async function refuseBeforeDay(
  tx: StaffTx,
  bookingId: string,
  bookingDate: Date,
  options: AdminOptions,
): Promise<void> {
  const message = startDayRefusal(isoDay(bookingDate), today(options));
  if (message) await conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId, message);
}
const result = async (
  tx: StaffTx,
  id: string,
  noChange: boolean,
): Promise<AdminWriteResult> => ({
  booking: await detailOrThrow(tx, id),
  noChange,
});
const logWrite = (
  actor: StaffActor,
  action: string,
  bookingId: string,
  toRevision: number,
) =>
  adminEvent("admin.booking." + action, {
    bookingId,
    actorStaffId: actor.staffId,
    toRevision,
  });

// Persistent occupancy ends only on an explicit release or terminal transition.
async function releaseOccupancy(
  tx: StaffTx,
  actor: StaffActor,
  bookingId: string,
  rev: number,
) {
  const current = await tx.bayOccupancy.findUnique({ where: { bookingId } });
  if (!current) return;
  await tx.bayOccupancy.delete({ where: { bookingId } });
  await audit(tx, actor, {
    action: "BAY_UNASSIGNED",
    bookingId,
    bayId: current.bayId,
    fromDate: current.date,
    fromRevision: rev,
    toRevision: rev + 1,
  });
}

// LE P1-04 I3: moving a visit releases every physical/dated bay assignment, as decline does.
async function releaseBays(
  tx: StaffTx,
  actor: StaffActor,
  bookingId: string,
  rev: number,
): Promise<void> {
  const occupancy = await tx.bayOccupancy.findUnique({ where: { bookingId } });
  if (occupancy)
    await releaseOccupancy(tx, actor, bookingId, rev);
  const rows = await tx.bookingBayAssignment.findMany({
    where: {
      bookingId,
    },
  });
  for (const a of rows) {
    await tx.bookingBayAssignment.delete({
      where: { bookingId_date: { bookingId, date: a.date } },
    });
    if (!(
      occupancy &&
      occupancy.bayId === a.bayId &&
      isoDay(occupancy.date) === isoDay(a.date)
    ))
      await audit(tx, actor, {
        action: "BAY_UNASSIGNED",
        bookingId,
        bayId: a.bayId,
        fromDate: a.date,
        fromRevision: rev,
        toRevision: rev + 1,
      });
  }
}

const STATUS_FROM: Record<
  "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "PENDING",
  BookingStatus[]
> = {
  CONFIRMED: ["PENDING"],
  IN_PROGRESS: ["PENDING", "CONFIRMED"],
  COMPLETED: ["IN_PROGRESS"],
  PENDING: ["CANCELLED"],
};
const STATUS_OP: Record<keyof typeof STATUS_FROM, AdminOp> = {
  CONFIRMED: "STATUS_CONFIRMED",
  IN_PROGRESS: "STATUS_IN_PROGRESS",
  COMPLETED: "STATUS_COMPLETED",
  PENDING: "STATUS_REINSTATE",
};

// W1: confirm (ADMIN), start and complete (STAFF, D4), reinstate a declined booking (ADMIN, D5).
// The role depends on the target, so it is checked after the revision (T-019 steps 6-7).
export async function setBookingStatus(
  actor: StaffActor,
  id: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "READ");
  const bookingId = parse(AdminIdSchema, id);
  const v = parse(BookingStatusWriteSchema, input);
  return mutate(options, "status", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision);
    if (b.status === v.status) {
      if (STATUS_NO_OP_ROLES[v.status].includes(actor.role))
        return result(tx, bookingId, true);
      return conflict(tx, "FORBIDDEN", bookingId);
    }
    if (!STATUS_FROM[v.status].includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    if (!canPerform(STATUS_OP[v.status], actor.role))
      return conflict(tx, "FORBIDDEN", bookingId);
    if (v.status === "IN_PROGRESS" || v.status === "COMPLETED")
      await refuseBeforeDay(tx, bookingId, b.bookingDate, options);
    const v3 = b.snapshotVersion === "QUEUE_V3";
    if (
      v3 &&
      v.status === "COMPLETED" &&
      (!b.lineItems.some((l) => l.removedAt === null) ||
        b.lineItems.some(
          (l) => l.removedAt === null && l.workStatus !== "DONE",
        ))
    ) {
      return conflict(
        tx,
        "BOOKING_NOT_MANAGEABLE",
        bookingId,
        "Mark every service done before completing the booking.",
      );
    }
    if (v.status === "PENDING") {
      const day = isoDay(b.bookingDate);
      if (!v3 || b.cancellationKind !== "SHOP_DECLINED" || day < today(options))
        return conflict(
          tx,
          "BOOKING_NOT_MANAGEABLE",
          bookingId,
          "Only an upcoming shop-declined day-queue booking can be reinstated.",
        );
      await checkTarget(tx, bookingId, b.queueCode!, day, today(options));
    }
    await bump(tx, bookingId, v.expectedRevision, {
      status: v.status,
      ...(v.status === "COMPLETED" ? { terminalAt: new Date() } : {}),
      ...(v.status === "PENDING"
        ? { terminalAt: null, cancellationKind: null }
        : {}),
    });
    await audit(tx, actor, {
      action: "STATUS_CHANGED",
      bookingId,
      fromStatus: b.status,
      toStatus: v.status,
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
      reason: v.reason ?? null,
    });
    if (v.status === "COMPLETED")
      await releaseOccupancy(tx, actor, bookingId, v.expectedRevision);
    // P1-64: a closed booking keeps its names and the database refuses changing them, so a person removed while it was declined comes off here, the only way it can
    // reopen. Otherwise they would be back on an open job and credited when it finishes.
    if (v.status === "PENDING") {
      const gone = await tx.bookingWorkerAssignment.findMany({ where: { bookingId, staff: { isActive: false } }, select: { staffId: true } });
      for (const w of gone) await dropAssignment(tx, actor, bookingId, w.staffId, v.expectedRevision);
    }
    logWrite(actor, "status_changed", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// Cap and closed-day checks for a booking taking a unit on (queue, day), under the shop lock.
async function fits(
  tx: StaffTx,
  bookingId: string,
  queueCode: string,
  day: string,
): Promise<void> {
  if (await closedDay(tx, day))
    await conflict(
      tx,
      "SCHEDULE_CONFLICT",
      bookingId,
      "The shop is closed that day.",
      { toDate: ["The shop is closed that day."] },
    );
  const cap = await effectiveCap(tx, queueCode, day);
  if (cap !== null && (await committed(tx, queueCode, day, bookingId)) >= cap) {
    await conflict(
      tx,
      "SCHEDULE_CONFLICT",
      bookingId,
      "That day is full for this queue.",
      { toDate: ["That day is full for this queue."] },
    );
  }
}

// Both moves and reinstatements take capacity only on an eligible active target (D5/R16).
async function checkTarget(
  tx: StaffTx,
  bookingId: string,
  queueCode: string,
  day: string,
  now: string,
): Promise<void> {
  if (day < now || day > addDays(now, 90))
    throw fieldError("toDate", "Choose a day from today to 90 days ahead.");
  const queue = await tx.bookingQueue.findUnique({
    where: { code: queueCode },
  });
  if (!queue || !queue.isActive)
    throw fieldError("toQueueCode", "Choose an active queue.");
  await fits(tx, bookingId, queueCode, day);
}

// W2: decline = CANCELLED with the shop-decline kind (§14); the reason stays in the audit.
export async function declineBooking(
  actor: StaffActor,
  id: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "DECLINE");
  const bookingId = parse(AdminIdSchema, id);
  const v = parse(DeclineSchema, input);
  return mutate(options, "decline", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision);
    if (b.status === "CANCELLED") return result(tx, bookingId, true);
    if (b.status !== "PENDING" && b.status !== "CONFIRMED")
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    await bump(tx, bookingId, v.expectedRevision, {
      status: "CANCELLED",
      cancellationKind: "SHOP_DECLINED",
      terminalAt: new Date(),
    });
    if (b.snapshotVersion === "QUEUE_V3")
      await releaseBays(tx, actor, bookingId, v.expectedRevision);
    await audit(tx, actor, {
      action: "STATUS_CHANGED",
      bookingId,
      fromStatus: b.status,
      toStatus: "CANCELLED",
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
      reason: v.reason,
    });
    logWrite(actor, "declined", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// W3: move to another day and/or queue, cap-checked; the next position in the target.
export async function moveBooking(
  actor: StaffActor,
  id: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "MOVE");
  const bookingId = parse(AdminIdSchema, id);
  const v = parse(MoveSchema, input);
  return mutate(options, "move", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, {
      v3: true,
      dates: [v.toDate],
    });
    const fromDay = isoDay(b.bookingDate);
    if (fromDay === v.toDate && b.queueCode === v.toQueueCode)
      return result(tx, bookingId, true);
    if (b.status !== "PENDING" && b.status !== "CONFIRMED")
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    await checkTarget(tx, bookingId, v.toQueueCode, v.toDate, today(options));
    const { _max } = await tx.booking.aggregate({
      where: { bookingDate: dateCarrier(v.toDate), queueCode: v.toQueueCode },
      _max: { queuePosition: true },
    });
    await bump(tx, bookingId, v.expectedRevision, {
      bookingDate: dateCarrier(v.toDate),
      startsAt: dayStart(v.toDate),
      endsAt: dayEnd(v.toDate),
      queueCode: v.toQueueCode,
      queuePosition: (_max.queuePosition ?? 0) + 1,
    });
    await releaseBays(tx, actor, bookingId, v.expectedRevision);
    const revs = {
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
    };
    if (fromDay !== v.toDate)
      await audit(tx, actor, {
        action: "RESCHEDULED",
        bookingId,
        fromDate: b.bookingDate,
        toDate: dateCarrier(v.toDate),
        ...revs,
      });
    if (b.queueCode !== v.toQueueCode)
      await audit(tx, actor, {
        action: "QUEUE_MOVED",
        bookingId,
        fromQueueCode: b.queueCode,
        toQueueCode: v.toQueueCode,
        ...revs,
      });
    logWrite(actor, "moved", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// W4: reorder one (queue, day). Fresh positions after the current maximum, in the given order
// (P1-07 R3), so no position is ever shared mid-statement. Each booking: one bump, one audit row.
export async function reorderQueueDay(
  actor: StaffActor,
  code: unknown,
  date: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<{ queue: AdminQueueDay }> {
  authorize(actor, "REORDER");
  const queueCode = parse(AdminQueueCodeSchema, code);
  const day = parse(AdminDaySchema, date);
  const v = parse(ReorderSchema, input);
  return mutate(options, "reorder", async (tx) => {
    await lockBookingDates(tx, [day]);
    const queue = await tx.bookingQueue.findUnique({
      where: { code: queueCode },
    });
    if (!queue) throw new AdminServiceError("NOT_FOUND");
    const where = {
      bookingDate: dateCarrier(day),
      queueCode,
      snapshotVersion: "QUEUE_V3" as const,
    };
    const open = await tx.booking.findMany({
      where: { ...where, status: { not: "CANCELLED" } },
      orderBy: { queuePosition: "asc" },
    });
    const ids = new Set(open.map((b) => b.id));
    if (
      open.length !== v.bookings.length ||
      v.bookings.some((x) => !ids.has(x.id))
    ) {
      throw fieldError(
        "bookings",
        "List every open booking of this queue and day exactly once.",
      );
    }
    for (const x of v.bookings)
      if (open.find((b) => b.id === x.id)!.revision !== x.expectedRevision)
        await conflict(tx, "VERSION_CONFLICT", x.id);
    const changed = v.bookings.some((x, i) => open[i].id !== x.id);
    if (changed) {
      const { _max } = await tx.booking.aggregate({
        where,
        _max: { queuePosition: true },
      });
      let next = (_max.queuePosition ?? 0) + 1;
      for (const x of v.bookings) {
        const from = open.find((b) => b.id === x.id)!.queuePosition!;
        await bump(tx, x.id, x.expectedRevision, { queuePosition: next });
        await audit(tx, actor, {
          action: "REORDERED",
          bookingId: x.id,
          fromPosition: from,
          toPosition: next,
          fromRevision: x.expectedRevision,
          toRevision: x.expectedRevision + 1,
        });
        next++;
      }
      adminEvent("admin.queue.reordered", {
        queueCode,
        actorStaffId: actor.staffId,
        count: v.bookings.length,
      });
    }
    const rows = await tx.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: [{ queuePosition: "asc" }],
    });
    const openRows = rows.filter((b) => b.status !== "CANCELLED"),
      cancelled = rows.filter((b) => b.status === "CANCELLED");
    return {
      queue: {
        code: queue.code,
        name: queue.name,
        isActive: queue.isActive,
        effectiveCap: await effectiveCap(tx, queueCode, day),
        committed: openRows.length,
        bookings: [...openRows, ...cancelled].map(toQueueBooking),
      },
    };
  });
}

// W5: add a service from the head release (A4), with the composition rules pricing applies (R42).
export async function addLine(
  actor: StaffActor,
  id: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "LINE_ADD");
  const bookingId = parse(AdminIdSchema, id);
  const v = parse(AddLineSchema, input);
  return mutate(options, "line_add", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, {
      v3: true,
    });
    if (!OPEN.includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    const release = await loadCurrentRelease(tx);
    if (!release) throw new AdminServiceError("RETRYABLE_ERROR");
    const service = release.services.find((x) => x.id === v.serviceId);
    if (!service)
      throw fieldError("serviceId", "Choose a service from the current list.");
    const offer = service.offers.find(
      (o) => o.vehicleCategoryId === b.vehicleCategoryId,
    )!;
    const booking = offerBooking(service, offer);
    if (booking === "UNAVAILABLE")
      throw fieldError(
        "serviceId",
        "This service isn't offered for this vehicle size.",
      );
    if (service.unit === "VEHICLE" && v.quantity !== 1)
      throw fieldError("quantity", "This service is priced per vehicle.");
    const active = b.lineItems.filter((l) => l.removedAt === null);
    if (active.some((l) => l.serviceId === service.id))
      throw fieldError("serviceId", "This service is already on the booking.");
    if (active.length >= 10)
      throw fieldError("serviceId", "A visit has at most 10 services.");
    if (service.type === "ADD_ON") {
      const bases = active
        .filter((l) => l.type === "BASE")
        .map((l) => l.serviceId);
      const ok = release.compatibility.some(
        (c) =>
          c.addOnServiceId === service.id &&
          bases.includes(c.baseServiceId) &&
          c.sizeCodes.includes(b.vehicleSizeCodeSnapshot!),
      );
      if (!ok)
        throw fieldError(
          "serviceId",
          "This add-on doesn't go with the services on this booking.",
        );
    }
    const order = Math.max(...b.lineItems.map((l) => l.order)) + 1;
    if (order > 29)
      throw fieldError("serviceId", "This booking can't take more services.");
    const reference =
      offer.state === "OFFERED"
        ? offer.unitPriceCentavos
        : service.referenceUnitPriceCentavos;
    await bump(tx, bookingId, v.expectedRevision);
    const line = await tx.bookingLineItem.create({
      data: {
        bookingId,
        order,
        releaseId: release.releaseId,
        serviceId: service.id,
        vehicleCategoryId: b.vehicleCategoryId,
        offerId: offer.id,
        type: service.type,
        nameSnapshot: service.name,
        unit: service.unit,
        quantity: v.quantity,
        lineVersion: "QUEUE_V3",
        addedByStaffId: actor.staffId,
        ...(booking === "PRICED"
          ? {
              priceStatus: "PRICED",
              unitPriceCentavos: offer.unitPriceCentavos,
              subtotalCentavos: offer.unitPriceCentavos! * v.quantity,
            }
          : {
              priceStatus: "FOR_QUOTE",
              referenceUnitPriceCentavos: reference,
              referenceSubtotalCentavos:
                reference === null ? null : reference * v.quantity,
            }),
      },
    });
    await audit(tx, actor, {
      action: "LINE_ADDED",
      bookingId,
      lineId: line.id,
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
    });
    logWrite(actor, "line_added", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

async function activeLine(
  tx: StaffTx,
  bookingId: string,
  lineId: string,
  lines: { id: string; removedAt: Date | null }[],
) {
  const line = lines.find((l) => l.id === lineId);
  if (!line) throw new AdminServiceError("NOT_FOUND");
  if (line.removedAt !== null)
    await conflict(
      tx,
      "BOOKING_NOT_MANAGEABLE",
      bookingId,
      "That service was removed.",
    );
  return line;
}

// W6: soft removal (A4). At least one base stays, and no add-on loses its only base.
export async function removeLine(
  actor: StaffActor,
  id: unknown,
  lineId: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "LINE_REMOVE");
  const bookingId = parse(AdminIdSchema, id);
  const lid = parse(AdminIdSchema, lineId);
  const v = parse(RemoveLineSchema, input);
  return mutate(options, "line_remove", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, {
      v3: true,
    });
    if (!OPEN.includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    await activeLine(tx, bookingId, lid, b.lineItems);
    const remaining = b.lineItems.filter(
      (l) => l.removedAt === null && l.id !== lid,
    );
    const bases = remaining
      .filter((l) => l.type === "BASE")
      .map((l) => l.serviceId);
    if (bases.length === 0)
      throw fieldError(
        "lineId",
        "Keep at least one main service on the booking.",
      );
    const release = await loadCurrentRelease(tx);
    const orphan =
      release &&
      remaining.some(
        (l) =>
          l.type === "ADD_ON" &&
          !release.compatibility.some(
            (c) =>
              c.addOnServiceId === l.serviceId &&
              bases.includes(c.baseServiceId) &&
              c.sizeCodes.includes(b.vehicleSizeCodeSnapshot!),
          ),
      );
    if (orphan)
      throw fieldError(
        "lineId",
        "Remove the add-ons that depend on this service first.",
      );
    await bump(tx, bookingId, v.expectedRevision);
    await tx.bookingLineItem.update({
      where: { id: lid },
      data: { removedAt: new Date(), removedByStaffId: actor.staffId },
    });
    await audit(tx, actor, {
      action: "LINE_REMOVED",
      bookingId,
      lineId: lid,
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
      reason: v.reason ?? null,
    });
    logWrite(actor, "line_removed", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// W7: per-service status (STAFF). The first service in progress starts the booking (§16, R1).
export async function setLineStatus(
  actor: StaffActor,
  id: unknown,
  lineId: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "LINE_STATUS");
  const bookingId = parse(AdminIdSchema, id);
  const lid = parse(AdminIdSchema, lineId);
  const v = parse(LineStatusSchema, input);
  return mutate(options, "line_status", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, {
      v3: true,
    });
    if (!OPEN.includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    await activeLine(tx, bookingId, lid, b.lineItems);
    // Putting a service back to WAITING stays allowed early, so staff can undo early work.
    if (v.workStatus !== "WAITING")
      await refuseBeforeDay(tx, bookingId, b.bookingDate, options);
    const line = b.lineItems.find((l) => l.id === lid)!;
    if (line.workStatus === v.workStatus) return result(tx, bookingId, true);
    const starts =
      v.workStatus !== "WAITING" &&
      (b.status === "PENDING" || b.status === "CONFIRMED");
    await bump(
      tx,
      bookingId,
      v.expectedRevision,
      starts ? { status: "IN_PROGRESS" } : {},
    );
    await tx.bookingLineItem.update({
      where: { id: lid },
      data: { workStatus: v.workStatus, workStatusChangedAt: new Date() },
    });
    const revs = {
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
    };
    await audit(tx, actor, {
      action: "LINE_STATUS_CHANGED",
      bookingId,
      lineId: lid,
      fromLineStatus: line.workStatus,
      toLineStatus: v.workStatus,
      ...revs,
    });
    if (starts)
      await audit(tx, actor, {
        action: "STATUS_CHANGED",
        bookingId,
        fromStatus: b.status,
        toStatus: "IN_PROGRESS",
        ...revs,
      });
    logWrite(actor, "line_status_changed", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// W8: ADMIN confirms or sets a line's final price (A1/A4); the audit keeps the previous value.
export async function setLinePrice(
  actor: StaffActor,
  id: unknown,
  lineId: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "LINE_PRICE");
  const bookingId = parse(AdminIdSchema, id);
  const lid = parse(AdminIdSchema, lineId);
  const v = parse(LinePriceSchema, input);
  return mutate(options, "line_price", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, {
      v3: true,
    });
    // A completed booking is final, price included (LE 2026-11-06, P1-37 review F1): the commission was counted on it. A late
    // amount is recorded as a commission adjustment instead, and the database refuses a price change on a completed booking too.
    if (b.status === "CANCELLED" || b.status === "COMPLETED")
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    await activeLine(tx, bookingId, lid, b.lineItems);
    const line = b.lineItems.find((l) => l.id === lid)!;
    if (line.staffPriceCentavos === v.priceCentavos)
      return result(tx, bookingId, true);
    await bump(tx, bookingId, v.expectedRevision);
    await tx.bookingLineItem.update({
      where: { id: lid },
      data: {
        staffPriceCentavos: v.priceCentavos,
        staffPriceSetAt: new Date(),
        staffPriceSetByStaffId: actor.staffId,
      },
    });
    await audit(tx, actor, {
      action: "PRICE_SET",
      bookingId,
      lineId: lid,
      previousPriceCentavos: line.staffPriceCentavos,
      newPriceCentavos: v.priceCentavos,
      reason: v.reason,
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
    });
    logWrite(actor, "price_set", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// W9: ADMIN-only persistent occupancy (LE 2026-10-20, Amendment 4).
export async function setBay(
  actor: StaffActor,
  id: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "BAY_ASSIGN");
  const bookingId = parse(AdminIdSchema, id),
    v = parse(BayAssignSchema, input);
  return mutate(options, "bay", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, {
      v3: true,
      dates: [v.date],
    });
    if (!OPEN.includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    const first = isoDay(b.bookingDate);
    if (v.date < first)
      throw fieldError(
        "date",
        "Assign a bay on the booked day or a later day of the job.",
      );
    // Return to Waiting (bayId null) stays allowed on any day, so an early seat can be undone.
    if (v.bayId) {
      await refuseBeforeDay(tx, bookingId, b.bookingDate, options);
      if (v.date > today(options))
        throw fieldError(
          "date",
          "A car can go into a bay on today's board only.",
        );
    }
    const current = await tx.bayOccupancy.findUnique({ where: { bookingId } });
    if ((current?.bayId ?? null) === v.bayId)
      return result(tx, bookingId, true);
    if (v.bayId) {
      const bay = await tx.bay.findUnique({ where: { id: v.bayId } });
      if (!bay || !bay.isActive)
        throw fieldError("bayId", "Choose an active bay.");
      // P1-62 (LE 2026-11-07): any car can go in any empty active bay. The old rule that the bay's type must take the car's queue is gone
      // (the board only asks a question that never blocks); capacity stays per queue and is not touched by where a car sits.
      if (await tx.bayOccupancy.findUnique({ where: { bayId: v.bayId } }))
        return conflict(
          tx,
          "SCHEDULE_CONFLICT",
          bookingId,
          "This bay is busy. Return its car to Waiting or complete it first.",
        );
    }
    await bump(tx, bookingId, v.expectedRevision);
    await releaseOccupancy(tx, actor, bookingId, v.expectedRevision);
    const key = { bookingId_date: { bookingId, date: dateCarrier(v.date) } };
    if (v.bayId) {
      const row = {
        bookingId,
        date: dateCarrier(v.date),
        bayId: v.bayId,
        assignedByStaffId: actor.staffId,
      };
      await tx.bayOccupancy.create({ data: row });
      await tx.bookingBayAssignment.upsert({
        where: key,
        create: { ...row, assignedAt: new Date() },
        update: {
          bayId: v.bayId,
          assignedAt: new Date(),
          assignedByStaffId: actor.staffId,
        },
      });
      await audit(tx, actor, {
        action: "BAY_ASSIGNED",
        bookingId,
        bayId: v.bayId,
        toDate: dateCarrier(v.date),
        fromRevision: v.expectedRevision,
        toRevision: v.expectedRevision + 1,
      });
    } else {
      // Preserve prior days; the current-day list follows its original unassignment contract.
      await tx.bookingBayAssignment.deleteMany({
        where: { bookingId, date: dateCarrier(v.date) },
      });
    }
    logWrite(actor, "bay_changed", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// W15: "your turn is coming" (§18; D6). P1-31 (LE 2026-10-30): the rate limit counts only emails that
// were really sent, so a failed send never locks staff out. The check is read-only in the first
// transaction, the email goes out holding no permit or lock, and the CUSTOMER_NOTIFIED audit row is
// written in a second transaction only after a successful send (the audit table is append-only, so a
// row written before the send could never be taken back).
// Accepted trade-offs: (1) two clicks at once are stopped by the in-process set below, which assumes one
// server process (Railway runs one instance); several instances could each send once. (2) If the
// process dies between a successful send and the audit write, no row exists and the next click can
// send again. The set is released in a finally, so an error can never lock a booking out.
const notifying = new Set<string>();
export async function notifyCustomer(
  actor: StaffActor,
  id: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminNotifyResult> {
  authorize(actor, "NOTIFY");
  const bookingId = parse(AdminIdSchema, id);
  const v = parse(NotifySchema, input);
  if (notifying.has(bookingId))
    throw new AdminServiceError("RATE_LIMITED", "An email for this booking is already being sent. Try again in a moment.", { retryAfterSeconds: 10 });
  notifying.add(bookingId);
  try {
    return await notifyOnce(actor, bookingId, v, options);
  } finally {
    notifying.delete(bookingId);
  }
}
async function notifyOnce(
  actor: StaffActor,
  bookingId: string,
  v: { expectedRevision: number; type?: "turn" | "reminder" | "confirmation" },
  options: AdminOptions,
): Promise<AdminNotifyResult> {
  const outcome = await mutate(options, "notify", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision);
    if (!OPEN.includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    if (!b.customerEmail)
      return { booking: await detailOrThrow(tx, bookingId), send: false };
    const [w] = await tx.$queryRawUnsafe<
      { recent: bigint; day: bigint; wait: number | null }[]
    >(
      `SELECT count(*) FILTER (WHERE "createdAt" > now() - interval '30 minutes') AS recent, count(*) FILTER (WHERE "createdAt" > now() - interval '1 day') AS day,
        EXTRACT(EPOCH FROM (max("createdAt") + interval '30 minutes' - now()))::float8 AS wait
       FROM booking_audit_events WHERE action = 'CUSTOMER_NOTIFIED' AND "bookingId" = $1`,
      bookingId,
    );
    if (Number(w.recent) >= 1 || Number(w.day) >= 3) {
      throw new AdminServiceError(
        "RATE_LIMITED",
        "This customer was notified recently. Try again later.",
        { retryAfterSeconds: Math.max(60, Math.ceil(Number(w.wait ?? 1800))) },
      );
    }
    return { booking: await detailOrThrow(tx, bookingId), send: true };
  });
  if (!outcome.send)
    return { booking: outcome.booking, noChange: true, notice: "NO_EMAIL" };
  let notice: "SENT" | "NOT_SENT" = "NOT_SENT";
  try {
    notice = await (options.sender ?? unavailableSender).send(bookingId, v.type ?? "turn");
  } catch {
    notice = "NOT_SENT";
  }
  if (notice === "SENT") {
    try {
      const reason = v.type === "reminder"
        ? "APPOINTMENT_REMINDER_MANUAL"
        : v.type === "confirmation"
          ? "BOOKING_CONFIRMATION_MANUAL"
          : undefined;
      await mutate(options, "notify_record", (tx) =>
        audit(tx, actor, { action: "CUSTOMER_NOTIFIED", bookingId, reason }),
      );
    } catch {
      // The email already went out: say so. Without the row the limit cannot see it (logged, no detail).
      adminEvent("admin.booking.notified_unrecorded", { bookingId, actorStaffId: actor.staffId });
    }
  }
  adminEvent("admin.booking.notified", {
    bookingId,
    actorStaffId: actor.staffId,
    notice,
  });
  return { booking: outcome.booking, noChange: true, notice };
}

// P1-34 (LE 2026-10-31): drop a car on Done. Every active service is marked done and the booking is
// completed in ONE transaction under the shop lock, with ONE revision bump (the database wants a single
// bump with audit rows that match it, so setLineStatus and setBookingStatus cannot be composed). ADMIN
// only. The lines change before the booking row because a completed booking refuses line changes.
// Who may finish is decided in one place: canFinish.
const canFinish = (status: BookingStatus, onBay: boolean) =>
  status === "IN_PROGRESS" || (OPEN.includes(status) && onBay);
export async function finishBooking(
  actor: StaffActor,
  id: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "FINISH_BOOKING");
  const bookingId = parse(AdminIdSchema, id);
  const v = parse(FinishBookingSchema, input);
  return mutate(options, "finish", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, { v3: true });
    if (!OPEN.includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId, "This booking is already finished or cancelled.");
    const onBay = (await tx.bayOccupancy.count({ where: { bookingId } })) > 0;
    if (!canFinish(b.status, onBay))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId, "Move this car into a bay before finishing it.");
    await refuseBeforeDay(tx, bookingId, b.bookingDate, options);
    const active = b.lineItems.filter((l) => l.removedAt === null);
    if (!active.length)
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId, "Add a service before finishing this booking.");
    const revs = { fromRevision: v.expectedRevision, toRevision: v.expectedRevision + 1 };
    for (const line of active.filter((l) => l.workStatus !== "DONE")) {
      await tx.bookingLineItem.update({ where: { id: line.id }, data: { workStatus: "DONE", workStatusChangedAt: new Date() } });
      await audit(tx, actor, { action: "LINE_STATUS_CHANGED", bookingId, lineId: line.id, fromLineStatus: line.workStatus, toLineStatus: "DONE", ...revs });
    }
    await bump(tx, bookingId, v.expectedRevision, { status: "COMPLETED", terminalAt: new Date() });
    await audit(tx, actor, { action: "STATUS_CHANGED", bookingId, fromStatus: b.status, toStatus: "COMPLETED", ...revs });
    await releaseOccupancy(tx, actor, bookingId, v.expectedRevision);
    logWrite(actor, "booking_finished", bookingId, v.expectedRevision + 1);
    return result(tx, bookingId, false);
  });
}

// P1-41b: update booking details (customer name, phone, email, vehicle model, plate, notes)
export async function updateBookingDetails(
  actor: StaffActor,
  bookingId: string,
  rawInput: unknown,
  options: AdminOptions = {},
): Promise<AdminWriteResult> {
  authorize(actor, "STATUS_CONFIRMED"); // ADMIN only
  const id = parse(AdminIdSchema, bookingId);
  const input = parse(BookingDetailsUpdateSchema, rawInput);

  return mutate(options, "edit_details", async (tx) => {
    try {
      await tx.$executeRawUnsafe(
        "SELECT admin_booking_update_details($1, $2, $3, $4, $5, $6, $7, $8, $9::integer)",
        actor.staffId,
        id,
        input.customerName,
        input.customerPhone,
        input.customerEmail ?? "",
        input.vehicleModel,
        input.vehiclePlate ?? "",
        input.notes ?? "",
        input.expectedRevision,
      );
      return result(tx, id, false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("ZT001")) throw new AdminServiceError("NOT_FOUND", "Booking not found.");
      if (msg.includes("ZT002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed this booking. Refresh and try again.");
      if (msg.includes("ZT006")) throw new AdminServiceError("VALIDATION_ERROR");
      throw error;
    }
  });
}

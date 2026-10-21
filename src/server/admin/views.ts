import "server-only";
import { Prisma } from "@prisma/client";
import type {
  AdminAuditEntry,
  AdminBookingDetail,
  AdminLine,
  AdminQueueBooking,
} from "@/types/admin-contracts";
import type { StaffTx } from "@/server/auth/db-admission";
import { bookingTotals, effectivePrice } from "./totals";
import { isoDay } from "./context";

// Projections for staff only (customers never receive any of this). Phone and email are in the
// detail view only (T-019 detail).
export const bookingInclude = {
  occupancy: { include: { bay: { select: { id: true, name: true } } } },
  workerAssignments: {
    include: { staff: { select: { id: true, name: true, isActive: true } } },
    orderBy: { staffId: "asc" },
  },
  lineItems: { orderBy: { order: "asc" } },
  bayAssignments: {
    include: { bay: { select: { id: true, name: true } } },
    orderBy: { date: "asc" },
  },
} satisfies Prisma.BookingInclude;
export type BookingRow = Prisma.BookingGetPayload<{
  include: typeof bookingInclude;
}>;

const isV3 = (b: { snapshotVersion: string }) =>
  b.snapshotVersion === "QUEUE_V3";

export function toLine(l: BookingRow["lineItems"][number]): AdminLine {
  const removed = l.removedAt !== null;
  const line = {
    priceStatus: l.priceStatus,
    subtotalCentavos: l.subtotalCentavos,
    referenceSubtotalCentavos: l.referenceSubtotalCentavos,
    staffPriceCentavos: l.staffPriceCentavos,
    removed,
  };
  return {
    id: l.id,
    order: l.order,
    serviceId: l.serviceId,
    name: l.nameSnapshot,
    kind: l.type,
    unit: l.unit,
    quantity: l.quantity,
    priceStatus: l.priceStatus,
    unitPriceCentavos: l.unitPriceCentavos,
    subtotalCentavos: l.subtotalCentavos,
    referenceSubtotalCentavos: l.referenceSubtotalCentavos,
    staffPriceCentavos: l.staffPriceCentavos,
    effectivePriceCentavos: effectivePrice(line),
    workStatus: l.workStatus,
    removed,
  };
}

export function toQueueBooking(
  b: Omit<BookingRow, "occupancy" | "workerAssignments">,
): AdminQueueBooking {
  const day = isoDay(b.bookingDate);
  const bay = b.bayAssignments.find((a) => isoDay(a.date) === day)?.bay ?? null;
  const lines = b.lineItems.map(toLine);
  const legacyReceipt = isV3(b)
    ? null
    : Number(b.priceSnapshot.mul(100).toFixed(0));
  return {
    id: b.id,
    referenceCode: b.referenceCode,
    snapshot: isV3(b) ? "QUEUE_V3" : "LEGACY",
    status: b.status,
    revision: b.revision,
    bookingDate: day,
    queueCode: b.queueCode,
    queuePosition: b.queuePosition,
    customerName: b.customerName,
    vehicleModel: b.vehicleModel,
    vehiclePlate: b.vehiclePlate,
    sizeCode: b.vehicleSizeCodeSnapshot,
    serviceName: b.serviceNameSnapshot,
    bay: bay && { id: bay.id, name: bay.name },
    lines,
    totals:
      lines.length || isV3(b)
        ? bookingTotals(
            lines.map((l) => ({ ...l })),
            {
              receiptTotalCentavos: b.receiptTotalCentavos ?? legacyReceipt,
              receiptEstimatedCentavos:
                b.receiptEstimatedCentavos ?? legacyReceipt,
            },
          )
        : {
            receiptTotalCentavos: legacyReceipt,
            receiptEstimatedCentavos: legacyReceipt,
            currentTotalCentavos: legacyReceipt ?? 0,
            currentEstimateCentavos: legacyReceipt,
            forQuoteCount: 0,
          },
  };
}

const AUDIT_DETAIL_FIELDS = [
  "fromStatus",
  "toStatus",
  "fromDate",
  "toDate",
  "fromQueueCode",
  "toQueueCode",
  "fromPosition",
  "toPosition",
  "fromLineStatus",
  "toLineStatus",
  "previousPriceCentavos",
  "newPriceCentavos",
  "bayId",
  "queueCode",
  "capDate",
  "previousCap",
  "newCap",
  "targetStaffId",
  "previousBayType",
  "newBayType",
] as const;

export async function loadDetail(
  tx: StaffTx,
  id: string,
): Promise<AdminBookingDetail | null> {
  const b = await tx.booking.findUnique({
    where: { id },
    include: bookingInclude,
  });
  if (!b) return null;
  const audit = await tx.bookingAuditEvent.findMany({
    where: { bookingId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    include: { actor: { select: { name: true } } },
  });
  const history: AdminAuditEntry[] = audit.map((a) => ({
    id: a.id,
    source: "STAFF",
    action: a.action,
    actorStaffId: a.actorStaffId,
    actorName: a.actor.name,
    createdAt: a.createdAt.toISOString(),
    fromRevision: a.fromRevision,
    toRevision: a.toRevision,
    lineId: a.lineId,
    reason: a.reason,
    details: Object.fromEntries(
      AUDIT_DETAIL_FIELDS.filter((f) => a[f] !== null).map((f) => {
        const value = a[f];
        return [
          f,
          value instanceof Date ? isoDay(value) : (value as string | number),
        ];
      }),
    ),
  }));
  // Only immutable, committed effects belong in staff history. Never project receipt hashes,
  // recovery authority, client identifiers, rejection payloads or customer contact data.
  const operations = await tx.bookingOperation.findMany({
    where: {
      bookingId: id,
      kind: { in: ["CANCEL", "RESCHEDULE"] },
      outcome: "COMMITTED",
      noChange: false,
      committedAt: { not: null },
    },
    orderBy: [{ committedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      kind: true,
      committedAt: true,
      resultingRevision: true,
    },
  });
  history.push(
    ...operations.map((op): AdminAuditEntry => ({
      id: op.id,
      source: "CUSTOMER",
      action:
        op.kind === "CANCEL" ? "CUSTOMER_CANCELLED" : "CUSTOMER_RESCHEDULED",
      actorStaffId: null,
      actorName: null,
      createdAt: op.committedAt!.toISOString(),
      fromRevision:
        op.resultingRevision === null ? null : op.resultingRevision - 1,
      toRevision: op.resultingRevision,
      lineId: null,
      reason: null,
      details: {},
    })),
  );
  history.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  return {
    ...toQueueBooking(b),
    assignedWorkers: b.workerAssignments.map((a) => ({
      staffId: a.staff.id,
      name: a.staff.name,
      isActive: a.staff.isActive,
    })),
    occupancy: b.occupancy
      ? { date: isoDay(b.occupancy.date), bay: b.occupancy.bay }
      : null,
    customerPhone: b.customerPhone,
    customerEmail: b.customerEmail,
    notes: b.notes,
    cancellationKind: b.cancellationKind,
    bays: b.bayAssignments.map((a) => ({
      date: isoDay(a.date),
      bay: { id: a.bay.id, name: a.bay.name },
    })),
    createdAt: b.createdAt.toISOString(),
    history: history.slice(0, 50),
  };
}

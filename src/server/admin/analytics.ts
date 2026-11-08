import "server-only";
import { Prisma } from "@prisma/client";
import { AnalyticsQuerySchema } from "@/lib/admin-validation";
import { withStaffDb } from "@/server/auth/db-admission";
import type { AdminAnalytics } from "@/types/admin-contracts";
import type { BookingStatus } from "@/types/contracts";
import { summarizeSales, stockSummary, type AnalyticsLineRow } from "./analytics-model";
import { listCommissions } from "./commissions";
import { authorize, dateCarrier, dayEnd, dayStart, isoDay, manilaDate, parse, type AdminOptions, type StaffActor } from "./context";
import { listSupplies } from "./supplies";

type LineRow = Omit<AnalyticsLineRow, "finishedOn"> & { finishedOn: Date };

const NO_BOOKINGS: Record<BookingStatus, number> = { PENDING: 0, CONFIRMED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 };

// P1-40 Sales & Analytics: read-only, ADMIN only. Revenue is the prices of the jobs finished in the range, by their finish day in Manila.
// One statement holds every finished line, so the hero, the buckets, the groups and the queues share one snapshot (reads run at Read Committed).
export async function getAnalytics(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminAnalytics> {
  authorize(actor, "ANALYTICS_READ");
  const { from, to } = parse(AnalyticsQuerySchema, input);
  const today = manilaDate(options.now?.() ?? new Date());
  const { sales, bookingsByStatus, notCounted } = await withStaffDb("STAFF_READ", async (tx) => {
    // shortcut: no index on terminalAt, a sequential scan bounded to a year of one shop's bookings; add a partial index on terminalAt WHERE status='COMPLETED' if this slows down.
    const rows = await tx.$queryRaw<LineRow[]>(Prisma.sql`
      SELECT b.id AS "bookingId", b."referenceCode" AS reference, (b."terminalAt" AT TIME ZONE 'Asia/Manila')::date AS "finishedOn",
        l."priceStatus"::text AS "priceStatus", l."subtotalCentavos", l."staffPriceCentavos", l."referenceSubtotalCentavos",
        v."group"::text AS "groupCode", COALESCE(v."queueCode", b."queueCode") AS "queueCode", q.name AS "queueName", l."serviceId", l."nameSnapshot" AS name
      FROM bookings b
      JOIN booking_line_items l ON l."bookingId" = b.id AND l."removedAt" IS NULL
      JOIN catalog_service_versions v ON v."releaseId" = l."releaseId" AND v."serviceId" = l."serviceId"
      LEFT JOIN booking_queues q ON q.code = COALESCE(v."queueCode", b."queueCode")
      WHERE b.status = 'COMPLETED' AND b."snapshotVersion" = 'QUEUE_V3' AND b."terminalAt" >= ${dayStart(from)} AND b."terminalAt" < ${dayEnd(to)}
      ORDER BY b."terminalAt", b.id, l."order"`);
    const statuses = await tx.booking.groupBy({ by: ["status"], where: { bookingDate: { gte: dateCarrier(from), lte: dateCarrier(to) } }, _count: { _all: true } });
    const deletedFinished = await tx.bookingAuditEvent.count({ where: { action: "BOOKING_DELETED", fromStatus: "COMPLETED", fromDate: { gte: dateCarrier(from), lte: dateCarrier(to) } } });
    const olderFinished = await tx.booking.count({ where: { status: "COMPLETED", snapshotVersion: { not: "QUEUE_V3" } } });
    return {
      sales: summarizeSales(rows.map((r) => ({ ...r, finishedOn: isoDay(r.finishedOn) })), { from, to, today }),
      bookingsByStatus: statuses.reduce((all, s) => ({ ...all, [s.status]: s._count._all }), NO_BOOKINGS),
      notCounted: { deletedFinished, olderFinished },
    };
  }, { access: "read", db: options.db, signal: options.signal });

  // The same reads as the Team and Supplies screens, one after the other, so these figures cannot differ from them.
  const team = await listCommissions(actor, { from, to }, options);
  const supplies = await listSupplies(actor, {}, options);
  return {
    ...sales,
    from,
    to,
    today,
    bookingsByStatus,
    notCounted,
    commissions: {
      startsAt: team.settings.startsAt,
      earnedCentavos: team.grandTotal.earnedCentavos,
      unpaidCentavos: team.grandTotal.unpaidCentavos,
      nobodyCredited: team.warnings.nobodyCredited,
      missingRecords: team.warnings.missingRecords,
    },
    stock: { ...stockSummary(supplies.items), lowOrOutCount: supplies.lowOrOutCount },
  };
}

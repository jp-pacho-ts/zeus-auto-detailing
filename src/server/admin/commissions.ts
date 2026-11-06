import "server-only";
import { Prisma } from "@prisma/client";
import type {
  AdminCommissionAdjustment,
  AdminCommissionEntry,
  AdminCommissionLine,
  AdminCommissionPaidResult,
  AdminCommissionPersonTotal,
  AdminCommissionSettings,
  AdminCommissionSummary,
} from "@/types/admin-contracts";
import { CommissionAdjustSchema, CommissionDefaultSchema, CommissionListSchema, CommissionPaidSchema } from "@/lib/admin-validation";
import { percentToBasisPoints, safeCentavos } from "@/lib/commission";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import { adminEvent } from "./log";
import { mutate } from "./mutation";

// P1-37: commissions. ADMIN only (money). The records are written by the accrual trigger when a booking completes;
// nothing here can create, change or delete an amount. The writes this file makes are owner-run functions: the default
// percentage, mark paid or unpaid, and repair. All figures are stored centavos summed by SQL, never by the browser.
// Customer names, phones, emails and vehicles are never selected: an entry shows the booking reference, the service
// name and the day.

const ENTRY_LIMIT = 500;
// A function declaration, not a generic arrow: the test loader parses .ts files with JSX on.
function read<T>(options: AdminOptions, work: (tx: StaffTx) => Promise<T>): Promise<T> {
  return withStaffDb("STAFF_READ", work, { access: "read", db: options.db, signal: options.signal });
}

function mapError(error: unknown): never {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("ZT001")) throw new AdminServiceError("NOT_FOUND");
  if (text.includes("ZT002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed this. Reload and try again.");
  if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
  if (text.includes("ZT006")) throw new AdminServiceError("VALIDATION_ERROR");
  if (text.includes("ZC006")) throw new AdminServiceError("VALIDATION_ERROR", "That adjustment would take the commission below zero.");
  throw error;
}

interface SettingsRow { defaultRateBp: number; revision: number; startsAt: Date }
async function loadSettings(tx: StaffTx): Promise<AdminCommissionSettings> {
  const [row] = await tx.$queryRaw<SettingsRow[]>`SELECT "defaultRateBp", revision, "startsAt" FROM commission_settings WHERE id = 1`;
  if (!row) throw new AdminServiceError("INTERNAL_ERROR");
  return { defaultRateBp: Number(row.defaultRateBp), revision: Number(row.revision), startsAt: row.startsAt.toISOString() };
}

export async function getCommissionSettings(actor: StaffActor, options: AdminOptions = {}): Promise<AdminCommissionSettings> {
  authorize(actor, "COMMISSION_READ");
  return read(options, loadSettings);
}

export async function setDefaultRate(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminCommissionSettings> {
  authorize(actor, "COMMISSION_WRITE");
  const v = parse(CommissionDefaultSchema, input);
  const rate = percentToBasisPoints(v.ratePercent);
  if (rate === null) throw new AdminServiceError("VALIDATION_ERROR");
  return mutate(options, "commission_default", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_commission_default_set(${actor.staffId}, ${rate}::integer, ${v.expectedRevision}::integer) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapError(error); }
    adminEvent("admin.commission.default_set", { actorStaffId: actor.staffId, changed });
    return loadSettings(tx);
  });
}

interface EntryRow {
  id: string; bookingReference: string; serviceName: string; completedOn: Date; staffId: string; staffName: string; position: number;
  serviceTotalCentavos: bigint; shareCentavos: bigint; rateBp: number; amountCentavos: bigint; creditedCount: number; unpricedLineCount: number; paidAt: Date | null;
}
interface LineRow { bookingReference: string; name: string; counted: boolean; category: string; amount: number | null }
interface AdjustmentRow { id: string; entryId: string; amountCentavos: bigint; reason: string; createdAt: Date; paidAt: Date | null }
interface TotalRow { staffId: string; staffName: string; entryCount: number; earned: bigint; paid: bigint }

export async function listCommissions(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminCommissionSummary> {
  authorize(actor, "COMMISSION_READ");
  const v = parse(CommissionListSchema, input);
  return read(options, async (tx) => {
    const settings = await loadSettings(tx);
    const inRange = Prisma.sql`a."completedOn" BETWEEN ${v.from}::date AND ${v.to}::date`;
    const person = v.staffId ? Prisma.sql`AND e."staffId" = ${v.staffId}` : Prisma.empty;
    const status = v.status === "PAID" ? Prisma.sql`AND e."paidAt" IS NOT NULL` : v.status === "UNPAID" ? Prisma.sql`AND e."paidAt" IS NULL` : Prisma.empty;
    const entries = await tx.$queryRaw<EntryRow[]>`
      SELECT e.id, b."referenceCode" AS "bookingReference", b."serviceNameSnapshot" AS "serviceName", a."completedOn", e."staffId", s.name AS "staffName",
        e."position", a."serviceTotalCentavos", e."baseCentavos" AS "shareCentavos", e."rateBp", e."amountCentavos", a."creditedCount", a."unpricedLineCount", e."paidAt"
      FROM commission_entries e JOIN commission_accruals a ON a."bookingId" = e."bookingId" JOIN bookings b ON b.id = e."bookingId" JOIN staff s ON s.id = e."staffId"
      WHERE ${inRange} ${person} ${status}
      ORDER BY a."completedOn" DESC, b."referenceCode" DESC, e."position" ASC, e.id ASC
      LIMIT ${ENTRY_LIMIT + 1}`;
    // Totals cover every matching entry (the status filter does not apply: earned, paid and unpaid are always shown together).
    const totalRows = await tx.$queryRaw<TotalRow[]>`
      SELECT e."staffId", s.name AS "staffName", count(*)::integer AS "entryCount",
        (COALESCE(sum(e."amountCentavos"), 0) + COALESCE(sum(adj.total), 0))::bigint AS earned,
        (COALESCE(sum(e."amountCentavos") FILTER (WHERE e."paidAt" IS NOT NULL), 0) + COALESCE(sum(adj.paid), 0))::bigint AS paid
      FROM commission_entries e JOIN commission_accruals a ON a."bookingId" = e."bookingId" JOIN staff s ON s.id = e."staffId"
      LEFT JOIN LATERAL (SELECT sum(x."amountCentavos") AS total, sum(x."amountCentavos") FILTER (WHERE x."paidAt" IS NOT NULL) AS paid
        FROM commission_adjustments x WHERE x."entryId" = e.id) adj ON true
      WHERE ${inRange} ${person}
      GROUP BY e."staffId", s.name ORDER BY lower(s.name), e."staffId"`;
    const [warn] = await tx.$queryRaw<{ nobody: number; noCommission: number; unpriced: number; missing: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM commission_accruals a WHERE ${inRange} AND a."creditedCount" = 0 AND a."eligibleLineCount" > 0) AS nobody,
        (SELECT count(*)::integer FROM commission_accruals a WHERE ${inRange} AND a."eligibleLineCount" = 0) AS "noCommission",
        (SELECT count(*)::integer FROM commission_entries e JOIN commission_accruals a ON a."bookingId" = e."bookingId" WHERE ${inRange} ${person} AND a."unpricedLineCount" > 0) AS unpriced,
        (SELECT count(*)::integer FROM bookings bk WHERE bk.status = 'COMPLETED' AND bk."snapshotVersion" = 'QUEUE_V3' AND bk."terminalAt" >= ${new Date(settings.startsAt)}
          AND NOT EXISTS(SELECT 1 FROM commission_accruals x WHERE x."bookingId" = bk.id)) AS missing`;
    const totals: AdminCommissionPersonTotal[] = totalRows.map((r) => ({
      staffId: r.staffId, staffName: r.staffName, entryCount: Number(r.entryCount), earnedCentavos: safeCentavos(r.earned), paidCentavos: safeCentavos(r.paid), unpaidCentavos: safeCentavos(r.earned - r.paid),
    }));
    // Exact even for absurdly large sums: added as bigint, and refused if the result could not be shown exactly.
    const add = (x: number, y: number) => safeCentavos(BigInt(x) + BigInt(y));
    const grand = totals.reduce((g, t) => ({ entryCount: g.entryCount + t.entryCount, earnedCentavos: add(g.earnedCentavos, t.earnedCentavos), paidCentavos: add(g.paidCentavos, t.paidCentavos), unpaidCentavos: add(g.unpaidCentavos, t.unpaidCentavos) }),
      { entryCount: 0, earnedCentavos: 0, paidCentavos: 0, unpaidCentavos: 0 });
    const page = entries.slice(0, ENTRY_LIMIT);
    const adjustmentRows = page.length === 0 ? [] : await tx.$queryRaw<AdjustmentRow[]>`
      SELECT id, "entryId", "amountCentavos", reason, "createdAt", "paidAt" FROM commission_adjustments
      WHERE "entryId" = ANY(${page.map((r) => r.id)}::text[]) ORDER BY "createdAt", id`;
    // Which of each booking's services counted. The same function the accrual uses (commission_earns_on), so the words cannot drift
    // from the money. A completed booking's lines are final, so this matches what was counted at completion.
    const lineRows = page.length === 0 ? [] : await tx.$queryRaw<LineRow[]>`
      SELECT bk."referenceCode" AS "bookingReference", l."nameSnapshot" AS name, commission_earns_on(sv.category) AS counted, sv.category::text AS category,
        COALESCE(l."staffPriceCentavos", l."subtotalCentavos") AS amount
      FROM booking_line_items l JOIN services sv ON sv.id = l."serviceId" JOIN bookings bk ON bk.id = l."bookingId"
      WHERE bk."referenceCode" = ANY(${[...new Set(page.map((r) => r.bookingReference))]}::text[]) AND l."removedAt" IS NULL ORDER BY l."order", l.id`;
    const notCountedReason = (category: string) => (category === "EXTERIOR_WASH_SEAL" ? "Car wash does not earn commission." : "This service does not earn commission.");
    const linesOf = (reference: string): AdminCommissionLine[] => lineRows.filter((x) => x.bookingReference === reference).map((x) => ({
      name: x.name, counted: x.counted, notCountedReason: x.counted ? null : notCountedReason(x.category), amountCentavos: x.amount === null ? null : safeCentavos(x.amount),
    }));
    const adjustmentsOf = (entryId: string): AdminCommissionAdjustment[] => adjustmentRows.filter((x) => x.entryId === entryId).map((x) => ({
      id: x.id, amountCentavos: safeCentavos(x.amountCentavos), reason: x.reason, createdAt: x.createdAt.toISOString(), paidAt: x.paidAt ? x.paidAt.toISOString() : null,
    }));
    const shown: AdminCommissionEntry[] = page.map((r) => ({
      id: r.id, bookingReference: r.bookingReference, serviceName: r.serviceName, completedOn: r.completedOn.toISOString().slice(0, 10), staffId: r.staffId, staffName: r.staffName,
      position: Number(r.position), serviceTotalCentavos: safeCentavos(r.serviceTotalCentavos), shareCentavos: safeCentavos(r.shareCentavos), rateBp: Number(r.rateBp), amountCentavos: safeCentavos(r.amountCentavos),
      creditedCount: Number(r.creditedCount), unpricedLineCount: Number(r.unpricedLineCount), paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      adjustments: adjustmentsOf(r.id),
      lines: linesOf(r.bookingReference),
    }));
    return {
      from: v.from, to: v.to, settings, totals, grandTotal: grand, entries: shown, truncated: entries.length > ENTRY_LIMIT,
      warnings: { nobodyCredited: Number(warn.nobody), noCommissionBookings: Number(warn.noCommission), unpricedEntries: Number(warn.unpriced), missingRecords: Number(warn.missing) },
    };
  });
}

// Marks entries (or adjustments) paid or not paid. Unknown ids are counted, not errors; one already in the wanted state is left alone.
export async function setCommissionsPaid(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminCommissionPaidResult> {
  authorize(actor, "COMMISSION_WRITE");
  const v = parse(CommissionPaidSchema, input);
  return mutate(options, "commission_paid", async (tx) => {
    let result: AdminCommissionPaidResult;
    try {
      const [row] = await tx.$queryRaw<{ r: AdminCommissionPaidResult }[]>`SELECT admin_commission_paid_set(${actor.staffId}, ${v.ids}::text[], ${v.paid}) AS r`;
      result = { changed: Number(row.r.changed), unknown: Number(row.r.unknown) };
    } catch (error) { return mapError(error); }
    adminEvent(v.paid ? "admin.commission.paid" : "admin.commission.unpaid", { actorStaffId: actor.staffId, changed: result.changed, unknown: result.unknown });
    return result;
  });
}

// Redoes the records of completed bookings whose accrual failed (up to 200 per call). Idempotent. One bad booking does not
// stop the others: it is counted in "failed" and audited (review F2).
export async function repairCommissions(actor: StaffActor, options: AdminOptions = {}): Promise<{ repaired: number; failed: number }> {
  authorize(actor, "COMMISSION_WRITE");
  return mutate(options, "commission_repair", async (tx) => {
    let repaired: number;
    let failed: number;
    try {
      const [row] = await tx.$queryRaw<{ r: { repaired: number; failed: number } }[]>`SELECT admin_commission_repair(${actor.staffId}) AS r`;
      repaired = Number(row.r.repaired);
      failed = Number(row.r.failed);
    } catch (error) { return mapError(error); }
    adminEvent("admin.commission.repaired", { actorStaffId: actor.staffId, repaired, failed });
    return { repaired, failed };
  });
}

// Records a late correction to one person's commission (a price that arrived after completion, or a mistake): a signed
// whole-centavo amount with a reason, as a new row. The entry itself never changes. ADMIN only; the database repeats it.
export async function adjustCommission(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<{ id: string }> {
  authorize(actor, "COMMISSION_WRITE");
  const v = parse(CommissionAdjustSchema, input);
  return mutate(options, "commission_adjust", async (tx) => {
    let id: string;
    try {
      const [row] = await tx.$queryRaw<{ r: { id: string } }[]>`SELECT admin_commission_adjust(${actor.staffId}, ${v.id}, ${v.entryId}, ${BigInt(v.amountCentavos)}::bigint, ${v.reason}) AS r`;
      id = row.r.id;
    } catch (error) { return mapError(error); }
    adminEvent("admin.commission.adjusted", { actorStaffId: actor.staffId });
    return { id };
  });
}

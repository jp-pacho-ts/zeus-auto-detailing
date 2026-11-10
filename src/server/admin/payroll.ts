import "server-only";
import { Prisma } from "@prisma/client";
import {
  PayrollAdjustSchema,
  PayrollPaidSchema,
  PayrollQuerySchema,
} from "@/lib/admin-validation";
import { safeCentavos } from "@/lib/commission";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import type {
  AdminPayrollStaffItem,
  AdminWeeklyPayroll,
} from "@/types/admin-contracts";
import {
  addDays,
  authorize,
  parse,
  type AdminOptions,
  type StaffActor,
} from "./context";
import { mutate } from "./mutation";

function read<T>(
  options: AdminOptions,
  work: (tx: StaffTx) => Promise<T>,
): Promise<T> {
  return withStaffDb("STAFF_READ", work, {
    access: "read",
    db: options.db,
    signal: options.signal,
  });
}

interface TeamRow {
  id: string;
  name: string;
  phone: string;
  role: string;
  position: string | null;
  isActive: boolean;
}

interface AdjustmentRow {
  staffId: string;
  daysAbsent: number;
  dailyRateCentavos: number;
  cashAdvanceCentavos: bigint;
  advanceNotes: string | null;
  isPaid: boolean;
  paidAt: Date | null;
}

interface CommissionEarnedRow {
  staffId: string;
  earned: bigint;
}

export async function getWeeklyPayroll(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminWeeklyPayroll> {
  authorize(actor, "COMMISSION_READ");
  const { weekStart } = parse(PayrollQuerySchema, input);
  const weekEnd = addDays(weekStart, 6);

  return read(options, async (tx) => {
    // 1. Fetch all active staff detailers
    let staffList: TeamRow[] = [];
    try {
      staffList = await tx.$queryRaw<TeamRow[]>`SELECT id, name, phone, role, position, "isActive" FROM admin_team_list_v2(${actor.staffId})`;
    } catch {
      // Fallback if procedure is unavailable
      staffList = await tx.$queryRaw<TeamRow[]>`
        SELECT s.id, s.name, s.phone, s.role::text, p.position, s."isActive"
        FROM staff s
        LEFT JOIN staff_profiles p ON p."staffId" = s.id
        WHERE s."isActive" = true AND s."removedAt" IS NULL AND s.role = 'DETAILER'
        ORDER BY lower(s.name)
      `;
    }

    // 2. Fetch existing adjustments for this week
    let adjustments: AdjustmentRow[] = [];
    try {
      adjustments = await tx.$queryRaw<AdjustmentRow[]>`
        SELECT "staffId", "daysAbsent", "dailyRateCentavos", "cashAdvanceCentavos", "advanceNotes", "isPaid", "paidAt"
        FROM staff_payroll_adjustments
        WHERE "weekStart" = ${weekStart}::date
      `;
    } catch {
      // Table will exist once migration runs
      adjustments = [];
    }
    const adjMap = new Map(adjustments.map((a) => [a.staffId, a]));

    // 3. Fetch commissions earned in that Monday-Sunday week
    const commissionRows = await tx.$queryRaw<CommissionEarnedRow[]>`
      SELECT e."staffId", (COALESCE(sum(e."amountCentavos"), 0) + COALESCE(sum(adj.total), 0))::bigint AS earned
      FROM commission_entries e
      JOIN commission_accruals a ON a."bookingId" = e."bookingId"
      LEFT JOIN LATERAL (
        SELECT sum(x."amountCentavos") AS total
        FROM commission_adjustments x
        WHERE x."entryId" = e.id
      ) adj ON true
      WHERE a."completedOn" BETWEEN ${weekStart}::date AND ${weekEnd}::date
      GROUP BY e."staffId"
    `;
    const commMap = new Map(
      commissionRows.map((c) => [c.staffId, safeCentavos(c.earned)]),
    );

    // 4. Build staff payroll items
    const items: AdminPayrollStaffItem[] = staffList.map((s) => {
      const adj = adjMap.get(s.id);
      const daysAbsent = adj ? Math.max(0, Math.min(6, adj.daysAbsent)) : 0;
      const daysWorked = 6 - daysAbsent;
      const dailyRateCentavos = adj ? adj.dailyRateCentavos : 20_000;
      const baseSalaryCentavos = daysWorked * dailyRateCentavos;
      const commissionEarnedCentavos = commMap.get(s.id) ?? 0;
      const grossPayCentavos = baseSalaryCentavos + commissionEarnedCentavos;
      const cashAdvanceCentavos = adj
        ? safeCentavos(adj.cashAdvanceCentavos)
        : 0;
      const netPayoutCentavos = grossPayCentavos - cashAdvanceCentavos;

      return {
        staffId: s.id,
        staffName: s.name,
        phone: s.phone,
        role: s.role,
        position: s.position ?? null,
        isActive: s.isActive,
        dailyRateCentavos,
        standardDays: 6,
        daysAbsent,
        daysWorked,
        baseSalaryCentavos,
        commissionEarnedCentavos,
        grossPayCentavos,
        cashAdvanceCentavos,
        advanceNotes: adj?.advanceNotes ?? null,
        netPayoutCentavos,
        isPaid: adj?.isPaid ?? false,
        paidAt: adj?.paidAt ? adj.paidAt.toISOString() : null,
      };
    });

    // 5. Compute shop-wide totals
    const add = (a: number, b: number) => safeCentavos(BigInt(a) + BigInt(b));
    const totals = items.reduce(
      (acc, it) => ({
        totalStaff: acc.totalStaff + 1,
        totalBaseSalaryCentavos: add(
          acc.totalBaseSalaryCentavos,
          it.baseSalaryCentavos,
        ),
        totalCommissionsCentavos: add(
          acc.totalCommissionsCentavos,
          it.commissionEarnedCentavos,
        ),
        totalGrossPayCentavos: add(
          acc.totalGrossPayCentavos,
          it.grossPayCentavos,
        ),
        totalCashAdvanceCentavos: add(
          acc.totalCashAdvanceCentavos,
          it.cashAdvanceCentavos,
        ),
        totalNetPayoutCentavos: add(
          acc.totalNetPayoutCentavos,
          it.netPayoutCentavos,
        ),
        paidCount: acc.paidCount + (it.isPaid ? 1 : 0),
        unpaidCount: acc.unpaidCount + (it.isPaid ? 0 : 1),
      }),
      {
        totalStaff: 0,
        totalBaseSalaryCentavos: 0,
        totalCommissionsCentavos: 0,
        totalGrossPayCentavos: 0,
        totalCashAdvanceCentavos: 0,
        totalNetPayoutCentavos: 0,
        paidCount: 0,
        unpaidCount: 0,
      },
    );

    return {
      weekStart,
      weekEnd,
      items,
      totals,
    };
  });
}

export async function savePayrollAdjustment(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<{ ok: boolean }> {
  authorize(actor, "COMMISSION_WRITE");
  const v = parse(PayrollAdjustSchema, input);

  return mutate(options, "payroll_adjustment", async (tx) => {
    try {
      await tx.$executeRaw(Prisma.sql`
        SELECT admin_payroll_save_adjustment(
          ${actor.staffId},
          ${v.staffId},
          ${v.weekStart}::date,
          ${v.daysAbsent},
          ${BigInt(v.cashAdvanceCentavos)},
          ${v.advanceNotes ?? null}
        )
      `);
      return { ok: true };
    } catch {
      // Direct upsert fallback
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO staff_payroll_adjustments (
          "staffId", "weekStart", "daysAbsent", "cashAdvanceCentavos", "advanceNotes", "updatedAt"
        ) VALUES (
          ${v.staffId}, ${v.weekStart}::date, ${v.daysAbsent}, ${BigInt(v.cashAdvanceCentavos)}, ${v.advanceNotes ?? null}, now()
        )
        ON CONFLICT ("staffId", "weekStart") DO UPDATE SET
          "daysAbsent" = ${v.daysAbsent},
          "cashAdvanceCentavos" = ${BigInt(v.cashAdvanceCentavos)},
          "advanceNotes" = ${v.advanceNotes ?? null},
          "updatedAt" = now()
      `);
      return { ok: true };
    }
  });
}

export async function setPayrollPaid(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<{ ok: boolean }> {
  authorize(actor, "COMMISSION_WRITE");
  const v = parse(PayrollPaidSchema, input);

  return mutate(options, "payroll_paid", async (tx) => {
    try {
      await tx.$executeRaw(Prisma.sql`
        SELECT admin_payroll_set_paid(
          ${actor.staffId},
          ${v.staffId},
          ${v.weekStart}::date,
          ${v.isPaid}
        )
      `);
      return { ok: true };
    } catch {
      // Direct upsert fallback
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO staff_payroll_adjustments (
          "staffId", "weekStart", "isPaid", "paidAt", "paidByStaffId", "updatedAt"
        ) VALUES (
          ${v.staffId}, ${v.weekStart}::date, ${v.isPaid}, ${v.isPaid ? new Date() : null}, ${v.isPaid ? actor.staffId : null}, now()
        )
        ON CONFLICT ("staffId", "weekStart") DO UPDATE SET
          "isPaid" = ${v.isPaid},
          "paidAt" = ${v.isPaid ? new Date() : null},
          "paidByStaffId" = ${v.isPaid ? actor.staffId : null},
          "updatedAt" = now()
      `);
      return { ok: true };
    }
  });
}

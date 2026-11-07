import "server-only";
import { Prisma } from "@prisma/client";
import type { AdminExpense, AdminExpenseCategory, AdminExpenseEvent, AdminExpenseMonth } from "@/types/admin-contracts";
import { AdminIdSchema, ExpenseCategoryCreateSchema, ExpenseCategoryUpdateSchema, ExpenseCreateSchema, ExpenseMonthSchema, ExpenseRestoreSchema, ExpenseUpdateSchema, ExpenseVoidSchema } from "@/lib/admin-validation";
import { lastTwelveMonths, monthRange } from "@/lib/expenses";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, isoDay, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, fieldError } from "./errors";
import { totalsIn } from "./expenses-read";
import { adminEvent } from "./log";
import { mutate } from "./mutation";

// P1-39: Expenses. ADMIN only, enforced here and again inside every database function (admin_assert_actor). The app role can only read the tables:
// each write is an owner-run SECURITY DEFINER function that writes the row and its history in one transaction. The browser makes the ids, so a retry
// after a lost response returns the existing row. Payees, notes and amounts are never logged. Removing hides and never erases.

const PAGE = 50;
// A function declaration, not a generic arrow: the test loader parses .ts files with JSX on.
function read<T>(options: AdminOptions, work: (tx: StaffTx) => Promise<T>): Promise<T> {
  return withStaffDb("STAFF_READ", work, { access: "read", db: options.db, signal: options.signal });
}

function mapExpenseError(error: unknown): never {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("ZX001")) throw new AdminServiceError("NOT_FOUND");
  if (text.includes("ZX002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed this. Reload and try again.");
  if (text.includes("ZX006")) throw new AdminServiceError("VALIDATION_ERROR");
  if (text.includes("ZX007")) throw fieldError("name", "A category with that name already exists.");
  if (text.includes("ZX010")) throw fieldError("categoryId", "That category is hidden. Choose another or show it again.");
  if (text.includes("ZX011")) throw new AdminServiceError("NOT_ALLOWED", "This expense was removed. Restore it first.");
  if (text.includes("ZX012")) throw fieldError("date", "Use a date from 2020 up to today.");
  if (text.includes("ZX013")) throw fieldError("name", "That name is used by the automatic lines. Choose another.");
  if (text.includes("ZX014")) throw new AdminServiceError("NOT_ALLOWED", "At least one category must stay available.");
  if (text.includes("ZX015")) throw new AdminServiceError("NOT_ALLOWED", "The list is full (40 categories). Reuse or rename one.");
  if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
  throw error;
}

interface ExpenseRow { id: string; seq: bigint; expenseDate: Date; categoryId: string; categoryName: string; amountCentavos: bigint; payee: string | null; note: string | null; revision: number; voidedAt: Date | null; createdAt: Date }
const toExpense = (r: ExpenseRow): AdminExpense => ({
  id: r.id, expenseDate: isoDay(r.expenseDate), categoryId: r.categoryId, categoryName: r.categoryName, amountCentavos: Number(r.amountCentavos), payee: r.payee, note: r.note,
  revision: Number(r.revision), removed: r.voidedAt !== null, createdAt: r.createdAt.toISOString(),
});
async function expenseOrThrow(tx: StaffTx, id: string): Promise<AdminExpense> {
  const [r] = await tx.$queryRaw<ExpenseRow[]>`
    SELECT e.id, e.seq, e."expenseDate", e."categoryId", c.name AS "categoryName", e."amountCentavos", e.payee, e.note, e.revision, e."voidedAt", e."createdAt"
    FROM expenses e JOIN expense_categories c ON c.id = e."categoryId" WHERE e.id = ${id}`;
  if (!r) throw new AdminServiceError("NOT_FOUND");
  return toExpense(r);
}

const toCategory = (r: { id: string; name: string; sortOrder: number; isActive: boolean; revision: number }): AdminExpenseCategory => ({ id: r.id, name: r.name, sortOrder: r.sortOrder, isActive: r.isActive, revision: r.revision });
async function categoryOrThrow(tx: StaffTx, id: string): Promise<AdminExpenseCategory> {
  const r = await tx.expenseCategory.findUnique({ where: { id } });
  if (!r) throw new AdminServiceError("NOT_FOUND");
  return toCategory(r);
}

// The month's typed rows (newest first, 50 per page), the two derived lines, the totals and the last 12 months. Money over a safe integer is
// possible in a total, so totals are decimal strings here; one row is at most 10,000,000,000 centavos and stays a number.
export async function getExpenseMonth(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminExpenseMonth> {
  authorize(actor, "EXPENSE_READ");
  const v = parse(ExpenseMonthSchema, input);
  const { from, to } = monthRange(v.month);
  const months = lastTwelveMonths(v.month);
  const seriesFrom = monthRange(months[0]).from;
  return read(options, async (tx) => {
    const filters: Prisma.Sql[] = [Prisma.sql`e."expenseDate" BETWEEN ${from}::date AND ${to}::date`];
    if (!v.includeRemoved) filters.push(Prisma.sql`e."voidedAt" IS NULL`);
    if (v.categoryId) filters.push(Prisma.sql`e."categoryId" = ${v.categoryId}`);
    if (v.cursor) {
      const [day, seq] = v.cursor.split("_");
      filters.push(Prisma.sql`(e."expenseDate", e.seq) < (${day}::date, ${seq}::bigint)`);
    }
    const rows = await tx.$queryRaw<ExpenseRow[]>`
      SELECT e.id, e.seq, e."expenseDate", e."categoryId", c.name AS "categoryName", e."amountCentavos", e.payee, e.note, e.revision, e."voidedAt", e."createdAt"
      FROM expenses e JOIN expense_categories c ON c.id = e."categoryId"
      WHERE ${Prisma.join(filters, " AND ")}
      ORDER BY e."expenseDate" DESC, e.seq DESC LIMIT ${PAGE + 1}`;
    const page = rows.slice(0, PAGE);
    const t = await totalsIn(tx, from, to);
    const series = await tx.$queryRaw<{ month: string; kind: "manual" | "stock" | "commissions"; total: bigint }[]>`
      WITH r AS (SELECT (${seriesFrom}::date)::timestamp AT TIME ZONE 'Asia/Manila' AS a, (${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Manila' AS b),
      x AS (
        SELECT to_char(e."expenseDate", 'YYYY-MM') AS month, 'manual' AS kind, e."amountCentavos" AS amount FROM expenses e WHERE e."voidedAt" IS NULL AND e."expenseDate" BETWEEN ${seriesFrom}::date AND ${to}::date
        UNION ALL SELECT to_char(m."createdAt" AT TIME ZONE 'Asia/Manila', 'YYYY-MM'), 'stock', m.delta::bigint * m."unitCostCentavos"::bigint FROM supply_movements m, r WHERE m.kind = 'RECEIVE' AND m."unitCostCentavos" IS NOT NULL AND m."createdAt" >= r.a AND m."createdAt" < r.b
        UNION ALL SELECT to_char(c."paidAt" AT TIME ZONE 'Asia/Manila', 'YYYY-MM'), 'commissions', c."amountCentavos" FROM commission_entries c, r WHERE c."paidAt" >= r.a AND c."paidAt" < r.b
        UNION ALL SELECT to_char(d."paidAt" AT TIME ZONE 'Asia/Manila', 'YYYY-MM'), 'commissions', d."amountCentavos" FROM commission_adjustments d, r WHERE d."paidAt" >= r.a AND d."paidAt" < r.b)
      SELECT month, kind, sum(amount)::bigint AS total FROM x GROUP BY month, kind`;
    const amount = (month: string, kind: string) => series.find((s) => s.month === month && s.kind === kind)?.total ?? BigInt(0);
    return {
      month: v.month,
      expenses: page.map(toExpense),
      nextCursor: rows.length > PAGE ? `${isoDay(page[PAGE - 1].expenseDate)}_${page[PAGE - 1].seq}` : null,
      totals: { total: String(t.total), manual: String(t.manual), stockBought: String(t.stockBought), commissionsPaid: String(t.commissionsPaid), commissionsOwed: String(t.commissionsOwed) },
      byCategory: t.byCategory.map((c) => ({ categoryId: c.categoryId, name: c.name, total: String(c.total) })),
      pricedStockIns: t.pricedStockIns,
      unpricedStockIns: t.unpricedStockIns,
      series: months.map((month) => {
        const manual = amount(month, "manual"), stockBought = amount(month, "stock"), commissionsPaid = amount(month, "commissions");
        return { month, total: String(manual + stockBought + commissionsPaid), manual: String(manual), stockBought: String(stockBought), commissionsPaid: String(commissionsPaid) };
      }),
    };
  });
}

export async function addExpense(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminExpense> {
  authorize(actor, "EXPENSE_WRITE");
  const v = parse(ExpenseCreateSchema, input);
  return mutate(options, "expense_add", async (tx) => {
    let replayed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { replayed: boolean } }[]>`SELECT admin_expense_create(${actor.staffId}, ${v.id}, ${v.date}::date, ${v.categoryId}, ${BigInt(v.amountCentavos)}::bigint, ${v.payee ?? null}::text, ${v.note ?? null}::text) AS r`;
      replayed = row.r.replayed;
    } catch (error) { return mapExpenseError(error); }
    adminEvent("admin.expense.created", { actorStaffId: actor.staffId, targetExpenseId: v.id, replayed });
    return expenseOrThrow(tx, v.id);
  });
}

export async function updateExpense(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminExpense> {
  authorize(actor, "EXPENSE_WRITE");
  const expenseId = parse(AdminIdSchema, id), v = parse(ExpenseUpdateSchema, input);
  return mutate(options, "expense_update", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_expense_update(${actor.staffId}, ${expenseId}, ${v.expectedRevision}::integer, ${v.date}::date, ${v.categoryId}, ${BigInt(v.amountCentavos)}::bigint, ${v.payee ?? null}::text, ${v.note ?? null}::text) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapExpenseError(error); }
    adminEvent("admin.expense.updated", { actorStaffId: actor.staffId, targetExpenseId: expenseId, changed });
    return expenseOrThrow(tx, expenseId);
  });
}

export async function removeExpense(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminExpense> {
  authorize(actor, "EXPENSE_WRITE");
  const expenseId = parse(AdminIdSchema, id), v = parse(ExpenseVoidSchema, input);
  return mutate(options, "expense_remove", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_expense_void(${actor.staffId}, ${expenseId}, ${v.expectedRevision}::integer, ${v.reason ?? null}::text) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapExpenseError(error); }
    adminEvent("admin.expense.removed", { actorStaffId: actor.staffId, targetExpenseId: expenseId, changed });
    return expenseOrThrow(tx, expenseId);
  });
}

export async function restoreExpense(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminExpense> {
  authorize(actor, "EXPENSE_WRITE");
  const expenseId = parse(AdminIdSchema, id), v = parse(ExpenseRestoreSchema, input);
  return mutate(options, "expense_restore", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_expense_restore(${actor.staffId}, ${expenseId}, ${v.expectedRevision}::integer) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapExpenseError(error); }
    adminEvent("admin.expense.restored", { actorStaffId: actor.staffId, targetExpenseId: expenseId, changed });
    return expenseOrThrow(tx, expenseId);
  });
}

// shortcut: no paging, at most 200 rows; one expense does not change that often. Add a cursor if a row ever shows the limit.
export async function listExpenseHistory(actor: StaffActor, id: unknown, options: AdminOptions = {}): Promise<AdminExpenseEvent[]> {
  authorize(actor, "EXPENSE_READ");
  const expenseId = parse(AdminIdSchema, id);
  return read(options, async (tx) => {
    await expenseOrThrow(tx, expenseId);
    const rows = await tx.$queryRaw<{ seq: bigint; kind: AdminExpenseEvent["kind"]; revision: number; expenseDate: Date; categoryName: string; amountCentavos: bigint; payee: string | null; note: string | null; reason: string | null; actorName: string; createdAt: Date }[]>`
      SELECT h.seq, h.kind::text AS kind, h.revision, h."expenseDate", h."categoryName", h."amountCentavos", h.payee, h.note, h.reason, s.name AS "actorName", h."createdAt"
      FROM expense_events h JOIN staff s ON s.id = h."actorStaffId" WHERE h."expenseId" = ${expenseId} ORDER BY h.seq DESC LIMIT 200`;
    return rows.map((r) => ({
      seq: String(r.seq), kind: r.kind, revision: Number(r.revision), expenseDate: isoDay(r.expenseDate), categoryName: r.categoryName, amountCentavos: Number(r.amountCentavos),
      payee: r.payee, note: r.note, reason: r.reason, actorName: r.actorName, createdAt: r.createdAt.toISOString(),
    }));
  });
}

export async function listExpenseCategories(actor: StaffActor, options: AdminOptions = {}): Promise<AdminExpenseCategory[]> {
  authorize(actor, "EXPENSE_READ");
  return read(options, async (tx) => (await tx.expenseCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })).map(toCategory));
}

export async function addExpenseCategory(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminExpenseCategory> {
  authorize(actor, "EXPENSE_WRITE");
  const v = parse(ExpenseCategoryCreateSchema, input);
  return mutate(options, "expense_category_add", async (tx) => {
    let replayed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { replayed: boolean } }[]>`SELECT admin_category_create(${actor.staffId}, ${v.id}, ${v.name}) AS r`;
      replayed = row.r.replayed;
    } catch (error) { return mapExpenseError(error); }
    adminEvent("admin.expense_category.created", { actorStaffId: actor.staffId, targetCategoryId: v.id, replayed });
    return categoryOrThrow(tx, v.id);
  });
}

export async function updateExpenseCategory(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminExpenseCategory> {
  authorize(actor, "EXPENSE_WRITE");
  const categoryId = parse(AdminIdSchema, id), v = parse(ExpenseCategoryUpdateSchema, input);
  return mutate(options, "expense_category_update", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_category_update(${actor.staffId}, ${categoryId}, ${v.expectedRevision}::integer, ${v.name ?? null}::text, ${v.isActive ?? null}::boolean) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapExpenseError(error); }
    adminEvent("admin.expense_category.updated", { actorStaffId: actor.staffId, targetCategoryId: categoryId, changed });
    return categoryOrThrow(tx, categoryId);
  });
}

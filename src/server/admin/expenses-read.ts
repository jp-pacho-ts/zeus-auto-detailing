import "server-only";
import { ExpenseTotalsSchema } from "@/lib/admin-validation";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";

// P1-39: the one place that says what counts as an expense. P1-40 reads this function, never its own copy of the rules, so Sales & Analytics profit
// equals the Expenses page. Stock bought and commissions paid are read from where they live (no copied rows), so nothing can be counted twice.
// `from` and `to` are inclusive Manila days. The day of each kind: expenseDate; the Manila day of a movement's createdAt; the Manila day of paidAt.
export interface ExpenseTotals {
  /** manual + stockBought + commissionsPaid. commissionsOwed is NOT part of it. */
  total: bigint;
  manual: bigint;
  stockBought: bigint;
  commissionsPaid: bigint;
  /** Manual only, removed rows excluded, name order. The two derived kinds are their own fields. */
  byCategory: { categoryId: string; name: string; total: bigint }[];
  /** As of the end of `to`: unpaid entries and adjustments created up to then, wherever they started. */
  commissionsOwed: bigint;
  /** Priced stock-ins in the range, for "from N stock-ins". */
  pricedStockIns: number;
  /** Stock-ins with no price in the range: not counted, and said so on the screen. */
  unpricedStockIns: number;
}

interface TotalsRow { manual: bigint; stockBought: bigint; commissionsPaid: bigint; commissionsOwed: bigint; pricedStockIns: bigint; unpricedStockIns: bigint }

export async function totalsIn(tx: StaffTx, from: string, to: string): Promise<ExpenseTotals> {
  const [t] = await tx.$queryRaw<TotalsRow[]>`
    WITH r AS (SELECT (${from}::date)::timestamp AT TIME ZONE 'Asia/Manila' AS a, (${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Manila' AS b),
    stock AS (SELECT m.delta::bigint AS delta, m."unitCostCentavos"::bigint AS cost FROM supply_movements m, r WHERE m.kind = 'RECEIVE' AND m."createdAt" >= r.a AND m."createdAt" < r.b)
    SELECT
      (SELECT COALESCE(sum(e."amountCentavos"), 0)::bigint FROM expenses e WHERE e."voidedAt" IS NULL AND e."expenseDate" BETWEEN ${from}::date AND ${to}::date) AS manual,
      (SELECT COALESCE(sum(delta * cost), 0)::bigint FROM stock WHERE cost IS NOT NULL) AS "stockBought",
      (SELECT count(*) FROM stock WHERE cost IS NOT NULL) AS "pricedStockIns",
      (SELECT count(*) FROM stock WHERE cost IS NULL) AS "unpricedStockIns",
      (SELECT COALESCE(sum(x), 0)::bigint FROM (
         SELECT e."amountCentavos" AS x FROM commission_entries e, r WHERE e."paidAt" >= r.a AND e."paidAt" < r.b
         UNION ALL SELECT d."amountCentavos" FROM commission_adjustments d, r WHERE d."paidAt" >= r.a AND d."paidAt" < r.b) p) AS "commissionsPaid",
      (SELECT COALESCE(sum(x), 0)::bigint FROM (
         SELECT e."amountCentavos" AS x FROM commission_entries e, r WHERE e."paidAt" IS NULL AND e."createdAt" < r.b
         UNION ALL SELECT d."amountCentavos" FROM commission_adjustments d, r WHERE d."paidAt" IS NULL AND d."createdAt" < r.b) o) AS "commissionsOwed"`;
  const byCategory = await tx.$queryRaw<{ categoryId: string; name: string; total: bigint }[]>`
    SELECT c.id AS "categoryId", c.name, sum(e."amountCentavos")::bigint AS total
    FROM expenses e JOIN expense_categories c ON c.id = e."categoryId"
    WHERE e."voidedAt" IS NULL AND e."expenseDate" BETWEEN ${from}::date AND ${to}::date
    GROUP BY c.id, c.name, c."nameKey" ORDER BY c."nameKey"`;
  return {
    total: t.manual + t.stockBought + t.commissionsPaid, manual: t.manual, stockBought: t.stockBought, commissionsPaid: t.commissionsPaid, byCategory,
    commissionsOwed: t.commissionsOwed, pricedStockIns: Number(t.pricedStockIns), unpricedStockIns: Number(t.unpricedStockIns),
  };
}

// ADMIN only: it authorizes itself, so a caller cannot skip the check.
export async function expenseTotals(actor: StaffActor, input: { from: string; to: string }, options: AdminOptions = {}): Promise<ExpenseTotals> {
  authorize(actor, "EXPENSE_READ");
  const v = parse(ExpenseTotalsSchema, input);
  return withStaffDb("STAFF_READ", (tx) => totalsIn(tx, v.from, v.to), { access: "read", db: options.db, signal: options.signal });
}

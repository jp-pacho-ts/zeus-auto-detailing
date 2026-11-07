import "server-only";
import type { SupplyItem } from "@prisma/client";

type ItemRow = SupplyItem & { _count: { movements: number } };
import type { AdminSupplyItem, AdminSupplyList, AdminSupplyMovement, AdminSupplyMovements } from "@/types/admin-contracts";
import { AdminIdSchema, SupplyCreateSchema, SupplyListSchema, SupplyMovementsSchema, SupplyRemoveSchema, SupplyStockSchema, SupplyUpdateSchema } from "@/lib/admin-validation";
import { stockStatus } from "@/lib/supplies";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import { mutate } from "./mutation";

// P1-38: Supplies & Inventory. ADMIN only, enforced here and again inside every database function (admin_assert_actor). The app role can
// only read the tables: each write is an owner-run SECURITY DEFINER function that locks the item, validates, writes the row, its movement and
// its audit row together, and returns an error code this file maps to a plain message. The browser makes the item and movement ids, so a retry
// after a lost response returns the existing row. Names, costs and notes are never logged.

const PAGE = 50;
// A function declaration, not a generic arrow: the test loader parses .ts files with JSX on.
function read<T>(options: AdminOptions, work: (tx: StaffTx) => Promise<T>): Promise<T> {
  return withStaffDb("STAFF_READ", work, { access: "read", db: options.db, signal: options.signal });
}

function mapSupplyError(error: unknown): never {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("ZS001")) throw new AdminServiceError("NOT_FOUND");
  if (text.includes("ZS002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed this item. Reload and try again.");
  if (text.includes("ZS006")) throw new AdminServiceError("VALIDATION_ERROR");
  if (text.includes("ZS007")) throw fieldError("name", "An item with that name already exists.");
  if (text.includes("ZS008")) throw new AdminServiceError("NOT_ALLOWED", `Not enough stock. Only ${/Only (\d+) left/.exec(text)?.[1] ?? "less"} left.`);
  if (text.includes("ZS010")) throw new AdminServiceError("NOT_ALLOWED", "This item is archived. Restore it first.");
  if (text.includes("ZS011")) throw new AdminServiceError("NOT_ALLOWED", "That is more than the largest stock we can hold.");
  if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
  throw error;
}

const withCount = { _count: { select: { movements: true } } } as const;
const toItem = (r: ItemRow): AdminSupplyItem => ({
  id: r.id, name: r.name, category: r.category, unit: r.unit, currentStock: r.currentStock, reorderLevel: r.reorderLevel, costPerUnitCentavos: r.costPerUnitCentavos,
  isActive: r.isActive, revision: r.revision, status: stockStatus(r.currentStock, r.reorderLevel), hasHistory: r._count.movements > 0, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});
async function itemOrThrow(tx: StaffTx, id: string): Promise<AdminSupplyItem> {
  const r = await tx.supplyItem.findUnique({ where: { id }, include: withCount });
  if (!r) throw new AdminServiceError("NOT_FOUND");
  return toItem(r);
}

export async function listSupplies(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminSupplyList> {
  authorize(actor, "SUPPLY_READ");
  const v = parse(SupplyListSchema, input ?? {});
  return read(options, async (tx) => {
    const rows = await tx.supplyItem.findMany({ where: v.includeArchived ? {} : { isActive: true }, include: withCount, orderBy: [{ isActive: "desc" }, { nameKey: "asc" }] });
    const items = rows.map(toItem);
    return { items, lowOrOutCount: items.filter((i) => i.isActive && (i.status === "LOW" || i.status === "OUT")).length };
  });
}

export async function addSupply(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminSupplyItem> {
  authorize(actor, "SUPPLY_WRITE");
  const v = parse(SupplyCreateSchema, input);
  return mutate(options, "supply_add", async (tx) => {
    let replayed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { replayed: boolean } }[]>`SELECT admin_supply_create(${actor.staffId}, ${v.id}, ${v.name}, ${v.category ?? null}::text, ${v.unit}, ${v.reorderLevel}::integer, ${v.costCentavos}::integer, ${BigInt(v.startingStock ?? 0)}::bigint) AS r`;
      replayed = row.r.replayed;
    } catch (error) { return mapSupplyError(error); }
    adminEvent("admin.supply.created", { actorStaffId: actor.staffId, targetSupplyId: v.id, replayed });
    return itemOrThrow(tx, v.id);
  });
}

export async function updateSupply(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminSupplyItem> {
  authorize(actor, "SUPPLY_WRITE");
  const itemId = parse(AdminIdSchema, id), v = parse(SupplyUpdateSchema, input);
  return mutate(options, "supply_update", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_supply_update(${actor.staffId}, ${itemId}, ${v.expectedRevision}::integer, ${v.name ?? null}::text, ${v.category ?? null}::text, ${v.category === null}, ${v.unit ?? null}::text, ${v.reorderLevel ?? null}::integer, ${v.costCentavos ?? null}::integer) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapSupplyError(error); }
    adminEvent("admin.supply.updated", { actorStaffId: actor.staffId, targetSupplyId: itemId, changed });
    return itemOrThrow(tx, itemId);
  });
}

// Stock in (RECEIVE) or used (USE). Every movement bumps the item revision; a retry with the same id returns the item as it is now.
export async function recordStock(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminSupplyItem> {
  authorize(actor, "SUPPLY_WRITE");
  const itemId = parse(AdminIdSchema, id), v = parse(SupplyStockSchema, input);
  return mutate(options, "supply_stock", async (tx) => {
    let replayed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { replayed: boolean } }[]>`SELECT admin_supply_stock(${actor.staffId}, ${v.id}, ${itemId}, ${v.expectedRevision}::integer, ${v.kind}, ${BigInt(v.quantity)}::bigint, ${v.unitCostCentavos ?? null}::integer, ${v.note ?? null}::text) AS r`;
      replayed = row.r.replayed;
    } catch (error) { return mapSupplyError(error); }
    adminEvent("admin.supply.stock", { actorStaffId: actor.staffId, targetSupplyId: itemId, kind: v.kind, replayed });
    return itemOrThrow(tx, itemId);
  });
}

// Delete: erased when the item was never given stock, otherwise archived (hidden, history kept, restorable). The database decides under the item lock.
export async function removeSupply(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<{ outcome: "DELETED" | "ARCHIVED"; item: AdminSupplyItem | null }> {
  authorize(actor, "SUPPLY_WRITE");
  const itemId = parse(AdminIdSchema, id), v = parse(SupplyRemoveSchema, input);
  return mutate(options, "supply_remove", async (tx) => {
    let outcome: "DELETED" | "ARCHIVED";
    try {
      const [row] = await tx.$queryRaw<{ r: "DELETED" | "ARCHIVED" }[]>`SELECT admin_supply_remove(${actor.staffId}, ${itemId}, ${v.expectedRevision}::integer) AS r`;
      outcome = row.r;
    } catch (error) { return mapSupplyError(error); }
    adminEvent("admin.supply.removed", { actorStaffId: actor.staffId, targetSupplyId: itemId, outcome });
    return { outcome, item: outcome === "DELETED" ? null : await itemOrThrow(tx, itemId) };
  });
}

export async function restoreSupply(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminSupplyItem> {
  authorize(actor, "SUPPLY_WRITE");
  const itemId = parse(AdminIdSchema, id), v = parse(SupplyRemoveSchema, input);
  return mutate(options, "supply_restore", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_supply_restore(${actor.staffId}, ${itemId}, ${v.expectedRevision}::integer) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapSupplyError(error); }
    adminEvent("admin.supply.restored", { actorStaffId: actor.staffId, targetSupplyId: itemId, changed });
    return itemOrThrow(tx, itemId);
  });
}

interface MovementRow { id: string; seq: bigint; kind: AdminSupplyMovement["kind"]; delta: number; stockAfter: number; unitCostCentavos: number | null; note: string | null; actorName: string; createdAt: Date }

// Newest first, 50 per page. The cursor is the sequence number of the last row shown (the true order, even inside one transaction).
export async function listMovements(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminSupplyMovements> {
  authorize(actor, "SUPPLY_READ");
  const itemId = parse(AdminIdSchema, id), v = parse(SupplyMovementsSchema, input ?? {});
  return read(options, async (tx) => {
    await itemOrThrow(tx, itemId);
    const rows = await tx.$queryRaw<MovementRow[]>`
      SELECT m.id, m.seq, m.kind::text AS kind, m.delta, m."stockAfter", m."unitCostCentavos", m.note, s.name AS "actorName", m."createdAt"
      FROM supply_movements m JOIN staff s ON s.id = m."actorStaffId"
      WHERE m."itemId" = ${itemId} AND (${v.cursor ?? null}::bigint IS NULL OR m.seq < ${v.cursor ?? null}::bigint)
      ORDER BY m.seq DESC LIMIT ${PAGE + 1}`;
    const page = rows.slice(0, PAGE);
    return {
      movements: page.map((r) => ({ id: r.id, kind: r.kind, delta: Number(r.delta), stockAfter: Number(r.stockAfter), unitCostCentavos: r.unitCostCentavos === null ? null : Number(r.unitCostCentavos), note: r.note, actorName: r.actorName, createdAt: r.createdAt.toISOString() })),
      nextCursor: rows.length > PAGE ? String(page[PAGE - 1].seq) : null,
    };
  });
}

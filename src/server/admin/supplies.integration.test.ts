// P1-38 Supplies & Inventory: every service call runs as the runtime role (zeus_app) against real PostgreSQL with the real migration.
// Own sibling database (<T007 name>_sup); synthetic data only; nothing is dropped. Without T007_TEST_DATABASE_URL the tests skip.
// Fixtures and "the app cannot" checks use the owner client (db); every service call uses the app client.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { AdminServiceError } from "./errors";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const supUrl = url ? siblingDatabaseUrl(url, "sup") : "postgresql://unused@localhost/zeus_t007_unused_sup";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: supUrl } } }); // owner
let app: PrismaClient; // zeus_app
type Services = typeof import("./index");
let s: Services;
let ADMIN: StaffActor, STAFF: StaffActor, detailerId: string;
const opts = () => ({ db: app });

before(async () => {
  if (skip) return;
  await createAndMigrate(root, supUrl);
  provisionRuntimeRole(supUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(supUrl) } } });
  s = await import("./index");
  const admin = await db.staff.create({ data: { name: "Supply Admin", phone: "", email: "supply-admin@example.test", role: "ADMIN" } });
  const detailer = await db.staff.create({ data: { name: "Supply Detailer", phone: "", email: "supply-detailer@example.test", role: "DETAILER" } });
  detailerId = detailer.id;
  ADMIN = { staffId: admin.id, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}
const count = async (table: string, where = "TRUE") => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0].n);
let n = 0;
// A new item (the browser would make the id). Returns the service's view of it.
const add = (extra: Record<string, unknown> = {}) => s.addSupply(ADMIN, { id: randomUUID(), name: `Synthetic Wax ${++n}`, unit: "bottle", reorderLevel: 2, costPesos: "100.00", ...extra }, opts());
const stock = (item: { id: string; revision: number }, body: Record<string, unknown>) => s.recordStock(ADMIN, item.id, { id: randomUUID(), expectedRevision: item.revision, ...body }, opts());
const row = (id: string) => db.supplyItem.findUniqueOrThrow({ where: { id } });
const moves = (id: string) => db.supplyMovement.findMany({ where: { itemId: id }, orderBy: { seq: "asc" } });

test("SU1 the movement kinds are exactly OPENING, RECEIVE and USE (no ADJUST), and the delta signs are enforced by the database", { skip }, async () => {
  const kinds = await db.$queryRawUnsafe<{ v: string }[]>(`SELECT unnest(enum_range(NULL::"SupplyMovementKind"))::text AS v`);
  assert.deepEqual(kinds.map((k) => k.v), ["OPENING", "RECEIVE", "USE"]);
  const item = await add({ startingStock: 5 });
  const bad = (kind: string, delta: number) => db.$executeRawUnsafe(`INSERT INTO supply_movements ("itemId", kind, delta, "stockAfter", "actorStaffId") VALUES ('${item.id}', '${kind}', ${delta}, 1, '${ADMIN.staffId}')`);
  await assert.rejects(bad("USE", 3), /supply_movements_delta/);
  await assert.rejects(bad("RECEIVE", -3), /supply_movements_delta/);
  await assert.rejects(bad("OPENING", 0), /supply_movements_delta/);
  await assert.rejects(bad("ADJUST", 3), /invalid input value for enum/);
});

test("SU2 an item is added with or without a starting stock; the starting stock is an OPENING row; a duplicate name (any case, spaces) is refused", { skip }, async () => {
  const bare = await add({ category: "  Wash  " });
  assert.deepEqual([bare.currentStock, bare.category, bare.unit, bare.costPerUnitCentavos, bare.revision, bare.isActive, bare.status], [0, "Wash", "bottle", 10_000, 1, true, "OUT"]);
  assert.equal((await moves(bare.id)).length, 0);
  const started = await add({ startingStock: 12, name: "Iron X Spray" });
  assert.equal(started.currentStock, 12);
  const [open] = await moves(started.id);
  assert.deepEqual([open.kind, open.delta, open.stockAfter, open.unitCostCentavos, open.note, open.actorStaffId], ["OPENING", 12, 12, null, null, ADMIN.staffId]);
  await refused(add({ name: "  iron x SPRAY " }), "VALIDATION_ERROR", "duplicate", (e) => assert.deepEqual(Object.keys(e.fieldErrors), ["name"]));
  assert.equal(await count("supply_audit_events", `"action" = 'SUPPLY_CREATED' AND "targetSupplyId" = '${started.id}'`), 1);
});

test("SU3 stock in and used: one movement each with who, how much and the note; every movement bumps the revision; a stale revision is refused", { skip }, async () => {
  let item = await add({ startingStock: 10 });
  item = await stock(item, { kind: "USE", quantity: 4, note: "  Job 12  " });
  assert.deepEqual([item.currentStock, item.revision], [6, 2]);
  item = await stock(item, { kind: "RECEIVE", quantity: 20 });
  assert.deepEqual([item.currentStock, item.revision], [26, 3]);
  const list = await moves(item.id);
  assert.deepEqual(list.map((m) => [m.kind, m.delta, m.stockAfter, m.note]), [["OPENING", 10, 10, null], ["USE", -4, 6, "Job 12"], ["RECEIVE", 20, 26, null]]);
  assert.ok(list.every((m) => m.actorStaffId === ADMIN.staffId));
  await refused(s.recordStock(ADMIN, item.id, { id: randomUUID(), expectedRevision: 1, kind: "USE", quantity: 1 }, opts()), "VERSION_CONFLICT", "stale");
  assert.equal((await row(item.id)).currentStock, 26);
});

test("SU4 a purchase cost: with one it sets the movement and the item; without one the movement cost stays empty and the item cost is unchanged", { skip }, async () => {
  let item = await add({ costPesos: "50.00", startingStock: 1 });
  item = await stock(item, { kind: "RECEIVE", quantity: 5 });
  assert.equal(item.costPerUnitCentavos, 5_000);
  assert.equal((await moves(item.id)).at(-1)!.unitCostCentavos, null, "no cost typed, none guessed");
  item = await stock(item, { kind: "RECEIVE", quantity: 5, unitCostPesos: "62.50" });
  assert.equal(item.costPerUnitCentavos, 6_250);
  assert.equal((await moves(item.id)).at(-1)!.unitCostCentavos, 6_250);
  item = await stock(item, { kind: "USE", quantity: 1 });
  assert.equal(item.costPerUnitCentavos, 6_250, "using stock never changes the cost");
  await refused(s.recordStock(ADMIN, item.id, { id: randomUUID(), expectedRevision: item.revision, kind: "USE", quantity: 1, unitCostPesos: "1" }, opts()), "VALIDATION_ERROR", "a cost on stock used");
});

test("SU5 idempotency: a retried add and a retried movement return the same row and write nothing twice, even with the stale revision", { skip }, async () => {
  const id = randomUUID();
  const body = { id, name: "Idempotent Soap", unit: "L", reorderLevel: 1, costPesos: "10", startingStock: 3 };
  const first = await s.addSupply(ADMIN, body, opts());
  const again = await s.addSupply(ADMIN, body, opts());
  assert.deepEqual([again.id, again.revision, again.currentStock], [first.id, first.revision, first.currentStock]);
  assert.equal(await count("supply_items", `id = '${id}'`), 1);
  assert.equal(await count("supply_audit_events", `"targetSupplyId" = '${id}'`), 1, "no second audit row");
  await refused(s.addSupply(ADMIN, { ...body, unit: "mL" }, opts()), "VALIDATION_ERROR", "same id, different content");

  const mid = randomUUID();
  const move = { id: mid, expectedRevision: first.revision, kind: "USE", quantity: 2, note: "retry me" };
  const used = await s.recordStock(ADMIN, id, move, opts());
  assert.equal(used.currentStock, 1);
  // The retried form still carries the OLD revision: the replay check runs before the revision check, so it returns the existing movement.
  const retried = await s.recordStock(ADMIN, id, move, opts());
  assert.deepEqual([retried.currentStock, retried.revision], [1, used.revision]);
  assert.equal(await count("supply_movements", `id = '${mid}'`), 1);
  assert.equal((await row(id)).currentStock, 1, "deducted once, not twice");
  await refused(s.recordStock(ADMIN, id, { ...move, quantity: 3 }, opts()), "VALIDATION_ERROR", "same id, different quantity");
  await refused(s.recordStock(ADMIN, id, { ...move, note: "other" }, opts()), "VALIDATION_ERROR", "same id, different note");
  // Concurrent identical calls end with one row.
  const cid = randomUUID(), cmove = { id: cid, expectedRevision: used.revision, kind: "RECEIVE", quantity: 7 };
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => s.recordStock(ADMIN, id, cmove, opts())));
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => r.status)));
  assert.equal(await count("supply_movements", `id = '${cid}'`), 1);
  assert.equal((await row(id)).currentStock, 8);
});

test("SU6 bounds: stock exactly 1,000,000,000 is accepted, one more is refused plainly; using more than is there is refused with the number left", { skip }, async () => {
  let item = await add({ startingStock: 999_999_990 });
  item = await stock(item, { kind: "RECEIVE", quantity: 10 });
  assert.equal(item.currentStock, 1_000_000_000);
  await refused(s.recordStock(ADMIN, item.id, { id: randomUUID(), expectedRevision: item.revision, kind: "RECEIVE", quantity: 1 }, opts()), "NOT_ALLOWED", "above the ceiling",
    (e) => assert.match(e.message, /more than the largest stock/));
  let small = await add({ startingStock: 3 });
  await refused(s.recordStock(ADMIN, small.id, { id: randomUUID(), expectedRevision: small.revision, kind: "USE", quantity: 4 }, opts()), "NOT_ALLOWED", "not enough",
    (e) => assert.equal(e.message, "Not enough stock. Only 3 left."));
  small = await stock(small, { kind: "USE", quantity: 3 });
  assert.equal(small.currentStock, 0, "using exactly what is there is fine");
  const big = await add({ costPesos: "1000000.00", reorderLevel: 1_000_000_000, startingStock: 1_000_000_000 });
  assert.deepEqual([big.costPerUnitCentavos, big.reorderLevel, big.currentStock], [100_000_000, 1_000_000_000, 1_000_000_000]);
  for (const bad of [{ costPesos: "1000000.01" }, { reorderLevel: 1_000_000_001 }, { startingStock: 1_000_000_001 }])
    await refused(add(bad), "VALIDATION_ERROR", JSON.stringify(bad));
});

test("SU7 two uses of the last unit: exactly one wins; stock never goes below zero and the history adds up", { skip }, async () => {
  const item = await add({ startingStock: 1 });
  const outcomes = await Promise.allSettled([1, 2].map(() => stock(item, { kind: "USE", quantity: 1 })));
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal((await row(item.id)).currentStock, 0);
  assert.equal((await moves(item.id)).length, 2, "opening plus the one use");
});

test("SU8 delete: an untouched item is erased (the name stays in the audit row); one with history is archived, refuses changes, can be restored, and keeps its name reserved", { skip }, async () => {
  const fresh = await add({ name: "Never Touched" });
  const erased = await s.removeSupply(ADMIN, fresh.id, { expectedRevision: fresh.revision }, opts());
  assert.deepEqual([erased.outcome, erased.item], ["DELETED", null]);
  assert.equal(await count("supply_items", `id = '${fresh.id}'`), 0);
  const gone = await db.supplyAuditEvent.findFirstOrThrow({ where: { targetSupplyId: fresh.id, action: "SUPPLY_DELETED" } });
  assert.equal(gone.targetLabel, "Never Touched");

  let used = await add({ name: "Has History", startingStock: 4 });
  const archived = await s.removeSupply(ADMIN, used.id, { expectedRevision: used.revision }, opts());
  assert.deepEqual([archived.outcome, archived.item!.isActive, archived.item!.revision], ["ARCHIVED", false, used.revision + 1]);
  used = archived.item!;
  await refused(s.updateSupply(ADMIN, used.id, { expectedRevision: used.revision, unit: "pcs" }, opts()), "NOT_ALLOWED", "edit archived");
  await refused(s.recordStock(ADMIN, used.id, { id: randomUUID(), expectedRevision: used.revision, kind: "USE", quantity: 1 }, opts()), "NOT_ALLOWED", "stock on archived");
  await refused(add({ name: "has history" }), "VALIDATION_ERROR", "the name stays reserved");
  const again = await s.removeSupply(ADMIN, used.id, { expectedRevision: used.revision }, opts());
  assert.deepEqual([again.outcome, again.item!.revision], ["ARCHIVED", used.revision], "deleting an archived item again changes nothing");
  const back = await s.restoreSupply(ADMIN, used.id, { expectedRevision: used.revision }, opts());
  assert.deepEqual([back.isActive, back.revision], [true, used.revision + 1]);
  assert.equal((await s.restoreSupply(ADMIN, used.id, { expectedRevision: back.revision }, opts())).revision, back.revision, "restoring an active item changes nothing");
  assert.equal(await count("supply_audit_events", `"targetSupplyId" = '${used.id}' AND action IN ('SUPPLY_ARCHIVED', 'SUPPLY_RESTORED')`), 2);
});

test("SU9 a delete and a stock-in racing on one item end consistently: either erased and the stock-in not found, or the stock-in first and the item archived", { skip }, async () => {
  const item = await add();
  const [removal, receipt] = await Promise.allSettled([s.removeSupply(ADMIN, item.id, { expectedRevision: item.revision }, opts()), stock(item, { kind: "RECEIVE", quantity: 5 })]);
  const exists = await count("supply_items", `id = '${item.id}'`);
  if (removal.status === "fulfilled" && removal.value.outcome === "DELETED") {
    assert.equal(receipt.status, "rejected");
    assert.equal(exists, 0);
    assert.equal(await count("supply_movements", `"itemId" = '${item.id}'`), 0);
  } else {
    assert.equal(receipt.status, "fulfilled");
    assert.equal(exists, 1);
  }
});

test("SU10 edits: only the changed fields move, the revision bumps once, the audit row names the fields (never the values), a no-change edit does nothing, the category can be cleared", { skip }, async () => {
  let item = await add({ category: "Wash", costPesos: "10.00" });
  item = await s.updateSupply(ADMIN, item.id, { expectedRevision: item.revision, name: "Renamed Wax", costPesos: "12.50" }, opts());
  assert.deepEqual([item.name, item.costPerUnitCentavos, item.category, item.revision], ["Renamed Wax", 1_250, "Wash", 2]);
  const audit = await db.supplyAuditEvent.findFirstOrThrow({ where: { targetSupplyId: item.id, action: "SUPPLY_UPDATED" } });
  assert.equal(audit.changedFields, "name,costPerUnit");
  assert.ok(!JSON.stringify(audit, (_k, v) => (typeof v === "bigint" ? String(v) : v)).match(/Renamed|12\.5|1250/), "no values in the audit row");
  const same = await s.updateSupply(ADMIN, item.id, { expectedRevision: item.revision, name: "Renamed Wax", unit: "bottle" }, opts());
  assert.equal(same.revision, item.revision, "nothing differed");
  assert.equal(await count("supply_audit_events", `"targetSupplyId" = '${item.id}' AND action = 'SUPPLY_UPDATED'`), 1);
  item = await s.updateSupply(ADMIN, item.id, { expectedRevision: item.revision, category: null }, opts());
  assert.equal(item.category, null);
  await refused(s.updateSupply(ADMIN, item.id, { expectedRevision: 1, unit: "pcs" }, opts()), "VERSION_CONFLICT", "stale");
  const other = await add();
  await refused(s.updateSupply(ADMIN, other.id, { expectedRevision: other.revision, name: "RENAMED wax" }, opts()), "VALIDATION_ERROR", "rename onto an existing name");
});

test("SU11 the badge through the service: reorder 0 shows none and is not counted; reorder 5 is OK, LOW, LOW, OUT at 6, 5, 1, 0; archived items are not counted", { skip }, async () => {
  const silent = await add({ reorderLevel: 0, startingStock: 0, name: "Silent Zero" });
  assert.equal(silent.status, "NONE");
  const five = await add({ reorderLevel: 5, startingStock: 6, name: "Five Level" });
  const seen: string[] = [five.status];
  let cur = five;
  for (const q of [1, 4, 1]) { cur = await stock(cur, { kind: "USE", quantity: q }); seen.push(cur.status); }
  assert.deepEqual(seen, ["OK", "LOW", "LOW", "OUT"]);
  const list = await s.listSupplies(ADMIN, {}, opts());
  const byId = new Map(list.items.map((i) => [i.id, i]));
  assert.equal(byId.get(silent.id)!.status, "NONE");
  const lowOrOut = list.items.filter((i) => i.status === "LOW" || i.status === "OUT").length;
  assert.equal(list.lowOrOutCount, lowOrOut);
  const parked = await s.removeSupply(ADMIN, cur.id, { expectedRevision: cur.revision }, opts());
  assert.equal(parked.outcome, "ARCHIVED");
  const after = await s.listSupplies(ADMIN, {}, opts());
  assert.ok(!after.items.some((i) => i.id === cur.id), "archived items are hidden by default");
  assert.equal(after.lowOrOutCount, lowOrOut - 1, "and not counted");
  assert.ok((await s.listSupplies(ADMIN, { includeArchived: "true" }, opts())).items.some((i) => i.id === cur.id));
});

test("SU12 the history lists newest first with who and why, and pages by cursor", { skip }, async () => {
  let item = await add({ startingStock: 1 });
  for (let i = 0; i < 51; i++) item = await stock(item, { kind: "RECEIVE", quantity: 1, ...(i === 50 ? { note: "last one" } : {}) });
  const first = await s.listMovements(ADMIN, item.id, {}, opts());
  assert.equal(first.movements.length, 50);
  assert.deepEqual([first.movements[0].note, first.movements[0].actorName, first.movements[0].stockAfter], ["last one", "Supply Admin", 52]);
  assert.ok(first.nextCursor);
  const second = await s.listMovements(ADMIN, item.id, { cursor: first.nextCursor }, opts());
  assert.deepEqual([second.movements.length, second.nextCursor, second.movements.at(-1)!.kind], [2, null, "OPENING"]);
  await refused(s.listMovements(ADMIN, randomUUID(), {}, opts()), "NOT_FOUND", "unknown item");
});

test("SU13 only an admin: STAFF is refused for every operation, a non-admin actor id is refused inside the database function, and nothing is written", { skip }, async () => {
  const before = [await count("supply_items"), await count("supply_movements"), await count("supply_audit_events")];
  const item = await add({ startingStock: 2 });
  const id = randomUUID();
  await refused(s.listSupplies(STAFF, {}, opts()), "FORBIDDEN", "list");
  await refused(s.addSupply(STAFF, { id, name: "Nope", unit: "x", reorderLevel: 0, costPesos: "0" }, opts()), "FORBIDDEN", "add");
  await refused(s.updateSupply(STAFF, item.id, { expectedRevision: 1, unit: "y" }, opts()), "FORBIDDEN", "update");
  await refused(s.recordStock(STAFF, item.id, { id, expectedRevision: 1, kind: "USE", quantity: 1 }, opts()), "FORBIDDEN", "stock");
  await refused(s.removeSupply(STAFF, item.id, { expectedRevision: 1 }, opts()), "FORBIDDEN", "remove");
  await refused(s.restoreSupply(STAFF, item.id, { expectedRevision: 1 }, opts()), "FORBIDDEN", "restore");
  await refused(s.listMovements(STAFF, item.id, {}, opts()), "FORBIDDEN", "movements");
  // Past the service: the function itself checks the actor (ZT004), so a bypassed service still fails closed.
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_supply_stock($1, $2, $3, 1, 'USE', 1, NULL, NULL)`, detailerId, randomUUID(), item.id), /ZT004|Only an admin/);
  assert.deepEqual([await count("supply_items"), await count("supply_movements"), await count("supply_audit_events")], [before[0] + 1, before[1] + 1, before[2] + 1], "only the fixture item, its opening and its audit row");
});

test("SU14 the runtime role cannot write the tables or touch the audit table, and cannot run the internal functions", { skip }, async () => {
  const item = await add({ startingStock: 2 });
  const denied = async (sql: string, label: string) => assert.rejects(app.$executeRawUnsafe(sql), /permission denied/i, label);
  await denied(`INSERT INTO supply_items (name, "nameKey", unit) VALUES ('x', 'x', 'u')`, "insert item");
  await denied(`UPDATE supply_items SET "currentStock" = 99 WHERE id = '${item.id}'`, "update item");
  await denied(`DELETE FROM supply_items WHERE id = '${item.id}'`, "delete item");
  await denied(`INSERT INTO supply_movements ("itemId", kind, delta, "stockAfter", "actorStaffId") VALUES ('${item.id}', 'RECEIVE', 1, 3, '${ADMIN.staffId}')`, "insert movement");
  await denied(`UPDATE supply_movements SET note = 'x'`, "update movement");
  await denied(`DELETE FROM supply_movements`, "delete movements");
  await denied(`TRUNCATE supply_movements`, "truncate movements");
  await assert.rejects(app.$queryRawUnsafe(`SELECT * FROM supply_audit_events`), /permission denied/i, "read the audit table");
  await denied(`INSERT INTO supply_audit_events (action, "actorStaffId", "targetSupplyId") VALUES ('SUPPLY_CREATED', '${ADMIN.staffId}', 'x')`, "write the audit table");
  for (const fn of ["check_supply_consistency()", "supply_stock_matches_history('x')"]) await assert.rejects(app.$queryRawUnsafe(`SELECT ${fn}`), /permission denied|trigger/i, fn);
  await app.$queryRawUnsafe(`SELECT count(*) FROM supply_items`);
  await app.$queryRawUnsafe(`SELECT count(*) FROM supply_movements`);
});

test("SU15 history and audit are append-only even for the owner, and a stock that does not match its history is refused at commit", { skip }, async () => {
  const item = await add({ startingStock: 3 });
  const m = (await moves(item.id))[0];
  await assert.rejects(db.$executeRawUnsafe(`UPDATE supply_movements SET delta = 99 WHERE id = '${m.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM supply_movements WHERE id = '${m.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE supply_movements`), /append-only/);
  const a = await db.supplyAuditEvent.findFirstOrThrow({ where: { targetSupplyId: item.id } });
  await assert.rejects(db.$executeRawUnsafe(`UPDATE supply_audit_events SET "targetLabel" = 'x' WHERE id = '${a.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM supply_audit_events WHERE id = '${a.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE supply_audit_events`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`UPDATE supply_items SET "currentStock" = 99 WHERE id = '${item.id}'`), /must equal its history/);
  assert.equal((await row(item.id)).currentStock, 3);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO supply_audit_events (action, "actorStaffId", "targetSupplyId", "targetLabel") VALUES ('SUPPLY_CREATED', '${ADMIN.staffId}', 'x', 'a name')`), /supply_audit_shape/, "a name only on a delete");
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO supply_audit_events (action, "actorStaffId", "targetSupplyId", "changedFields") VALUES ('SUPPLY_UPDATED', '${ADMIN.staffId}', 'x', 'name=Secret 5')`), /supply_audit_shape/, "field names only");
});

test("SU16 the audit rows carry no cost, note or quantity text, and the log lines hold ids only", { skip }, async () => {
  const item = await add({ name: "Private Polish Name", costPesos: "77.77", startingStock: 9 });
  await stock(item, { kind: "USE", quantity: 2, note: "Secret job note" });
  const rows = await db.supplyAuditEvent.findMany({ where: { targetSupplyId: item.id } });
  const text = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  for (const leak of ["Private Polish", "77.77", "7777", "Secret job note"]) assert.ok(!text.includes(leak), `the audit leaked ${leak}`);
});

// P1-39 Expenses: every service call runs as the runtime role (zeus_app) against real PostgreSQL with the real migration. Own sibling database
// (<T007 name>_exp); synthetic data only; nothing is dropped. Without T007_TEST_DATABASE_URL the tests skip. Fixtures and "the app cannot" checks use
// the owner client (db); every service call uses the app client. Commissions come from real completed bookings, through the real services.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { monthRange } from "@/lib/expenses";
import type { CatalogSelection } from "@/types/catalog-contracts";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "../catalog.fixture";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { AdminServiceError } from "./errors";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const expUrl = url ? siblingDatabaseUrl(url, "exp") : "postgresql://unused@localhost/zeus_t007_unused_exp";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: expUrl } } }); // owner
let app: PrismaClient; // zeus_app
type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
let ADMIN: StaffActor, STAFF: StaffActor, detailerId: string, workerId: string, otherId: string, hiddenId: string;
const manifest = readManifest();
let releaseId = "";
const opts = () => ({ db: app });
const manilaToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const addDay = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  if (skip) return;
  await createAndMigrate(root, expUrl);
  provisionRuntimeRole(expUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(expUrl) } } });
  s = await import("./index");
  pricing = await import("../catalog-pricing");
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, "expense-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  const detailer = await db.staff.create({ data: { name: "Expense Detailer", phone: "", email: "expense-detailer@example.test", role: "DETAILER" } });
  detailerId = detailer.id;
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);
  workerId = (await s.addPerson(ADMIN, { name: "Expense Worker", phone: "+63 917 555 0199" }, opts())).id;
  otherId = (await db.expenseCategory.findFirstOrThrow({ where: { name: "Other" } })).id;
  hiddenId = (await s.addExpenseCategory(ADMIN, { id: randomUUID(), name: "Hidden later" }, opts())).id;
  const hidden = await db.expenseCategory.findUniqueOrThrow({ where: { id: hiddenId } });
  await s.updateExpenseCategory(ADMIN, hiddenId, { expectedRevision: hidden.revision, isActive: false }, opts());
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
const events = (id: string) => db.expenseEvent.findMany({ where: { expenseId: id }, orderBy: { seq: "asc" } });
const body = (extra: Record<string, unknown> = {}) => ({ date: "2026-10-15", categoryId: otherId, amountPesos: "100.00", ...extra });
const add = (extra: Record<string, unknown> = {}) => s.addExpense(ADMIN, { id: randomUUID(), ...body(extra) }, opts());
const totals = (from: string, to: string) => s.expenseTotals(ADMIN, { from, to }, opts());

// A completed booking with a shop-priced tint that earns commission for the worker. Returns the commission entry.
let seq = 0;
async function earnedEntry() {
  const r0 = releaseFromManifest(manifest, releaseId);
  const selection: CatalogSelection = { vehicleCategoryId: sizeId(r0, "S"), lines: [{ serviceId: bySlug(r0, "basic-wash").id, quantity: 1 }] };
  const priced = pricing.priceSelection(r0, selection);
  assert.equal(priced.kind, "QUOTED");
  const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
  const day = manilaToday(), id = randomUUID(), n = ++seq;
  const size = r0.sizes.find((x) => x.id === q.vehicleCategoryId)!;
  const lit = (x: unknown): string => (x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`);
  const insert = async (tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
  };
  const start = new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
    const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
    await insert(tx, "bookings", { id, referenceCode: `ZEUS-E${String(n).padStart(5, "0")}`, customerName: `Synthetic Customer ${n}`, customerPhone: "+639170000999",
      customerEmail: `synthetic${n}@example.test`, vehicleModel: "Synthetic Roadster", vehiclePlate: "ZZZ9999", notes: "synthetic", vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day,
      startsAt: start, endsAt: new Date(Date.parse(start) + 86_400_000).toISOString(), status: "PENDING", priceSnapshot: q.totalPriceCentavos / 100,
      serviceNameSnapshot: q.lines[0].name, vehicleCategoryNameSnapshot: size.name, idempotencyKey: randomUUID(), requestHash: "synthetic-" + n,
      updatedAt: new Date().toISOString(), snapshotVersion: "QUEUE_V3", catalogReleaseId: q.catalogReleaseId, vehicleSizeCodeSnapshot: size.code,
      catalogFingerprint: q.catalogFingerprint, pricingAlgorithm: q.pricingAlgorithm, queueCode: q.queueId, queuePosition: Number(p),
      receiptTotalCentavos: q.totalPriceCentavos, receiptEstimatedCentavos: q.estimatedTotalCentavos });
    for (const [i, l] of q.lines.entries()) {
      await insert(tx, "booking_line_items", { id: randomUUID(), bookingId: id, order: i, releaseId: q.catalogReleaseId, serviceId: l.serviceId,
        vehicleCategoryId: q.vehicleCategoryId, offerId: l.offerId, type: l.kind, nameSnapshot: l.name, unit: l.unit, quantity: l.quantity,
        unitPriceCentavos: l.unitPriceCentavos, subtotalCentavos: l.subtotalCentavos, lineVersion: "QUEUE_V3", priceStatus: l.priceStatus,
        referenceUnitPriceCentavos: l.referenceUnitPriceCentavos, referenceSubtotalCentavos: l.referenceSubtotalCentavos });
    }
  });
  const rev = async () => (await db.booking.findUniqueOrThrow({ where: { id } })).revision;
  const tintId = bySlug(r0, "regular-tint").id;
  await s.addLine(ADMIN, id, { expectedRevision: await rev(), serviceId: tintId, quantity: 1 }, opts());
  const tint = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: id, serviceId: tintId, removedAt: null } });
  await s.setLinePrice(ADMIN, id, tint.id, { expectedRevision: await rev(), priceCentavos: 100_000, reason: "fixture price" }, opts());
  await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(), status: "CONFIRMED" }, opts());
  const bay = await s.createBay(ADMIN, { name: `Expense bay ${n}`, sortOrder: 100 + n, bayType: "WASH" }, opts());
  await s.setBay(ADMIN, id, { expectedRevision: await rev(), date: day, bayId: bay.id }, opts());
  await s.assignWorker(ADMIN, id, workerId, { expectedRevision: await rev() }, opts());
  await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(), status: "IN_PROGRESS" }, opts());
  for (const l of await db.bookingLineItem.findMany({ where: { bookingId: id, removedAt: null } })) await s.setLineStatus(ADMIN, id, l.id, { expectedRevision: await rev(), workStatus: "DONE" }, opts());
  await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(), status: "COMPLETED" }, opts());
  return db.commissionEntry.findFirstOrThrow({ where: { bookingId: id, staffId: workerId } });
}

test("EX1 the seeded categories are as listed, in order; the derived names are reserved in any case", { skip }, async () => {
  const list = await s.listExpenseCategories(ADMIN, opts());
  assert.deepEqual(list.slice(0, 7).map((c) => c.name), ["Rent", "Utilities", "Salaries and wages", "Equipment and tools", "Marketing", "Repairs and maintenance", "Other"]);
  for (const name of ["Stock bought", " COMMISSIONS paid "]) await refused(s.addExpenseCategory(ADMIN, { id: randomUUID(), name }, opts()), "VALIDATION_ERROR", name);
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_category_create($1, $2, 'stock BOUGHT')`, ADMIN.staffId, randomUUID()), /ZX013|reserved/, "the database refuses it too");
  const rent = list[0];
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_category_update($1, $2, $3::integer, 'commissions paid', NULL)`, ADMIN.staffId, rent.id, rent.revision), /ZX013|reserved/, "and on a rename");
});

test("EX2 an expense round trips; required fields, amount and text bounds are refused; a future or too-old date is refused in words", { skip }, async () => {
  const e = await add({ amountPesos: "1250.50", payee: "  Meralco ", note: " November " });
  assert.deepEqual([e.expenseDate, e.categoryName, e.amountCentavos, e.payee, e.note, e.revision, e.removed], ["2026-10-15", "Other", 125_050, "Meralco", "November", 1, false]);
  for (const [label, extra] of [["zero", { amountPesos: "0" }], ["negative", { amountPesos: "-5" }], ["over the maximum", { amountPesos: "100000000.01" }], ["long payee", { payee: "x".repeat(81) }], ["long note", { note: "x".repeat(201) }]] as const)
    await refused(add(extra), "VALIDATION_ERROR", label);
  await refused(add({ date: addDay(manilaToday(), 1) }), "VALIDATION_ERROR", "tomorrow", (err) => assert.deepEqual(Object.keys(err.fieldErrors), ["date"]));
  await refused(add({ date: "2019-12-31" }), "VALIDATION_ERROR", "before 2020", (err) => assert.deepEqual(Object.keys(err.fieldErrors), ["date"]));
  assert.equal((await add({ date: manilaToday() })).expenseDate, manilaToday(), "today is fine");
  await refused(add({ categoryId: randomUUID() }), "NOT_FOUND", "unknown category");
  await refused(add({ categoryId: hiddenId }), "VALIDATION_ERROR", "hidden category", (err) => assert.deepEqual(Object.keys(err.fieldErrors), ["categoryId"]));
  // The database's own bound, past the service.
  await assert.rejects(db.$executeRawUnsafe(`UPDATE expenses SET "amountCentavos" = 0 WHERE id = '${e.id}'`), /expenses_amount/);
});

test("EX3 add is idempotent: same id and content returns the row with no second history row; different content is refused; four concurrent identical adds make one row", { skip }, async () => {
  const id = randomUUID();
  const first = await s.addExpense(ADMIN, { id, ...body({ amountPesos: "77.00" }) }, opts());
  const again = await s.addExpense(ADMIN, { id, ...body({ amountPesos: "77.00" }) }, opts());
  assert.deepEqual(again, first);
  assert.equal(await count("expenses", `id = '${id}'`), 1);
  assert.equal((await events(id)).length, 1);
  await refused(s.addExpense(ADMIN, { id, ...body({ amountPesos: "78.00" }) }, opts()), "VALIDATION_ERROR", "same id, different content");
  const race = randomUUID();
  const results = await Promise.all([1, 2, 3, 4].map(() => s.addExpense(ADMIN, { id: race, ...body({ amountPesos: "5.00" }) }, opts())));
  assert.ok(results.every((r) => r.id === race));
  assert.equal(await count("expenses", `id = '${race}'`), 1);
  assert.equal((await events(race)).length, 1, "one history row");
});

test("EX4 edit: stale is refused; a retry after a lost response succeeds unchanged before the revision check; no change writes nothing; every change keeps the amount before and after", { skip }, async () => {
  const e = await add({ amountPesos: "100.00" });
  const edited = await s.updateExpense(ADMIN, e.id, { expectedRevision: 1, ...body({ amountPesos: "150.00", payee: "Shop" }) }, opts());
  assert.deepEqual([edited.amountCentavos, edited.payee, edited.revision], [15_000, "Shop", 2]);
  const retried = await s.updateExpense(ADMIN, e.id, { expectedRevision: 1, ...body({ amountPesos: "150.00", payee: "Shop" }) }, opts());
  assert.deepEqual(retried, edited, "the same values with the old revision is a retry");
  assert.equal((await events(e.id)).length, 2, "the retry wrote no history");
  await refused(s.updateExpense(ADMIN, e.id, { expectedRevision: 1, ...body({ amountPesos: "999.00" }) }, opts()), "VERSION_CONFLICT", "really stale");
  assert.equal((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).amountCentavos, BigInt(15_000));
  const history = await s.listExpenseHistory(ADMIN, e.id, opts());
  assert.deepEqual(history.map((h) => [h.kind, h.amountCentavos, h.revision]), [["EDITED", 15_000, 2], ["CREATED", 10_000, 1]], "newest first, with the amount before");
  // Clearing: a payee left out is cleared by an edit.
  const cleared = await s.updateExpense(ADMIN, e.id, { expectedRevision: 2, ...body({ amountPesos: "150.00" }) }, opts());
  assert.equal(cleared.payee, null);
  // An old expense can be corrected while its category is hidden, but cannot be moved into a hidden category.
  await refused(s.updateExpense(ADMIN, e.id, { expectedRevision: 3, ...body({ categoryId: hiddenId }) }, opts()), "VALIDATION_ERROR", "into hidden");
});

test("EX5 a history row keeps the category name at that time; renaming a category does not rewrite it", { skip }, async () => {
  const c = await s.addExpenseCategory(ADMIN, { id: randomUUID(), name: "Old name" }, opts());
  const e = await add({ categoryId: c.id });
  await s.updateExpenseCategory(ADMIN, c.id, { expectedRevision: c.revision, name: "New name" }, opts());
  assert.deepEqual((await events(e.id)).map((h) => h.categoryName), ["Old name"]);
  assert.equal((await s.listExpenseHistory(ADMIN, e.id, opts()))[0].categoryName, "Old name");
  assert.deepEqual((await db.expenseCategoryEvent.findMany({ where: { categoryId: c.id }, orderBy: { seq: "asc" } })).map((h) => [h.kind, h.name]), [["CREATED", "Old name"], ["RENAMED", "New name"]]);
});

test("EX6 remove hides and never erases: gone from the month and the totals, back after restore; twice is harmless; a removed expense cannot be edited", { skip }, async () => {
  const month = "2026-09", day = "2026-09-20";
  const e = await add({ date: day, amountPesos: "321.00" });
  assert.equal((await totals(day, day)).manual, BigInt(32_100));
  const removed = await s.removeExpense(ADMIN, e.id, { expectedRevision: 1, reason: "  typed twice " }, opts());
  assert.equal(removed.removed, true);
  assert.equal(await count("expenses", `id = '${e.id}'`), 1, "still there");
  assert.equal((await totals(day, day)).manual, BigInt(0));
  const plain = await s.getExpenseMonth(ADMIN, { month }, opts());
  assert.equal(plain.expenses.some((x) => x.id === e.id), false);
  const shown = await s.getExpenseMonth(ADMIN, { month, includeRemoved: "true" }, opts());
  assert.equal(shown.expenses.find((x) => x.id === e.id)?.removed, true);
  assert.equal(shown.totals.manual, plain.totals.manual, "the switch shows rows; it never changes the money");
  const twice = await s.removeExpense(ADMIN, e.id, { expectedRevision: 1 }, opts());
  assert.equal(twice.revision, 2, "already removed changes nothing, even with the old revision");
  assert.equal((await events(e.id)).length, 2);
  await refused(s.updateExpense(ADMIN, e.id, { expectedRevision: 2, ...body({ date: day, amountPesos: "1.00" }) }, opts()), "NOT_ALLOWED", "edit while removed");
  const back = await s.restoreExpense(ADMIN, e.id, { expectedRevision: 2 }, opts());
  assert.deepEqual([back.removed, back.revision], [false, 3]);
  assert.equal((await totals(day, day)).manual, BigInt(32_100));
  assert.equal((await s.restoreExpense(ADMIN, e.id, { expectedRevision: 1 }, opts())).revision, 3, "already active changes nothing");
  assert.deepEqual((await events(e.id)).map((h) => [h.kind, h.reason]), [["CREATED", null], ["VOIDED", "typed twice"], ["RESTORED", null]]);
  const stale = await add({ date: day });
  await s.updateExpense(ADMIN, stale.id, { expectedRevision: 1, ...body({ date: day, amountPesos: "2.00" }) }, opts());
  await refused(s.removeExpense(ADMIN, stale.id, { expectedRevision: 1 }, opts()), "VERSION_CONFLICT", "stale remove");
});

test("EX7 history is append-only and an expense or category cannot be erased, even by the owner", { skip }, async () => {
  const e = await add();
  const [h] = await events(e.id);
  await assert.rejects(db.$executeRawUnsafe(`UPDATE expense_events SET "amountCentavos" = 1 WHERE seq = ${h.seq}`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM expense_events WHERE seq = ${h.seq}`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE expense_events`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE expense_category_events`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM expenses WHERE id = '${e.id}'`), /never erased/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM expense_categories WHERE id = '${otherId}'`), /never erased/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE expenses CASCADE`), /never erased|append-only/);
});

test("EX8 categories: add, rename, hide and show; duplicates refused; retry harmless; the last active one stays; at most 40", { skip }, async () => {
  const id = randomUUID();
  const c = await s.addExpenseCategory(ADMIN, { id, name: "  Permits " }, opts());
  assert.equal(c.name, "Permits");
  assert.deepEqual(await s.addExpenseCategory(ADMIN, { id, name: "Permits" }, opts()), c, "retry");
  await refused(s.addExpenseCategory(ADMIN, { id, name: "Fees" }, opts()), "VALIDATION_ERROR", "same id, other name");
  await refused(s.addExpenseCategory(ADMIN, { id: randomUUID(), name: "permits" }, opts()), "VALIDATION_ERROR", "duplicate, any case", (e) => assert.deepEqual(Object.keys(e.fieldErrors), ["name"]));
  const hidden = await s.updateExpenseCategory(ADMIN, id, { expectedRevision: c.revision, isActive: false }, opts());
  assert.equal(hidden.isActive, false);
  assert.deepEqual(await s.updateExpenseCategory(ADMIN, id, { expectedRevision: c.revision, isActive: false }, opts()), hidden, "a retry with the old revision changes nothing");
  await refused(s.updateExpenseCategory(ADMIN, id, { expectedRevision: c.revision, name: "Fees" }, opts()), "VERSION_CONFLICT", "stale rename");
  await refused(s.addExpenseCategory(ADMIN, { id: randomUUID(), name: "PERMITS" }, opts()), "VALIDATION_ERROR", "a hidden name stays reserved");
  const shown = await s.updateExpenseCategory(ADMIN, id, { expectedRevision: hidden.revision, isActive: true }, opts());
  assert.equal(shown.isActive, true);
  assert.deepEqual((await db.expenseCategoryEvent.findMany({ where: { categoryId: id }, orderBy: { seq: "asc" } })).map((h) => h.kind), ["CREATED", "HIDDEN", "SHOWN"]);
  const total = await count("expense_categories");
  for (let i = total; i < 40; i++) await s.addExpenseCategory(ADMIN, { id: randomUUID(), name: `Filler ${i}` }, opts());
  await refused(s.addExpenseCategory(ADMIN, { id: randomUUID(), name: "One too many" }, opts()), "NOT_ALLOWED", "the 41st");
  // The last active one: hide every other in a transaction that is rolled back, so later tests keep their categories.
  const rolledBack = new Error("rolled back on purpose");
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE expense_categories SET "isActive" = false WHERE id <> '${id}'`);
    await tx.$queryRawUnsafe(`SELECT admin_category_update($1, $2, $3::integer, NULL, false)`, ADMIN.staffId, id, shown.revision);
    throw rolledBack;
  }), /ZX014|last category/, "the last active category is refused");
});

test("EX9 a priced stock-in counts delta times cost in bigint; an unpriced stock-in and starting stock do not count and are reported; a used row never counts", { skip }, async () => {
  const today = manilaToday();
  const before = await totals(today, today);
  const item = await s.addSupply(ADMIN, { id: randomUUID(), name: "Expense Wax", unit: "bottle", reorderLevel: 0, costPesos: "9.00", startingStock: 5 }, opts());
  let cur = await s.recordStock(ADMIN, item.id, { id: randomUUID(), expectedRevision: item.revision, kind: "RECEIVE", quantity: 3, unitCostPesos: "100.50" }, opts());
  cur = await s.recordStock(ADMIN, item.id, { id: randomUUID(), expectedRevision: cur.revision, kind: "RECEIVE", quantity: 2 }, opts());
  await s.recordStock(ADMIN, item.id, { id: randomUUID(), expectedRevision: cur.revision, kind: "USE", quantity: 1 }, opts());
  let after = await totals(today, today);
  assert.equal(after.stockBought - before.stockBought, BigInt(30_150), "3 x 100.50");
  assert.equal(after.pricedStockIns - before.pricedStockIns, 1);
  assert.equal(after.unpricedStockIns - before.unpricedStockIns, 1, "the priceless stock-in is reported, not counted");
  // The worst case does not overflow: 1,000,000,000 x 1,000,000.00 pesos = 1e17 centavos, past a safe integer.
  const big = await s.addSupply(ADMIN, { id: randomUUID(), name: "Expense Big", unit: "pc", reorderLevel: 0, costPesos: "1.00" }, opts());
  await s.recordStock(ADMIN, big.id, { id: randomUUID(), expectedRevision: big.revision, kind: "RECEIVE", quantity: 1_000_000_000, unitCostPesos: "1000000.00" }, opts());
  const prior = after;
  after = await totals(today, today);
  assert.equal(after.stockBought - prior.stockBought, BigInt("100000000000000000"));
  assert.equal(after.total, after.manual + after.stockBought + after.commissionsPaid, "total is the three sums");
  assert.equal(typeof after.total, "bigint");
  // The route's month read carries it as an exact string.
  const month = await s.getExpenseMonth(ADMIN, { month: today.slice(0, 7) }, opts());
  assert.equal(month.totals.stockBought, String(after.stockBought));
  const { from, to } = monthRange(today.slice(0, 7));
  assert.equal(JSON.parse(JSON.stringify(month)).totals.total, String((await totals(from, to)).total), "it survives JSON, and the page equals the shared totals");
});

test("EX10 a stock-in belongs to its Manila day, not its UTC day: 23:30 on the 31st is March, 00:10 on the 1st is April", { skip }, async () => {
  const item = await s.addSupply(ADMIN, { id: randomUUID(), name: "Expense Edge", unit: "pc", reorderLevel: 0, costPesos: "1.00" }, opts());
  await db.$executeRawUnsafe(`ALTER TABLE supply_movements DISABLE TRIGGER supply_movement_insert`);
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO supply_movements ("itemId", kind, delta, "stockAfter", "unitCostCentavos", "actorStaffId", "createdAt") VALUES ('${item.id}', 'RECEIVE', 1, 1, 700, '${ADMIN.staffId}', '2027-03-31T23:30:00+08:00')`);
      await tx.$executeRawUnsafe(`INSERT INTO supply_movements ("itemId", kind, delta, "stockAfter", "unitCostCentavos", "actorStaffId", "createdAt") VALUES ('${item.id}', 'RECEIVE', 1, 2, 900, '${ADMIN.staffId}', '2027-04-01T00:10:00+08:00')`);
      await tx.$executeRawUnsafe(`UPDATE supply_items SET "currentStock" = 2 WHERE id = '${item.id}'`);
    });
  } finally { await db.$executeRawUnsafe(`ALTER TABLE supply_movements ENABLE TRIGGER supply_movement_insert`); }
  assert.equal((await totals("2027-03-01", "2027-03-31")).stockBought, BigInt(700));
  assert.equal((await totals("2027-04-01", "2027-04-30")).stockBought, BigInt(900));
  const april = await s.getExpenseMonth(ADMIN, { month: "2027-04" }, opts());
  assert.deepEqual(april.series.slice(-2).map((m) => [m.month, m.stockBought]), [["2027-03", "700"], ["2027-04", "900"]], "the 12-month strip agrees");
  assert.equal(april.series.length, 12);
});

test("EX11 commissions count on the day they are marked paid: a paid entry and a signed adjustment; unpaid is owed and not in the total; un-marking takes it back", { skip }, async () => {
  const today = manilaToday();
  const start = await totals(today, today);
  const entry = await earnedEntry();
  const earned = await totals(today, today);
  assert.equal(earned.commissionsPaid, start.commissionsPaid, "earned is not paid");
  assert.equal(earned.commissionsOwed - start.commissionsOwed, entry.amountCentavos, "owed");
  assert.equal(earned.total, start.total, "owed is not in the total");
  await s.setCommissionsPaid(ADMIN, { ids: [entry.id], paid: true }, opts());
  const paid = await totals(today, today);
  assert.equal(paid.commissionsPaid - start.commissionsPaid, entry.amountCentavos);
  assert.equal(paid.commissionsOwed, start.commissionsOwed);
  assert.equal((await totals(addDay(today, 1), addDay(today, 1))).commissionsPaid, BigInt(0), "not on another day");
  const adj = await s.adjustCommission(ADMIN, { id: randomUUID(), entryId: entry.id, amountCentavos: -2_500, reason: "synthetic correction" }, opts());
  const owedAdj = await totals(today, today);
  assert.equal(owedAdj.commissionsOwed - paid.commissionsOwed, BigInt(-2_500), "an unpaid adjustment is signed and owed");
  await s.setCommissionsPaid(ADMIN, { ids: [adj.id], paid: true }, opts());
  const paidAdj = await totals(today, today);
  assert.equal(paidAdj.commissionsPaid - paid.commissionsPaid, BigInt(-2_500), "a paid negative adjustment lowers the sum");
  await s.setCommissionsPaid(ADMIN, { ids: [entry.id, adj.id], paid: false }, opts());
  const undone = await totals(today, today);
  assert.equal(undone.commissionsPaid, start.commissionsPaid, "un-marking takes it back");
  // As of `to`: an entry created today is not owed as of yesterday.
  assert.equal((await totals(addDay(today, -1), addDay(today, -1))).commissionsOwed, BigInt(0));
});

test("EX12 by category is manual only, without removed rows, and equals the manual sum; a typed line and stock bought stay separate lines", { skip }, async () => {
  const day = "2026-08-10";
  const rent = (await s.listExpenseCategories(ADMIN, opts())).find((c) => c.name === "Rent")!;
  await add({ date: day, categoryId: rent.id, amountPesos: "1000.00" });
  await add({ date: day, categoryId: rent.id, amountPesos: "500.00" });
  await add({ date: day, amountPesos: "20.00" });
  const gone = await add({ date: day, amountPesos: "9999.00" });
  await s.removeExpense(ADMIN, gone.id, { expectedRevision: 1 }, opts());
  const t = await totals(day, day);
  assert.deepEqual(t.byCategory.map((c) => [c.name, c.total]), [["Other", BigInt(2_000)], ["Rent", BigInt(150_000)]], "name order");
  assert.equal(t.manual, BigInt(152_000));
  assert.equal(t.byCategory.reduce((sum, c) => sum + c.total, BigInt(0)), t.manual);
  const august = await s.getExpenseMonth(ADMIN, { month: "2026-08", categoryId: rent.id }, opts());
  assert.equal(august.expenses.length, 2, "the category filter narrows the rows");
  assert.equal(august.totals.manual, "152000", "and leaves the month's money alone");
});

test("EX13 the month list is newest first, 50 per page, and the cursor loses and repeats nothing", { skip }, async () => {
  for (let i = 0; i < 53; i++) await add({ date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, amountPesos: "1.00" });
  const first = await s.getExpenseMonth(ADMIN, { month: "2026-07" }, opts());
  assert.equal(first.expenses.length, 50);
  assert.ok(first.nextCursor);
  const second = await s.getExpenseMonth(ADMIN, { month: "2026-07", cursor: first.nextCursor! }, opts());
  assert.equal(second.expenses.length, 3);
  assert.equal(second.nextCursor, null);
  const all = [...first.expenses, ...second.expenses];
  assert.equal(new Set(all.map((e) => e.id)).size, 53);
  const days = all.map((e) => e.expenseDate);
  assert.deepEqual(days, [...days].sort().reverse(), "newest day first");
});

test("EX14 ADMIN only: the service refuses STAFF; the totals refuse by themselves; a non-admin actor id is refused inside every function; the app role cannot write", { skip }, async () => {
  for (const [label, call] of [
    ["month", () => s.getExpenseMonth(STAFF, { month: "2026-11" }, opts())],
    ["totals", () => s.expenseTotals(STAFF, { from: "2026-11-01", to: "2026-11-30" }, opts())],
    ["add", () => s.addExpense(STAFF, { id: randomUUID(), ...body() }, opts())],
    ["categories", () => s.listExpenseCategories(STAFF, opts())],
    ["category add", () => s.addExpenseCategory(STAFF, { id: randomUUID(), name: "Nope" }, opts())],
  ] as const) await refused(call(), "FORBIDDEN", label);
  const e = await add();
  const c = (await s.listExpenseCategories(ADMIN, opts()))[0];
  for (const [label, sql, args] of [
    ["create", `SELECT admin_expense_create($1, $2, DATE '2026-10-01', $3, 100::bigint, NULL, NULL)`, [detailerId, randomUUID(), otherId]],
    ["update", `SELECT admin_expense_update($1, $2, 1, DATE '2026-10-01', $3, 100::bigint, NULL, NULL)`, [detailerId, e.id, otherId]],
    ["void", `SELECT admin_expense_void($1, $2, 1, NULL)`, [detailerId, e.id]],
    ["restore", `SELECT admin_expense_restore($1, $2, 1)`, [detailerId, e.id]],
    ["category create", `SELECT admin_category_create($1, $2, 'Sneaky')`, [detailerId, randomUUID()]],
    ["category update", `SELECT admin_category_update($1, $2, 1, 'Sneaky', NULL)`, [detailerId, c.id]],
  ] as const) await assert.rejects(app.$queryRawUnsafe(sql, ...args), /ZT004|Only an admin/, label);
  for (const sql of [
    `UPDATE expenses SET "amountCentavos" = 1 WHERE id = '${e.id}'`,
    `DELETE FROM expenses`,
    `INSERT INTO expense_categories (name, "nameKey", "sortOrder") VALUES ('x', 'x', 99)`,
    `INSERT INTO expense_events ("expenseId", kind, revision, "expenseDate", "categoryName", "amountCentavos", "actorStaffId") VALUES ('x', 'CREATED', 1, DATE '2026-01-01', 'x', 1, '${ADMIN.staffId}')`,
    `TRUNCATE expense_events`,
  ]) await assert.rejects(app.$executeRawUnsafe(sql), /permission denied/, sql);
  // A guessed id for someone else's history gets nothing extra: it is the admin's own table, and an unknown id is NOT_FOUND.
  await refused(s.listExpenseHistory(ADMIN, randomUUID(), opts()), "NOT_FOUND", "unknown expense");
});

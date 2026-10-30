// P1-29 admin deletes a booking, against real PostgreSQL as the runtime role (zeus_app) with the
// P1-02 booking model. Own sibling database (<T007 name>_delbk); synthetic data only; nothing is
// dropped. Without T007_TEST_DATABASE_URL these tests skip.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CatalogSelection } from "@/types/catalog-contracts";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "../catalog.fixture";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const delUrl = url ? siblingDatabaseUrl(url, "delbk") : "postgresql://unused@localhost/zeus_t007_unused_delbk";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: delUrl } } }); // owner: fixtures and trigger checks
let app: PrismaClient; // zeus_app: every service call and every "the app cannot" check

type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
const manifest = readManifest();
let releaseId = "";
let ADMIN: StaffActor, MANAGER: StaffActor, STAFF: StaffActor;
let seq = 0;
const NOW = new Date("2027-03-01T02:00:00.000Z");
const opts = () => ({ db: app, now: () => NOW });
const at = (day: string) => ({ db: app, now: () => new Date(day + "T02:00:00.000Z") });

const lit = (x: unknown): string => x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`;
async function insert(tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
}
const r0 = () => releaseFromManifest(manifest, releaseId);
const select = (size: string, ...lines: string[]): CatalogSelection => ({
  vehicleCategoryId: sizeId(r0(), size),
  lines: lines.map((l) => ({ serviceId: bySlug(r0(), l).id, quantity: 1 })),
});
const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
async function book(selection: CatalogSelection, day: string): Promise<{ id: string; reference: string }> {
  const priced = pricing.priceSelection(r0(), selection);
  assert.equal(priced.kind, "QUOTED");
  const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
  const id = randomUUID(), n = ++seq, reference = `ZEUS-D${String(n).padStart(5, "0")}`;
  const size = r0().sizes.find((x) => x.id === q.vehicleCategoryId)!;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
    const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
    await insert(tx, "bookings", { id, referenceCode: reference, customerName: `Zed Customer ${n}`, customerPhone: "+639170000777",
      customerEmail: `zed${n}@example.test`, vehicleModel: "Synthetic Roadster", vehiclePlate: "ZZZ9999", notes: "Gate code 4321", vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day,
      startsAt: dayStart(day), endsAt: new Date(Date.parse(dayStart(day)) + 86_400_000).toISOString(), status: "PENDING", priceSnapshot: q.totalPriceCentavos / 100,
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
  return { id, reference };
}
const rev = async (id: string) => (await db.booking.findUniqueOrThrow({ where: { id } })).revision;
const sha = (n: number) => String(n).padStart(64, "0").replace(/0/g, "a").slice(0, 63) + (n % 10);

// Every table that can point at a booking, with the column that does.
const CHILD_TABLES: [string, string][] = [
  ["booking_line_items", "bookingId"], ["booking_bay_assignments", "bookingId"], ["bay_occupancies", "bookingId"],
  ["booking_worker_assignments", "bookingId"], ["booking_deposit_proofs", "bookingId"], ["booking_notification_outbox", "bookingId"],
  ["booking_management_grants", "bookingId"], ["booking_management_sessions", "bookingId"], ["booking_operations", "bookingId"],
  ["booking_assignments", "bookingId"], ["commission_payouts", "bookingId"], ["inventory_transactions", "bookingId"],
];
async function counts(id: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [t, c] of CHILD_TABLES) out[t] = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t} WHERE "${c}"=${lit(id)}`))[0].n);
  out.booking = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM bookings WHERE id=${lit(id)}`))[0].n);
  out.turnstile = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM booking_turnstile_uses u JOIN booking_operations o ON o.id=u."operationId" WHERE o."bookingId"=${lit(id)}`))[0].n);
  out.audit = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM booking_audit_events WHERE "bookingId"=${lit(id)}`))[0].n);
  return out;
}
// Customer-facing rows the create and manage flows leave behind (owner inserts; the shapes are the real ones).
async function addCustomerRows(id: string, n: number) {
  await db.$executeRawUnsafe(`INSERT INTO booking_operations (id,"keyHash","kind","outcome","bookingId","requestHash","resultingRevision","credentialVersion","createdAt","recoveryExpiresAt") VALUES ($1,$2,'CREATE','COMMITTED',$3,$2,1,1,now(),now())`, "op-" + n, sha(n), id);
  await db.$executeRawUnsafe(`INSERT INTO booking_turnstile_uses ("tokenHash","operationId","expiresAt") VALUES ($1,$2,now()+interval '5 minutes')`, sha(n + 500), "op-" + n);
  await db.$executeRawUnsafe(`INSERT INTO booking_management_grants (id,"bookingId","credentialVersion",kid,"issuedAt","expiresAt") VALUES ($1,$2,1,'k1',now(),now()+interval '2 hours')`, "gr-" + n, id);
  await db.$executeRawUnsafe(`INSERT INTO booking_management_sessions (id,"bookingId","grantId","credentialVersion",kid,"grantKid","issuedAt","expiresAt") VALUES ($1,$2,$3,1,'k1','k1',now(),now()+interval '1 hour')`, "se-" + n, id, "gr-" + n);
  await db.$executeRawUnsafe(`INSERT INTO booking_notification_outbox (id,"bookingId",subject,text) VALUES ($1,$2,'Booking received','Hello Zed Customer')`, "ob-" + n, id);
  await db.$executeRawUnsafe(`INSERT INTO booking_deposit_proofs (id,"bookingId","keyHash","contentHash","clientHash","contentType","byteSize",width,height,data) VALUES ($1,$2,$3,$3,$3,'image/png',1,1,1,'\\x00')`, "pf-" + n, id, sha(n + 900));
}

before(async () => {
  if (skip) return;
  await createAndMigrate(root, delUrl);
  provisionRuntimeRole(delUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(delUrl) } } });
  pricing = await import("../catalog-pricing");
  s = await import("./index");
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, "p129-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  const manager = await db.staff.create({ data: { name: "Manager", phone: "", email: "p129-manager@example.test", role: "MANAGER" } });
  const detailer = await db.staff.create({ data: { name: "Detailer", phone: "", email: "p129-detailer@example.test", role: "DETAILER" } });
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  MANAGER = { staffId: manager.id, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=5, revision=revision+1, "updatedAt"=now()`);
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: import("./errors").AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as import("./errors").AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}

// Brings a fresh booking to the wanted status through the real services.
async function bookingAt(status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED", day: string) {
  const b = await book(select("S", "basic-wash"), day);
  const n = ++seq;
  if (status !== "CANCELLED") await addCustomerRows(b.id, n); // proofs need an open booking
  const o = at(day);
  if (status === "PENDING") return { ...b, n };
  if (status === "CANCELLED") {
    await s.declineBooking(ADMIN, b.id, { expectedRevision: await rev(b.id), reason: "Synthetic cancel" }, o);
    return { ...b, n };
  }
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "CONFIRMED" }, o);
  if (status === "CONFIRMED") return { ...b, n };
  const bay = await s.createBay(ADMIN, { name: "Bay " + n, sortOrder: n, bayType: "WASH" }, o);
  await s.setBay(ADMIN, b.id, { expectedRevision: await rev(b.id), date: day, bayId: bay.id }, o);
  await s.assignWorker(ADMIN, b.id, STAFF.staffId, { expectedRevision: await rev(b.id) }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "IN_PROGRESS" }, o);
  if (status === "IN_PROGRESS") return { ...b, n };
  for (const l of await db.bookingLineItem.findMany({ where: { bookingId: b.id } }))
    await s.setLineStatus(ADMIN, b.id, l.id, { expectedRevision: await rev(b.id), workStatus: "DONE" }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "COMPLETED" }, o);
  return { ...b, n };
}

for (const [i, status] of (["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).entries()) {
  test(`F1 an ADMIN deletes a ${status} booking and everything hanging off it; audit history survives without PII`, { skip }, async () => {
    const day = `2027-04-0${i + 1}`;
    const b = await bookingAt(status, day);
    if (status === "CONFIRMED") await s.setDepositStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "RECEIVED" }, at(day));
    const before = await counts(b.id);
    assert.equal(before.booking, 1);
    assert.ok(before.booking_line_items >= 1 && before.audit >= 0);
    if (status !== "CANCELLED") for (const t of ["booking_operations", "booking_management_grants", "booking_management_sessions", "booking_notification_outbox", "booking_deposit_proofs", "turnstile"])
      assert.ok(before[t] >= 1, `fixture has ${t}`);
    const oldAudit = await db.bookingAuditEvent.findMany({ where: { bookingId: b.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const result = await s.deleteBooking(ADMIN, b.id, { expectedRevision: await rev(b.id), reference: b.reference }, at(day));
    assert.deepEqual([result.deleted, result.reference], [true, b.reference]);
    const after = await counts(b.id);
    for (const [k, v] of Object.entries(after)) if (k !== "audit") assert.equal(v, 0, `${k} left rows behind`);
    // Old audit rows are untouched (still named by the booking id), plus exactly one deletion record.
    const rows = await db.bookingAuditEvent.findMany({ where: { bookingId: b.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    assert.equal(rows.length, oldAudit.length + 1);
    assert.deepEqual(rows.filter((r) => r.action !== "BOOKING_DELETED"), oldAudit);
    const del = rows.find((r) => r.action === "BOOKING_DELETED")!;
    assert.deepEqual([del.actorStaffId, del.bookingReference, del.fromStatus, del.queueCode, del.reason, del.phoneDigest, del.lineId],
      [ADMIN.staffId, b.reference, status, "WASH", null, null, null]);
    assert.ok((del.resultCount ?? 0) >= 1 && (del.newPriceCentavos ?? 0) > 0);
    // No customer name, phone, email, plate, vehicle or note anywhere in the deletion record.
    const text = JSON.stringify(del, (_k, v) => typeof v === "bigint" ? String(v) : v);
    for (const pii of ["Zed Customer", "639170000777", "example.test", "ZZZ9999", "Synthetic Roadster", "Gate code"]) assert.ok(!text.includes(pii), `deletion record leaked ${pii}`);
    await refused(s.getBookingDetail(ADMIN, b.id, opts()), "NOT_FOUND", "gone from detail");
    assert.equal(rows.every((r) => r.id.length > 0), true);
  });
}

test("F2 refusals change nothing: STAFF, stale revision, wrong reference, unknown booking, legacy money record", { skip }, async () => {
  const day = "2027-04-08";
  const b = await bookingAt("CONFIRMED", day);
  const snapshot = async () => JSON.stringify([await counts(b.id), await rev(b.id)]);
  const start = await snapshot();
  const good = { expectedRevision: await rev(b.id), reference: b.reference };
  await refused(s.deleteBooking(STAFF, b.id, good, opts()), "FORBIDDEN", "STAFF");
  await refused(s.deleteBooking(ADMIN, b.id, { ...good, expectedRevision: good.expectedRevision + 1 }, opts()), "VERSION_CONFLICT", "stale", (e) => assert.equal(e.currentBooking?.id, b.id));
  await refused(s.deleteBooking(ADMIN, b.id, { ...good, reference: b.reference.toLowerCase() }, opts()), "VALIDATION_ERROR", "reference is exact");
  await refused(s.deleteBooking(ADMIN, b.id, { ...good, reference: "ZEUS-NOPE" }, opts()), "VALIDATION_ERROR", "wrong reference");
  await refused(s.deleteBooking(ADMIN, b.id, { expectedRevision: good.expectedRevision }, opts()), "VALIDATION_ERROR", "reference required");
  await refused(s.deleteBooking(ADMIN, b.id, { ...good, extra: 1 }, opts()), "VALIDATION_ERROR", "strict body");
  await refused(s.deleteBooking(ADMIN, randomUUID(), good, opts()), "NOT_FOUND", "unknown");
  assert.equal(await snapshot(), start);
  // A payout record is money history: refuse, change nothing.
  await db.$executeRawUnsafe(`INSERT INTO commission_payouts (id,"bookingId","staffId","earnedAmount") VALUES ('cp-1',$1,$2,10)`, b.id, STAFF.staffId);
  const withPayout = await snapshot();
  await refused(s.deleteBooking(ADMIN, b.id, good, opts()), "BOOKING_NOT_MANAGEABLE", "legacy money record");
  assert.equal(await snapshot(), withPayout);
  assert.equal((await counts(b.id)).booking, 1);
  // The MANAGER role maps to ADMIN and may delete once the payout is gone.
  await db.$executeRawUnsafe(`DELETE FROM commission_payouts WHERE id='cp-1'`);
  assert.equal((await s.deleteBooking(MANAGER, b.id, good, opts())).deleted, true);
});

test("F3 deleting frees the time slot and the day cap", { skip }, async () => {
  const day = "2027-04-09";
  const made = [];
  for (let i = 0; i < 5; i++) made.push(await book(select("S", "basic-wash"), day));
  await assert.rejects(book(select("S", "basic-wash"), day), /cap|capacity/i, "the day is full");
  await s.deleteBooking(ADMIN, made[2].id, { expectedRevision: 1, reference: made[2].reference }, at(day));
  const again = await book(select("S", "basic-wash"), day);
  assert.ok(again.id, "a slot is free after the delete");
  const board = await s.getDayBoard(ADMIN, { date: day }, opts());
  const ids = JSON.stringify(board);
  assert.ok(!ids.includes(made[2].id), "no stale board card for the deleted booking");
});

test("F4 the app role cannot delete or alter any of these rows on its own", { skip }, async () => {
  const b = await bookingAt("IN_PROGRESS", "2027-04-10");
  const lineId = (await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: b.id } })).id;
  const denied: string[] = [
    `DELETE FROM bookings WHERE id='${b.id}'`,
    `DELETE FROM booking_line_items WHERE "bookingId"='${b.id}'`,
    `DELETE FROM booking_deposit_proofs WHERE "bookingId"='${b.id}'`,
    `DELETE FROM booking_notification_outbox WHERE "bookingId"='${b.id}'`,
    `DELETE FROM booking_management_grants WHERE "bookingId"='${b.id}'`,
    `DELETE FROM booking_management_sessions WHERE "bookingId"='${b.id}'`,
    `DELETE FROM booking_operations WHERE "bookingId"='${b.id}'`,
    `DELETE FROM booking_turnstile_uses`,
    `UPDATE booking_audit_events SET reason='x'`,
    `DELETE FROM booking_audit_events`,
    `TRUNCATE booking_audit_events`,
  ];
  for (const q of denied) await assert.rejects(app.$executeRawUnsafe(q), /permission denied/, q);
  // Even the table owner cannot rewrite the trail or the child rows without the audited path.
  const trig: [string, RegExp][] = [
    [`UPDATE booking_audit_events SET reason='x' WHERE "bookingId"='${b.id}'`, /append-only/],
    [`DELETE FROM booking_audit_events WHERE "bookingId"='${b.id}'`, /append-only/],
    [`DELETE FROM booking_line_items WHERE id='${lineId}'`, /append-only/],
    [`DELETE FROM booking_operations WHERE "bookingId"='${b.id}'`, /immutable/],
    [`DELETE FROM booking_management_sessions WHERE "bookingId"='${b.id}'`, /immutable/],
    [`DELETE FROM booking_management_grants WHERE "bookingId"='${b.id}'`, /immutable/],
    [`DELETE FROM bay_occupancies WHERE "bookingId"='${b.id}'`, /Board relation|revision/],
    [`DELETE FROM booking_worker_assignments WHERE "bookingId"='${b.id}'`, /Board relation|revision/],
  ];
  for (const [q, re] of trig) await assert.rejects(db.$transaction(async (tx) => { await tx.$executeRawUnsafe(q); await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE"); }), re, q);
  assert.equal((await counts(b.id)).booking, 1);
});

test("F5 the token alone, the audit row alone, or the wrong booking's pair never opens the delete path", { skip }, async () => {
  const a = await bookingAt("CONFIRMED", "2027-04-11"), c = await bookingAt("CONFIRMED", "2027-04-11");
  const lineA = (await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: a.id } })).id;
  const auditRow = (id: string) => `INSERT INTO booking_audit_events (id,action,"actorStaffId","bookingId","fromStatus","resultCount","bookingReference") VALUES (gen_random_uuid()::text,'BOOKING_DELETED','${ADMIN.staffId}','${id}','CONFIRMED',1,'ZEUS-X1')`;
  const marker = (id: string) => `INSERT INTO booking_delete_tokens ("txId","bookingId") VALUES (txid_current(),'${id}')`; // the owner-only token
  const tryDelete = (steps: string[], q: string) => db.$transaction(async (tx) => { for (const x of steps) await tx.$executeRawUnsafe(x); await tx.$executeRawUnsafe(q); });
  const del = `DELETE FROM booking_line_items WHERE id='${lineA}'`;
  await assert.rejects(tryDelete([marker(a.id)], del), /append-only/, "token without the audit row");
  await assert.rejects(tryDelete([auditRow(a.id)], del), /append-only/, "audit row without the token");
  await assert.rejects(tryDelete([marker(c.id), auditRow(c.id)], del), /append-only/, "another booking's pair");
  await assert.rejects(tryDelete([marker(a.id), auditRow(c.id)], del), /append-only/, "token for one, audit row for another");
  // The audit row of an earlier transaction does not count either.
  await db.$executeRawUnsafe(auditRow(a.id));
  await assert.rejects(tryDelete([marker(a.id)], del), /append-only/, "audit row from another transaction");
  assert.equal((await counts(a.id)).booking_line_items >= 1, true);
  assert.equal((await counts(c.id)).booking, 1);
});

test("F6 delete_booking itself: runtime role only, ADMIN actor only, wrong inputs raise their own codes", { skip }, async () => {
  const b = await bookingAt("PENDING", "2027-04-12");
  const call = (actor: string, revision: number, reference: string) =>
    app.$queryRawUnsafe(`SELECT delete_booking($1,$2,$3::integer,$4)`, b.id, actor, revision, reference);
  await assert.rejects(call(STAFF.staffId, 1, b.reference), /Only an admin/, "detailer");
  await assert.rejects(call(randomUUID(), 1, b.reference), /Only an admin/, "unknown actor");
  await assert.rejects(call(ADMIN.staffId, 99, b.reference), /Booking changed/, "stale");
  await assert.rejects(call(ADMIN.staffId, 1, "nope"), /Reference code/, "reference");
  const [acl] = await db.$queryRawUnsafe<{ acl: string }[]>(`SELECT proacl::text AS acl FROM pg_proc WHERE proname='delete_booking'`);
  assert.ok(/zeus_app=X\//.test(acl.acl) && !/(^\{|,)=X\//.test(acl.acl), `only zeus_app and the owner can execute: ${acl.acl}`);
  assert.equal((await counts(b.id)).booking, 1);
});

test("F7 an app session cannot open the delete path: a forged audit row and marker delete no child row, and the token table is closed to it", { skip }, async () => {
  const b = await bookingAt("IN_PROGRESS", "2027-04-20"); // has a bay occupancy and a worker too
  assert.equal((await counts(b.id)).bay_occupancies, 1);
  assert.equal((await counts(b.id)).booking_worker_assignments, 1);
  const forge = `INSERT INTO booking_audit_events (id,action,"actorStaffId","bookingId","fromStatus","resultCount","bookingReference") VALUES (gen_random_uuid()::text,'BOOKING_DELETED','${ADMIN.staffId}','${b.id}','IN_PROGRESS',1,'${b.reference}')`;
  const marker = `SELECT set_config('zeus.deleting_booking','${b.id}',true)`;
  const denied = /permission denied/, board = /Board relation/;
  const cases: [string, string, RegExp][] = [
    ["booking_line_items", '"bookingId"', denied], ["booking_operations", '"bookingId"', denied],
    ["booking_management_sessions", '"bookingId"', denied], ["booking_management_grants", '"bookingId"', denied],
    ["booking_notification_outbox", '"bookingId"', denied], ["booking_deposit_proofs", '"bookingId"', denied],
    // (booking_bay_assignments is plain bay history the app may already delete; it has no audit gate, so it is not a case here.)
    ["bookings", "id", denied],
    // zeus_app may delete these two through the normal audited path; the forged pair must not skip that audit.
    ["bay_occupancies", '"bookingId"', board], ["booking_worker_assignments", '"bookingId"', board],
  ];
  for (const [table, col, re] of cases) {
    await assert.rejects(app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(forge);
      await tx.$queryRawUnsafe(marker);
      await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE ${col}='${b.id}'`);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    }), re, table);
  }
  // The app cannot write, read or change the token table at all.
  for (const q of [`INSERT INTO booking_delete_tokens ("txId","bookingId") VALUES (txid_current(),'${b.id}')`, "SELECT * FROM booking_delete_tokens", "DELETE FROM booking_delete_tokens"])
    await assert.rejects(app.$executeRawUnsafe(q), denied, q);
  const after = await counts(b.id);
  assert.deepEqual([after.booking, after.booking_line_items >= 1, after.bay_occupancies, after.booking_worker_assignments], [1, true, 1, 1]);
  assert.equal(await db.bookingAuditEvent.count({ where: { bookingId: b.id, action: "BOOKING_DELETED" } }), 0, "the forged rows rolled back");
  assert.equal(Number((await db.$queryRawUnsafe<{ n: bigint }[]>("SELECT count(*) AS n FROM booking_delete_tokens"))[0].n), 0, "no token is left behind");
});

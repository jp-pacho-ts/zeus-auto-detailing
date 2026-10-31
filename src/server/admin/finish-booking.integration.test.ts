// P1-34: an admin finishes a car (all services done, booking completed) in one transaction, as the runtime role.
// P1-02 booking model. Own sibling database (<T007 name>_finishb); synthetic data only; nothing is
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
const delUrl = url ? siblingDatabaseUrl(url, "finishb") : "postgresql://unused@localhost/zeus_t007_unused_finishb";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: delUrl } } }); // owner: fixtures and trigger checks
let app: PrismaClient; // zeus_app: every service call and every "the app cannot" check

type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
const manifest = readManifest();
let releaseId = "";
let ADMIN: StaffActor, STAFF: StaffActor;
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

const svc = (slug: string) => bySlug(r0(), slug).id;
before(async () => {
  if (skip) return;
  await createAndMigrate(root, delUrl);
  provisionRuntimeRole(delUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(delUrl) } } });
  pricing = await import("../catalog-pricing");
  s = await import("./index");
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, "p134-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  const detailer = await db.staff.create({ data: { name: "Detailer", phone: "", email: "p134-detailer@example.test", role: "DETAILER" } });
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

let bayNo = 0;
const rev = async (id: string) => (await db.booking.findUniqueOrThrow({ where: { id } })).revision;
const dayOf = (n: number) => `2027-06-${String(10 + n).padStart(2, "0")}`;
// A booking with a wash, a for-quote coating and a removed add-on, seated in a bay on its day.
async function seated(n: number, how: "PENDING" | "CONFIRMED" | "IN_PROGRESS", extraLines = true) {
  const day = dayOf(n), o = at(day);
  const b = await book(select("S", "basic-wash"), day);
  if (extraLines) {
    await s.addLine(ADMIN, b.id, { expectedRevision: await rev(b.id), serviceId: svc("arcane-graphene"), quantity: 1 }, o);
    const withAddOn = await s.addLine(ADMIN, b.id, { expectedRevision: await rev(b.id), serviceId: svc("bac-to-zero"), quantity: 1 }, o);
    const addOn = withAddOn.booking.lines.find((l) => l.serviceId === svc("bac-to-zero"))!;
    await s.removeLine(ADMIN, b.id, addOn.id, { expectedRevision: await rev(b.id), reason: "Customer declined" }, o);
  }
  if (how !== "PENDING") await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "CONFIRMED" }, o);
  const bay = await s.createBay(ADMIN, { name: "Finish Bay " + ++bayNo, sortOrder: 100 + bayNo, bayType: "WASH" }, o);
  await s.setBay(ADMIN, b.id, { expectedRevision: await rev(b.id), date: day, bayId: bay.id }, o);
  if (how === "IN_PROGRESS") {
    await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "IN_PROGRESS" }, o);
    const wash = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: b.id, serviceId: svc("basic-wash") } });
    await s.setLineStatus(ADMIN, b.id, wash.id, { expectedRevision: await rev(b.id), workStatus: "DONE" }, o);
  }
  return { ...b, day, bay };
}
const snapshot = async (id: string) => {
  const row = await db.booking.findUniqueOrThrow({ where: { id } });
  return JSON.stringify([
    row.revision, row.status,
    (await db.bookingLineItem.findMany({ where: { bookingId: id }, orderBy: { order: "asc" }, select: { workStatus: true, removedAt: true } })).map((l) => [l.workStatus, l.removedAt !== null]),
    await db.bookingAuditEvent.count({ where: { bookingId: id } }),
    await db.bayOccupancy.count({ where: { bookingId: id } }),
  ]);
};
async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: import("./errors").AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as import("./errors").AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}

test("F1 finishing an in-service car marks every active service done and completes it, in one transaction", { skip }, async () => {
  const b = await seated(1, "IN_PROGRESS");
  const before = await db.bookingAuditEvent.count({ where: { bookingId: b.id } });
  const from = await rev(b.id);
  const out = await s.finishBooking(ADMIN, b.id, { expectedRevision: from }, at(b.day));
  assert.deepEqual([out.noChange, out.booking.status, out.booking.revision], [false, "COMPLETED", from + 1]);
  const lines = await db.bookingLineItem.findMany({ where: { bookingId: b.id }, orderBy: { order: "asc" } });
  assert.deepEqual(lines.map((l) => [l.workStatus, l.removedAt !== null]), [["DONE", false], ["DONE", false], ["WAITING", true]], "active lines done, the removed one untouched");
  const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
  assert.ok(row.terminalAt, "terminal time set");
  assert.equal(await db.bayOccupancy.count({ where: { bookingId: b.id } }), 0, "the bay is free");
  const added = (await db.bookingAuditEvent.findMany({ where: { bookingId: b.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).slice(before);
  assert.deepEqual(added.map((a) => a.action).sort(), ["BAY_UNASSIGNED", "LINE_STATUS_CHANGED", "STATUS_CHANGED"], "one row for the one changed line, one for the status, one for the bay");
  const status = added.find((a) => a.action === "STATUS_CHANGED")!;
  assert.deepEqual([status.fromStatus, status.toStatus, status.fromRevision, status.toRevision], ["IN_PROGRESS", "COMPLETED", from, from + 1]);
  assert.equal(new Set(added.map((a) => String(a.txId))).size, 1, "all rows came from one transaction");
  assert.ok(added.every((a) => a.actorStaffId === ADMIN.staffId));
});

test("F2 a car seated in a bay but not started can be finished too, from CONFIRMED and from PENDING", { skip }, async () => {
  for (const [n, how] of [[2, "CONFIRMED"], [3, "PENDING"]] as const) {
    const b = await seated(n, how);
    const from = await rev(b.id);
    const out = await s.finishBooking(ADMIN, b.id, { expectedRevision: from }, at(b.day));
    assert.deepEqual([out.booking.status, out.booking.revision], ["COMPLETED", from + 1], how);
    const lines = await db.bookingLineItem.findMany({ where: { bookingId: b.id, removedAt: null } });
    assert.ok(lines.length >= 2 && lines.every((l) => l.workStatus === "DONE"), how + ": every active line done");
    const status = await db.bookingAuditEvent.findFirstOrThrow({ where: { bookingId: b.id, action: "STATUS_CHANGED", toStatus: "COMPLETED" } });
    assert.equal(status.fromStatus, how);
  }
});

test("F3 every refusal changes nothing: Waiting car, finished, cancelled, STAFF, stale revision, before the booked day", { skip }, async () => {
  const waiting = await book(select("S", "basic-wash"), dayOf(4));
  await s.setBookingStatus(ADMIN, waiting.id, { expectedRevision: 1, status: "CONFIRMED" }, at(dayOf(4)));
  let snap = await snapshot(waiting.id);
  await refused(s.finishBooking(ADMIN, waiting.id, { expectedRevision: 2 }, at(dayOf(4))), "BOOKING_NOT_MANAGEABLE", "Waiting, no bay", (e) => assert.equal(e.message, "Move this car into a bay before finishing it."));
  assert.equal(await snapshot(waiting.id), snap);

  const done = await seated(5, "IN_PROGRESS");
  await s.finishBooking(ADMIN, done.id, { expectedRevision: await rev(done.id) }, at(done.day));
  snap = await snapshot(done.id);
  await refused(s.finishBooking(ADMIN, done.id, { expectedRevision: await rev(done.id) }, at(done.day)), "BOOKING_NOT_MANAGEABLE", "already finished");
  assert.equal(await snapshot(done.id), snap);

  const cancelled = await book(select("S", "basic-wash"), dayOf(6));
  await s.declineBooking(ADMIN, cancelled.id, { expectedRevision: 1, reason: "No stock" }, at(dayOf(6)));
  snap = await snapshot(cancelled.id);
  await refused(s.finishBooking(ADMIN, cancelled.id, { expectedRevision: await rev(cancelled.id) }, at(dayOf(6))), "BOOKING_NOT_MANAGEABLE", "cancelled");
  assert.equal(await snapshot(cancelled.id), snap);

  const car = await seated(7, "IN_PROGRESS");
  snap = await snapshot(car.id);
  await refused(s.finishBooking(STAFF, car.id, { expectedRevision: await rev(car.id) }, at(car.day)), "FORBIDDEN", "STAFF");
  await refused(s.finishBooking(ADMIN, car.id, { expectedRevision: (await rev(car.id)) + 5 }, at(car.day)), "VERSION_CONFLICT", "stale", (e) => assert.equal(e.currentBooking?.id, car.id));
  await refused(s.finishBooking(ADMIN, car.id, { expectedRevision: await rev(car.id), extra: 1 }, at(car.day)), "VALIDATION_ERROR", "strict body");
  await refused(s.finishBooking(ADMIN, randomUUID(), { expectedRevision: 1 }, at(car.day)), "NOT_FOUND", "unknown");
  // P1-28: the day before its booked day, the existing refusal and nothing written.
  await refused(s.finishBooking(ADMIN, car.id, { expectedRevision: await rev(car.id) }, at(dayOf(6))), "BOOKING_NOT_MANAGEABLE", "before the booked day");
  assert.equal(await snapshot(car.id), snap);
  assert.equal((await db.booking.findUniqueOrThrow({ where: { id: car.id } })).status, "IN_PROGRESS");
});

test("F4 a service already done costs no audit row; finishing is terminal (nothing reopens it)", { skip }, async () => {
  const b = await seated(8, "IN_PROGRESS", false);
  const before = await db.bookingAuditEvent.count({ where: { bookingId: b.id } });
  await s.finishBooking(ADMIN, b.id, { expectedRevision: await rev(b.id) }, at(b.day));
  const added = (await db.bookingAuditEvent.count({ where: { bookingId: b.id } })) - before;
  assert.equal(added, 2, "the only line was already done: one status row and one bay row, no line row");
  for (const status of ["IN_PROGRESS", "CONFIRMED", "PENDING"] as const)
    await assert.rejects(s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status }, at(b.day)), /./, "a finished booking cannot be reopened: " + status);
  const line = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: b.id } });
  await assert.rejects(s.setLineStatus(ADMIN, b.id, line.id, { expectedRevision: await rev(b.id), workStatus: "WAITING" }, at(b.day)), /./, "a finished booking's lines cannot be reopened");
});

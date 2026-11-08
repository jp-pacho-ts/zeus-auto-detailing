// P1-40 Sales & Analytics: jobs are finished through the real services as the runtime role (zeus_app) against real PostgreSQL
// with the real migrations. Own sibling database (<T007 name>_analytics); synthetic data only; nothing is dropped. Without
// T007_TEST_DATABASE_URL the tests skip. Fixtures use the owner client (db); every service call uses the app client.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CatalogSelection } from "@/types/catalog-contracts";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "../catalog.fixture";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { AdminServiceError } from "./errors";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const analyticsUrl = url ? siblingDatabaseUrl(url, "analytics") : "postgresql://unused@localhost/zeus_t007_unused_analytics";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: analyticsUrl } } }); // owner
let app: PrismaClient; // zeus_app
type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
const manifest = readManifest();
let tooling: { stableId(k: string): string; rollbackManifest(m: typeof manifest, version: string): typeof manifest };
let releaseId = "";
let ADMIN: StaffActor;
let seq = 0;
const at = (day: string) => ({ db: app, now: () => new Date(day + "T02:00:00.000Z") });

const lit = (x: unknown): string => (x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`);
async function insert(tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
}
const r0 = () => releaseFromManifest(manifest, releaseId);
const washOnly = (): CatalogSelection => ({ vehicleCategoryId: sizeId(r0(), "S"), lines: [{ serviceId: bySlug(r0(), "basic-wash").id, quantity: 1 }] });
const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();

async function book(day: string): Promise<{ id: string; reference: string }> {
  const priced = pricing.priceSelection(r0(), washOnly());
  assert.equal(priced.kind, "QUOTED");
  const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
  const id = randomUUID(), n = ++seq, reference = `ZEUS-N${String(n).padStart(5, "0")}`;
  const size = r0().sizes.find((x) => x.id === q.vehicleCategoryId)!;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
    const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
    await insert(tx, "bookings", { id, referenceCode: reference, customerName: `Zed Customer ${n}`, customerPhone: "+639170000888",
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
const lineOf = (bookingId: string, slug: string) => db.bookingLineItem.findFirstOrThrow({ where: { bookingId, serviceId: bySlug(r0(), slug).id, removedAt: null } });
async function addService(id: string, day: string, slug: string, price?: number) {
  await s.addLine(ADMIN, id, { expectedRevision: await rev(id), serviceId: bySlug(r0(), slug).id, quantity: 1 }, at(day));
  if (price !== undefined) await s.setLinePrice(ADMIN, id, (await lineOf(id, slug)).id, { expectedRevision: await rev(id), priceCentavos: price, reason: "P1-40 test price" }, at(day));
}
async function start(id: string, day: string, workers: string[] = []) {
  const o = at(day);
  await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(id), status: "CONFIRMED" }, o);
  const n = ++seq;
  const bay = await s.createBay(ADMIN, { name: "Bay " + n, sortOrder: n, bayType: "WASH" }, o);
  await s.setBay(ADMIN, id, { expectedRevision: await rev(id), date: day, bayId: bay.id }, o);
  for (const w of workers) await s.assignWorker(ADMIN, id, w, { expectedRevision: await rev(id) }, o);
  await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(id), status: "IN_PROGRESS" }, o);
}
async function finish(id: string, day: string) {
  const o = at(day);
  for (const l of await db.bookingLineItem.findMany({ where: { bookingId: id, removedAt: null } }))
    await s.setLineStatus(ADMIN, id, l.id, { expectedRevision: await rev(id), workStatus: "DONE" }, o);
  await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(id), status: "COMPLETED" }, o);
}
// A job booked on `day` and finished at the exact instant given (the services stamp the real clock, so the fixture moves it).
async function finishedAt(instant: string, day: string, build?: (id: string) => Promise<void>, workers: string[] = []) {
  const b = await book(day);
  await build?.(b.id);
  await start(b.id, day, workers);
  await finish(b.id, day);
  await db.$executeRawUnsafe(`UPDATE bookings SET "terminalAt" = ${lit(instant)}::timestamptz, revision = revision + 1 WHERE id = ${lit(b.id)}`);
  return b;
}
const manila = (day: string, time = "10:00:00.000") => `${day}T${time}+08:00`;
const read = (from: string, to: string, today = to) => s.getAnalytics(ADMIN, { from, to }, { db: app, now: () => new Date(`${today}T04:00:00.000Z`) });
const WASH_S = () => { const q = pricing.priceSelection(r0(), washOnly()); return q.kind === "QUOTED" ? q.quote.totalPriceCentavos : 0; };

async function refused(p: Promise<unknown>, code: string, label: string) {
  await assert.rejects(p, (e: unknown) => { assert.equal((e as AdminServiceError).code, code, `${label}: ${String((e as Error).message)}`); return true; }, label);
}

before(async () => {
  if (skip) return;
  await createAndMigrate(root, analyticsUrl);
  provisionRuntimeRole(analyticsUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(analyticsUrl) } } });
  pricing = await import("../catalog-pricing");
  s = await import("./index");
  tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as typeof tooling;
  const adminId = await mapPublisher(db, "p140-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

test("A1 Manila midnight: 23:59:59.999 on the last day stays in that month, 00:00:00.000 on the first belongs to the next (runs as zeus_app)", { skip }, async () => {
  const last = await finishedAt(manila("2028-01-31", "23:59:59.999"), "2028-01-31");
  const first = await finishedAt(manila("2028-02-01", "00:00:00.000"), "2028-01-31");
  const january = await read("2028-01-01", "2028-01-31");
  assert.equal(january.finishedJobs, 1);
  assert.equal(january.buckets.rows.find((b) => b.start === "2028-01-31")!.jobs, 1);
  assert.equal(january.revenueCentavos, WASH_S());
  const february = await read("2028-02-01", "2028-02-29");
  assert.equal(february.finishedJobs, 1);
  assert.equal(february.buckets.rows.find((b) => b.start === "2028-02-01")!.jobs, 1);
  assert.ok(last.id && first.id);
});

test("A2 a job counts on the day it was finished, not the day it was booked", { skip }, async () => {
  await finishedAt(manila("2028-03-11"), "2028-03-10");
  const march = await read("2028-03-01", "2028-03-31");
  assert.equal(march.buckets.rows.find((b) => b.start === "2028-03-10")!.jobs, 0);
  assert.equal(march.buckets.rows.find((b) => b.start === "2028-03-11")!.jobs, 1);
  assert.equal(march.bookingsByStatus.COMPLETED, 1, "the status list goes by the booked day");
});

test("A3 revenue for a booking equals the total on its own booking screen, with a set price and a removed service", { skip }, async () => {
  const day = "2028-04-10";
  const { id } = await finishedAt(manila(day), day, async (bookingId) => {
    await addService(bookingId, day, "regular-tint", 123_45);
    await addService(bookingId, day, "premium-wash", 999_00);
    await s.removeLine(ADMIN, bookingId, (await lineOf(bookingId, "premium-wash")).id, { expectedRevision: await rev(bookingId) }, at(day));
  });
  const april = await read("2028-04-01", "2028-04-30");
  const detail = await s.getBookingDetail(ADMIN, id, at(day));
  assert.equal(april.revenueCentavos, detail.totals.currentTotalCentavos);
  assert.equal(april.revenueCentavos, WASH_S() + 123_45);
  assert.equal(april.averageJobCentavos, WASH_S() + 123_45);
  assert.deepEqual(april.byGroup.map((g) => g.code).sort(), ["TINT", "WASH"]);
  assert.deepEqual(april.byQueue.map((q) => q.code).sort(), ["TINT_PPF", "WASH"]);
  for (const part of [april.byGroup, april.byQueue]) assert.equal(part.reduce((a, b) => a + b.revenueCentavos, 0), april.revenueCentavos);
  assert.equal(april.topServices.some((t) => t.name.toLowerCase().includes("premium")), false, "the removed service is gone");
});

test("A4 only finished jobs count; every other status is listed by the booked day and adds no money", { skip }, async () => {
  const day = "2028-05-10";
  await book(day); // stays PENDING
  const confirmed = await book(day);
  await s.setBookingStatus(ADMIN, confirmed.id, { expectedRevision: await rev(confirmed.id), status: "CONFIRMED" }, at(day));
  const working = await book(day);
  await start(working.id, day);
  const declined = await book(day);
  await s.declineBooking(ADMIN, declined.id, { expectedRevision: await rev(declined.id), reason: "P1-40 test" }, at(day));
  await finishedAt(manila(day), day);
  const may = await read("2028-05-01", "2028-05-31");
  assert.deepEqual(may.bookingsByStatus, { PENDING: 1, CONFIRMED: 1, IN_PROGRESS: 1, COMPLETED: 1, CANCELLED: 1 });
  assert.equal(may.finishedJobs, 1);
  assert.equal(may.revenueCentavos, WASH_S());
});

test("A5 an unpriced for-quote service adds nothing, the job is listed by reference and left out of the average; a price set before finishing counts", { skip }, async () => {
  const day = "2028-06-10";
  const short = await finishedAt(manila(day), day, (id) => addService(id, day, "arcane-graphene"));
  const priced = await finishedAt(manila(day), day, (id) => addService(id, day, "arcane-graphene", 500_000));
  const june = await read("2028-06-01", "2028-06-30");
  assert.equal(june.revenueCentavos, WASH_S() * 2 + 500_000);
  assert.deepEqual(june.unpriced, { jobs: 1, references: [short.reference] });
  assert.equal(june.fullyPricedJobs, 1);
  assert.equal(june.averageJobCentavos, WASH_S() + 500_000, priced.reference);
});

test("A6 a deleted finished job leaves the money and is counted; a job with a commission entry cannot be deleted and stays", { skip }, async () => {
  const day = "2028-07-10";
  const worker = await s.addPerson(ADMIN, { name: "P1-40 Worker" }, { db: app });
  const kept = await finishedAt(manila(day), day, (id) => addService(id, day, "regular-tint", 50_000), [worker.id]);
  const gone = await finishedAt(manila(day), day);
  const before = await read("2028-07-01", "2028-07-31");
  assert.equal(before.finishedJobs, 2);
  assert.equal(before.notCounted.deletedFinished, 0);
  await refused(s.deleteBooking(ADMIN, kept.id, { expectedRevision: await rev(kept.id), reference: kept.reference }, at(day)), "BOOKING_NOT_MANAGEABLE", "commission entry");
  await s.deleteBooking(ADMIN, gone.id, { expectedRevision: await rev(gone.id), reference: gone.reference }, at(day));
  const afterDelete = await read("2028-07-01", "2028-07-31");
  assert.equal(afterDelete.finishedJobs, 1);
  assert.equal(afterDelete.revenueCentavos, before.revenueCentavos - WASH_S());
  assert.equal(afterDelete.notCounted.deletedFinished, 1);
  assert.equal((await read("2028-08-01", "2028-08-31")).notCounted.deletedFinished, 0, "only in its own period");
});

test("A7 older-model finished bookings are not in the money and are counted", { skip }, async () => {
  const baseline = (await read("2028-09-01", "2028-09-30")).notCounted.olderFinished;
  const priced = pricing.priceSelection(r0(), washOnly());
  const q = priced.kind === "QUOTED" ? priced.quote : (null as never), line = q.lines[0], id = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
    await insert(tx, "bookings", { id, referenceCode: "ZEUS-OLD001", customerName: "Synthetic historical", customerPhone: "+639170000001", vehicleModel: "Synthetic",
      vehicleCategoryId: q.vehicleCategoryId, serviceId: line.serviceId, bookingDate: "2028-09-10", startTime: "08:00", endTime: "08:30", startsAt: "2028-09-10T00:00:00Z", endsAt: "2028-09-10T00:30:00Z", durationMinutes: 30,
      priceSnapshot: 180, serviceNameSnapshot: line.name, vehicleCategoryNameSnapshot: "Small", idempotencyKey: randomUUID(), requestHash: "historical", updatedAt: new Date().toISOString(), status: "IN_PROGRESS", snapshotVersion: "LEGACY_V1" });
  });
  await s.setBookingStatus(ADMIN, id, { expectedRevision: 1, status: "COMPLETED" }, at("2028-09-10"));
  await db.$executeRawUnsafe(`UPDATE bookings SET "terminalAt" = ${lit(manila("2028-09-10"))}::timestamptz WHERE id = ${lit(id)}`);
  const september = await read("2028-09-01", "2028-09-30");
  assert.equal(september.finishedJobs, 0);
  assert.equal(september.revenueCentavos, 0);
  assert.equal(september.notCounted.olderFinished, baseline + 1);
});

test("A8 commission figures equal the Team screen and stock figures equal the Supplies screen", { skip }, async () => {
  const worker = await s.addPerson(ADMIN, { name: "P1-40 Earner" }, { db: app });
  await finishedAt(manila("2028-10-10"), "2028-10-10", (id) => addService(id, "2028-10-10", "regular-tint", 100_000), [worker.id]);
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const figures = await s.getAnalytics(ADMIN, { from: today, to: today }, { db: app });
  const team = await s.listCommissions(ADMIN, { from: today, to: today }, { db: app });
  assert.ok(team.grandTotal.earnedCentavos > 0, "the fixture earned commission today (the accrual stamps the real clock)");
  assert.equal(figures.commissions.earnedCentavos, team.grandTotal.earnedCentavos);
  assert.equal(figures.commissions.unpaidCentavos, team.grandTotal.unpaidCentavos);
  assert.equal(figures.commissions.startsAt, team.settings.startsAt);
  await s.addSupply(ADMIN, { id: randomUUID(), name: "P1-40 Wax", unit: "bottle", reorderLevel: 2, costPesos: "12.50" }, { db: app });
  const supply = await s.addSupply(ADMIN, { id: randomUUID(), name: "P1-40 Soap", unit: "bottle", reorderLevel: 0, costPesos: "2.00" }, { db: app });
  await s.recordStock(ADMIN, supply.id, { id: randomUUID(), kind: "RECEIVE", quantity: 3, expectedRevision: supply.revision }, { db: app });
  const supplies = await s.listSupplies(ADMIN, {}, { db: app });
  const stock = (await read("2028-10-01", "2028-10-31")).stock;
  assert.equal(stock.lowOrOutCount, supplies.lowOrOutCount);
  assert.equal(stock.valueCentavos, 600);
});

test("A9 the figures hold no customer details", { skip }, async () => {
  const text = JSON.stringify(await read("2028-01-01", "2028-12-31"));
  for (const pii of ["Zed Customer", "639170000888", "example.test", "ZZZ9999", "Synthetic Roadster", "Gate code"]) assert.ok(!text.includes(pii), `the figures leaked ${pii}`);
});

test("A10 only an admin can read it, and a bad range is refused with a plain message", { skip }, async () => {
  await refused(s.getAnalytics({ ...ADMIN, role: "STAFF" }, { from: "2028-01-01", to: "2028-01-31" }, { db: app }), "FORBIDDEN", "staff");
  await refused(s.getAnalytics(ADMIN, { from: "2028-02-01", to: "2028-01-31" }, { db: app }), "VALIDATION_ERROR", "reversed");
  await refused(s.getAnalytics(ADMIN, { from: "2026-01-01", to: "2027-01-02" }, { db: app }), "VALIDATION_ERROR", "over a year");
  await refused(s.getAnalytics(ADMIN, { from: "2028-02-30", to: "2028-03-01" }, { db: app }), "VALIDATION_ERROR", "no such day");
  await refused(s.getAnalytics(ADMIN, { from: "2028-01-01", to: "2028-01-31", extra: "1" }, { db: app }), "VALIDATION_ERROR", "extra field");
  await refused(s.getAnalytics(ADMIN, {}, { db: app }), "VALIDATION_ERROR", "missing dates");
});

test("A11 a line keeps the queue and name it was sold under after a later catalog release moves the service", { skip }, async () => {
  const day = "2028-11-10";
  await finishedAt(manila(day), day, (id) => addService(id, day, "headlight-restoration", 70_000));
  const moved = tooling.rollbackManifest(manifest, "p1-40-moved");
  const service = moved.services.find((x: { slug: string }) => x.slug === "headlight-restoration") as unknown as { name: string; queueCode: string };
  const soldAs = service.name;
  Object.assign(service, { name: "Renamed Headlights", queueCode: "REPAINT" });
  await publish(db, moved, tooling.stableId, "P1-40 move after sale");
  const november = await read("2028-11-01", "2028-11-30");
  assert.deepEqual(november.byQueue.map((q) => [q.code, q.revenueCentavos]), [["DETAILING_COATING", 70_000], ["WASH", WASH_S()]]);
  assert.equal(november.byGroup.find((g) => g.code === "DETAILING")!.revenueCentavos, 70_000);
  assert.equal(november.topServices[0].name, soldAs, "the name it was sold under");
});

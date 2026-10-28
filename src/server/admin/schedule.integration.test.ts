// P1-20 admin calendar, opening hours and closed days against real PostgreSQL. Uses its own
// sibling database (<T007 name>_schedule), provisions zeus_app with prisma/sql/runtime-role.sql
// and runs every service call as zeus_app; fixtures keep the owner client. Synthetic data only;
// nothing is dropped. Without T007_TEST_DATABASE_URL these tests skip.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CatalogSelection } from "@/types/catalog-contracts";
import type { AdminWeekdayHours } from "@/lib/admin-schedule";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "../catalog.fixture";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const ownerUrl = url ? siblingDatabaseUrl(url, "schedule") : "postgresql://unused@localhost/zeus_t007_unused_schedule";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
let app: PrismaClient;

let s: typeof import("./index");
let pricing: typeof import("../catalog-pricing");
let days: typeof import("../availability-days");
const manifest = readManifest();
let releaseId = "";
let ADMIN: StaffActor, STAFF: StaffActor;
const events: { event: string; fields: Record<string, unknown> }[] = [];
let seq = 0;
const NOW = new Date("2027-03-01T02:00:00.000Z"); // Monday 10:00 Manila
const opts = () => ({ db: app, now: () => NOW });
const GRANTS_SQL = path.join(process.cwd(), "prisma", "sql", "p1-20-schedule-grants.sql");

const lit = (x: unknown): string => x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`;
async function insert(tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
}
const r0 = () => releaseFromManifest(manifest, releaseId);
const select = (size: string, slug: string): CatalogSelection => ({ vehicleCategoryId: sizeId(r0(), size), lines: [{ serviceId: bySlug(r0(), slug).id, quantity: 1 }] });
const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
// A day-queue booking exactly as the customer create writes it (same shape as admin.integration).
async function book(day: string): Promise<string> {
  const priced = pricing.priceSelection(r0(), select("S", "basic-wash"));
  assert.equal(priced.kind, "QUOTED");
  const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
  const id = randomUUID(), n = ++seq;
  const size = r0().sizes.find((x) => x.id === q.vehicleCategoryId)!;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
    const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
    await insert(tx, "bookings", { id, referenceCode: `ZEUS-S${String(n).padStart(5, "0")}`, customerName: `Customer ${n}`, customerPhone: "+639170000001",
      customerEmail: null, vehicleModel: "Synthetic", vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day,
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
  return id;
}
async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: import("./errors").AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as import("./errors").AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}
// What a customer sees for the wash queue (the existing public availability read).
const publicDays = (from: string, to: string) => db.$transaction((tx) => days.readDayStates(tx, "WASH", from, to, NOW));
const states = async (from: string, to: string) => Object.fromEntries((await publicDays(from, to)).map((d) => [d.date, d.state]));
const week = (open: (d: number) => boolean, times: Record<number, [string, string]> = {}): AdminWeekdayHours[] =>
  Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, open: open(d), openTime: times[d]?.[0] ?? "08:00", closeTime: times[d]?.[1] ?? "18:00" }));
const MON_TO_SAT = (d: number) => d !== 0;
const schedule = () => s.getSchedule(ADMIN, opts());
const grantsRun = (target: string) => spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "db", "execute",
  "--file", GRANTS_SQL, "--url", target], { cwd: process.cwd(), encoding: "utf8" });

before(async () => {
  if (skip) return;
  await createAndMigrate(root, ownerUrl);
  provisionRuntimeRole(ownerUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(ownerUrl) } } });
  pricing = await import("../catalog-pricing");
  days = await import("../availability-days");
  s = await import("./index");
  (await import("./log")).setAdminEventSink((event, fields) => events.push({ event, fields }));
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, "p120-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  const detailer = await db.staff.create({ data: { name: "Detailer", phone: "", email: "p120-detailer@example.test", role: "DETAILER" } });
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
});
after(async () => { await app?.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

test("hours: ADMIN only; the first save starts the schedule today; customers see the open weekdays", { skip }, async () => {
  await refused(s.getSchedule(STAFF, opts()), "FORBIDDEN", "STAFF read");
  const empty = await schedule();
  assert.equal(empty.startsOn, null);
  assert.deepEqual(empty.days.map((d) => d.open), [false, false, false, false, false, false, false]);
  assert.deepEqual(empty.closedDates, []);
  assert.deepEqual(new Set(Object.values(await states("2027-03-01", "2027-03-07"))), new Set(["CLOSED"]), "no schedule: every day closed");
  await refused(s.setWeekHours(STAFF, { expectedVersion: empty.version, days: week(MON_TO_SAT) }, opts()), "FORBIDDEN", "STAFF write");
  assert.equal(await db.timeSlot.count(), 0, "a refused write changes nothing");

  const saved = await s.setWeekHours(ADMIN, { expectedVersion: empty.version, days: week(MON_TO_SAT) }, opts());
  assert.equal(saved.startsOn, "2027-03-01");
  assert.deepEqual(saved.days.map((d) => d.open), [false, true, true, true, true, true, true]);
  assert.deepEqual(saved.days[1], { dayOfWeek: 1, open: true, openTime: "08:00", closeTime: "18:00" });
  assert.notEqual(saved.version, empty.version);
  assert.equal(await db.scheduleConfig.count(), 1);
  assert.deepEqual(await states("2027-03-01", "2027-03-07"), {
    "2027-03-01": "AVAILABLE", "2027-03-02": "AVAILABLE", "2027-03-03": "AVAILABLE", "2027-03-04": "AVAILABLE",
    "2027-03-05": "AVAILABLE", "2027-03-06": "AVAILABLE", "2027-03-07": "CLOSED" });

  await refused(s.setWeekHours(ADMIN, { expectedVersion: empty.version, days: week(MON_TO_SAT) }, opts()), "VERSION_CONFLICT", "stale version");
  const monday = await db.timeSlot.findFirstOrThrow({ where: { dayOfWeek: 1 } });
  const changed = await s.setWeekHours(ADMIN, { expectedVersion: saved.version, days: week(() => true, { 1: ["09:00", "17:00"] }) }, opts());
  assert.deepEqual(changed.days[1], { dayOfWeek: 1, open: true, openTime: "09:00", closeTime: "17:00" });
  assert.equal(changed.days[0].open, true);
  const mondayRows = await db.timeSlot.findMany({ where: { dayOfWeek: 1 } });
  assert.deepEqual(mondayRows.map((r) => [r.id, r.startTime, r.endTime, r.isActive]), [[monday.id, "09:00", "17:00", true]], "updated in place");
  assert.equal(await db.scheduleConfig.count(), 1, "the schedule start is created once");

  const sundayClosed = await s.setWeekHours(ADMIN, { expectedVersion: changed.version, days: week(MON_TO_SAT, { 1: ["09:00", "17:00"] }) }, opts());
  assert.equal(sundayClosed.days[0].open, false);
  assert.deepEqual((await db.timeSlot.findMany({ where: { dayOfWeek: 0 } })).map((r) => r.isActive), [false], "closing keeps the row");
  assert.equal((await states("2027-03-07", "2027-03-07"))["2027-03-07"], "CLOSED");
  const logged = events.filter((e) => e.event === "admin.schedule.hours_changed");
  assert.equal(logged.length, 3);
  assert.deepEqual(logged.map((e) => e.fields.actorStaffId), [ADMIN.staffId, ADMIN.staffId, ADMIN.staffId]);
});

test("closing a weekday that has open bookings is blocked and names the dates; declined bookings no longer block", { skip }, async () => {
  const before = await schedule();
  const id = await book("2027-03-09"); // a Tuesday
  await book("2027-03-23");
  await refused(s.setWeekHours(ADMIN, { expectedVersion: before.version, days: week((d) => d !== 0 && d !== 2, { 1: ["09:00", "17:00"] }) }, opts()),
    "SCHEDULE_CONFLICT", "booked Tuesday", (e) => {
      assert.deepEqual(e.fieldErrors.days, ["2027-03-09: 1 booking", "2027-03-23: 1 booking"]);
      assert.match(e.message, /Move or decline/);
    });
  assert.equal((await schedule()).version, before.version, "nothing changed");
  for (const day of ["2027-03-09", "2027-03-23"]) {
    const [b] = await db.booking.findMany({ where: { bookingDate: new Date(day + "T00:00:00Z") } });
    await s.declineBooking(ADMIN, b.id, { expectedRevision: b.revision, reason: "Synthetic: shop closes Tuesdays" }, opts());
  }
  assert.ok(id);
  const closed = await s.setWeekHours(ADMIN, { expectedVersion: before.version, days: week((d) => d !== 0 && d !== 2, { 1: ["09:00", "17:00"] }) }, opts());
  assert.equal(closed.days[2].open, false);
  // Reopen Tuesday for the tests that follow.
  await s.setWeekHours(ADMIN, { expectedVersion: closed.version, days: week(MON_TO_SAT, { 1: ["09:00", "17:00"] }) }, opts());
});

test("closed dates: ADMIN only, today to a year ahead, one per day, booked days blocked, reason never public", { skip }, async () => {
  await refused(s.addClosedDate(STAFF, { date: "2027-03-12" }, opts()), "FORBIDDEN", "STAFF add");
  await refused(s.addClosedDate(ADMIN, { date: "2027-02-28" }, opts()), "VALIDATION_ERROR", "past");
  await refused(s.addClosedDate(ADMIN, { date: "2028-03-01" }, opts()), "VALIDATION_ERROR", "more than a year ahead");
  const added = await s.addClosedDate(ADMIN, { date: "2027-03-12", reason: "Synthetic fiesta" }, opts());
  assert.deepEqual([added.date, added.reason], ["2027-03-12", "Synthetic fiesta"]);
  const plain = await s.addClosedDate(ADMIN, { date: "2027-03-13" }, opts());
  assert.equal(plain.reason, "Closed");
  await refused(s.addClosedDate(ADMIN, { date: "2027-03-12" }, opts()), "VALIDATION_ERROR", "duplicate");
  await book("2027-03-11");
  await refused(s.addClosedDate(ADMIN, { date: "2027-03-11", reason: "x" }, opts()), "SCHEDULE_CONFLICT", "booked day",
    (e) => assert.deepEqual(e.fieldErrors.date, ["2027-03-11: 1 booking. Move or decline it first."]));
  assert.equal(await db.blockedDate.count({ where: { date: new Date("2027-03-11T00:00:00Z") } }), 0);

  assert.deepEqual((await schedule()).closedDates.map((c) => [c.date, c.reason]), [["2027-03-12", "Synthetic fiesta"], ["2027-03-13", "Closed"]]);
  const publicView = await publicDays("2027-03-12", "2027-03-12");
  assert.deepEqual(publicView, [{ date: "2027-03-12", state: "CLOSED" }], "customers get the state only");
  assert.doesNotMatch(JSON.stringify(events), /Synthetic fiesta/, "the staff reason is never logged");

  await refused(s.removeClosedDate(STAFF, added.id, opts()), "FORBIDDEN", "STAFF remove");
  await s.removeClosedDate(ADMIN, added.id, opts());
  assert.equal((await states("2027-03-12", "2027-03-12"))["2027-03-12"], "AVAILABLE");
  await refused(s.removeClosedDate(ADMIN, added.id, opts()), "NOT_FOUND", "removed twice");
  const past = await db.blockedDate.create({ data: { date: new Date("2027-02-20T00:00:00Z"), reason: "Old closure" } });
  await refused(s.removeClosedDate(ADMIN, past.id, opts()), "VALIDATION_ERROR", "past closures are history");
  assert.ok(!(await schedule()).closedDates.some((c) => c.id === past.id), "only today and later are listed");
  assert.deepEqual(events.filter((e) => e.event.startsWith("admin.schedule.closed_date")).map((e) => e.event),
    ["admin.schedule.closed_date_added", "admin.schedule.closed_date_added", "admin.schedule.closed_date_removed"]);
});

test("calendar: STAFF reads per-day counts by status and closed days; at most 42 days; no customer data", { skip }, async () => {
  const a = await book("2027-03-16"), b = await book("2027-03-16"), c = await book("2027-03-17");
  await s.setBookingStatus(ADMIN, b, { expectedRevision: 1, status: "CONFIRMED" }, opts());
  await s.declineBooking(ADMIN, c, { expectedRevision: 1, reason: "Synthetic decline" }, opts());
  await s.addClosedDate(ADMIN, { date: "2027-03-19" }, opts());
  assert.ok(a);
  const cal = await s.getCalendar(STAFF, { from: "2027-02-28", to: "2027-03-20" }, opts());
  assert.equal(cal.days.length, 21);
  const day = (d: string) => cal.days.find((x) => x.date === d)!;
  assert.deepEqual([day("2027-03-16").total, day("2027-03-16").byStatus.PENDING, day("2027-03-16").byStatus.CONFIRMED], [2, 1, 1]);
  assert.deepEqual([day("2027-03-17").total, day("2027-03-17").byStatus.CANCELLED], [0, 1]);
  assert.equal(day("2027-02-28").closed, true, "before the schedule start");
  assert.equal(day("2027-03-14").closed, true, "closed weekday (Sunday)");
  assert.equal(day("2027-03-19").closed, true, "closed date");
  assert.equal(day("2027-03-18").closed, false);
  assert.doesNotMatch(JSON.stringify(cal), /Customer|\+639|ZEUS-/, "counts only");
  await refused(s.getCalendar(STAFF, { from: "2027-03-01", to: "2027-04-12" }, opts()), "VALIDATION_ERROR", "43 days");
});

test("bays: removing (deactivating) a bay with a car in it is refused; empty bays can be removed and brought back", { skip }, async () => {
  const bay = await s.createBay(ADMIN, { name: "P120 Wash 1", sortOrder: 50, bayType: "WASH" }, opts());
  const id = await book("2027-03-18");
  const seated = await s.setBay(ADMIN, id, { expectedRevision: 1, date: "2027-03-18", bayId: bay.id }, opts());
  const current = (await s.listBays(ADMIN, opts())).find((b) => b.id === bay.id)!;
  await refused(s.updateBay(ADMIN, bay.id, { expectedUpdatedAt: current.updatedAt, isActive: false }, opts()), "SCHEDULE_CONFLICT", "car in bay",
    (e) => assert.match(e.message, /Move the car out of P120 Wash 1 before removing it/));
  assert.equal((await db.bay.findUniqueOrThrow({ where: { id: bay.id } })).isActive, true, "nothing changed");
  const renamed = await s.updateBay(ADMIN, bay.id, { expectedUpdatedAt: current.updatedAt, name: "P120 Wash One" }, opts());
  assert.equal(renamed.name, "P120 Wash One", "renaming a busy bay is fine");
  await s.setBay(ADMIN, id, { expectedRevision: seated.booking.revision, date: "2027-03-18", bayId: null }, opts());
  const off = await s.updateBay(ADMIN, bay.id, { expectedUpdatedAt: renamed.updatedAt, isActive: false }, opts());
  assert.equal(off.isActive, false);
  const on = await s.updateBay(ADMIN, bay.id, { expectedUpdatedAt: off.updatedAt, isActive: true }, opts());
  assert.equal(on.isActive, true);
  await refused(s.updateBay(STAFF, bay.id, { expectedUpdatedAt: on.updatedAt, isActive: false }, opts()), "FORBIDDEN", "STAFF");
});

test("live grant step: the delta SQL adds exactly the schedule writes, matches runtime-role.sql and is rerunnable", { skip }, async () => {
  const privileges = async () => ({
    tables: await db.$queryRawUnsafe<{ t: string; p: string }[]>(`SELECT table_name AS t, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p
      FROM information_schema.role_table_grants WHERE grantee='zeus_app' AND table_name IN ('schedule_configs','time_slots','blocked_dates') GROUP BY 1 ORDER BY 1`),
    columns: await db.$queryRawUnsafe<{ c: string }[]>(`SELECT table_name || '.' || column_name AS c FROM information_schema.column_privileges
      WHERE grantee='zeus_app' AND privilege_type='UPDATE' AND table_name IN ('schedule_configs','time_slots','blocked_dates') ORDER BY 1`),
  });
  const provisioned = await privileges();
  assert.deepEqual(provisioned, {
    tables: [{ t: "blocked_dates", p: "DELETE,INSERT,SELECT" }, { t: "schedule_configs", p: "INSERT,SELECT" }, { t: "time_slots", p: "INSERT,SELECT" }],
    columns: [{ c: "time_slots.endTime" }, { c: "time_slots.isActive" }, { c: "time_slots.startTime" }],
  });
  // The live database today: the migrations' read-only grants on the three tables.
  await db.$executeRawUnsafe(`REVOKE ALL ON schedule_configs, time_slots, blocked_dates FROM zeus_app`);
  await db.$executeRawUnsafe(`GRANT SELECT ON schedule_configs, time_slots, blocked_dates TO zeus_app`);
  const current = await schedule();
  await assert.rejects(s.setWeekHours(ADMIN, { expectedVersion: current.version, days: week(() => true) }, opts()), "denied before the grant");
  assert.equal((await schedule()).version, current.version);
  for (const label of ["first run", "rerun"]) {
    const run = grantsRun(ownerUrl);
    assert.equal(run.status, 0, `${label}: ${run.stdout}${run.stderr}`);
    assert.deepEqual(await privileges(), provisioned, label);
  }
  provisionRuntimeRole(ownerUrl);
  assert.deepEqual(await privileges(), provisioned, "runtime-role.sql agrees with the delta");
  const reopened = await s.setWeekHours(ADMIN, { expectedVersion: current.version, days: week(MON_TO_SAT, { 1: ["09:00", "17:00"] }) }, opts());
  assert.equal(reopened.days[0].open, false);
});

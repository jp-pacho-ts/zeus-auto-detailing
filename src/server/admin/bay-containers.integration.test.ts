// P1-62 A1 Bay containers: every service call runs as the runtime role (zeus_app) against real PostgreSQL with the real migration.
// Own sibling database (<T007 name>_ctr); synthetic data only; nothing is dropped. Without T007_TEST_DATABASE_URL the tests skip.
// Fixtures and "the app cannot" checks use the owner client (db); every service call uses the app client. Bookings go through the real
// services (the same path the Bay board uses).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
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
const ctrUrl = url ? siblingDatabaseUrl(url, "ctr") : "postgresql://unused@localhost/zeus_t007_unused_ctr";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: ctrUrl } } }); // owner
let app: PrismaClient; // zeus_app
type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
const manifest = readManifest();
let releaseId = "";
let ADMIN: StaffActor, STAFF: StaffActor, detailerId: string;
const opts = () => ({ db: app });
const at = (day: string) => ({ db: app, now: () => new Date(day + "T02:00:00.000Z") });
let seq = 0;

before(async () => {
  if (skip) return;
  await createAndMigrate(root, ctrUrl);
  provisionRuntimeRole(ctrUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(ctrUrl) } } });
  pricing = await import("../catalog-pricing");
  s = await import("./index");
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, "p162-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  const detailer = await db.staff.create({ data: { name: "Container Worker", phone: "", email: "p162-worker@example.test", role: "DETAILER" } });
  detailerId = detailer.id;
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);
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
const lit = (x: unknown): string => (x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`);
async function insert(tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
}
const r0 = () => releaseFromManifest(manifest, releaseId);
const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
const select = (...lines: string[]): CatalogSelection => ({ vehicleCategoryId: sizeId(r0(), "S"), lines: lines.map((l) => ({ serviceId: bySlug(r0(), l).id, quantity: 1 })) });
async function book(day: string): Promise<{ id: string; reference: string }> {
  const priced = pricing.priceSelection(r0(), select("basic-wash"));
  assert.equal(priced.kind, "QUOTED");
  const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
  const id = randomUUID(), n = ++seq, reference = `ZEUS-K${String(n).padStart(5, "0")}`;
  const size = r0().sizes.find((x) => x.id === q.vehicleCategoryId)!;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
    const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
    await insert(tx, "bookings", { id, referenceCode: reference, customerName: `Zed Customer ${n}`, customerPhone: "+639170000777", customerEmail: `zedk${n}@example.test`,
      vehicleModel: "Synthetic Roadster", vehiclePlate: "ZZZ9999", notes: "Gate code 4321", vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day,
      startsAt: dayStart(day), endsAt: new Date(Date.parse(dayStart(day)) + 86_400_000).toISOString(), status: "PENDING", priceSnapshot: q.totalPriceCentavos / 100,
      serviceNameSnapshot: q.lines[0].name, vehicleCategoryNameSnapshot: size.name, idempotencyKey: randomUUID(), requestHash: "synthetic-" + n,
      updatedAt: new Date().toISOString(), snapshotVersion: "QUEUE_V3", catalogReleaseId: q.catalogReleaseId, vehicleSizeCodeSnapshot: size.code,
      catalogFingerprint: q.catalogFingerprint, pricingAlgorithm: q.pricingAlgorithm, queueCode: q.queueId, queuePosition: Number(p),
      receiptTotalCentavos: q.totalPriceCentavos, receiptEstimatedCentavos: q.estimatedTotalCentavos });
    for (const [i, l] of q.lines.entries()) {
      await insert(tx, "booking_line_items", { id: randomUUID(), bookingId: id, order: i, releaseId: q.catalogReleaseId, serviceId: l.serviceId, vehicleCategoryId: q.vehicleCategoryId,
        offerId: l.offerId, type: l.kind, nameSnapshot: l.name, unit: l.unit, quantity: l.quantity, unitPriceCentavos: l.unitPriceCentavos, subtotalCentavos: l.subtotalCentavos,
        lineVersion: "QUEUE_V3", priceStatus: l.priceStatus, referenceUnitPriceCentavos: l.referenceUnitPriceCentavos, referenceSubtotalCentavos: l.referenceSubtotalCentavos });
    }
  });
  return { id, reference };
}
const rev = async (id: string) => (await db.booking.findUniqueOrThrow({ where: { id } })).revision;
let dayCounter = 0;
const nextDay = () => `2027-08-${String(1 + (dayCounter++ % 28)).padStart(2, "0")}`;
const container = async (name: string) => db.bayContainer.findFirstOrThrow({ where: { name } });
const newContainer = (extra: Record<string, unknown> = {}) => s.addContainer(ADMIN, { id: randomUUID(), name: `Synthetic Area ${++seq}`, ...extra }, opts());
const newBay = (containerId?: string, extra: Record<string, unknown> = {}) => s.createBay(ADMIN, { name: `Synthetic Bay ${++seq}`, sortOrder: seq, ...(containerId ? { containerId } : {}), ...extra }, opts());

test("BC0 the migration only writes bays and its own tables: no booking, occupancy, assignment or audit row is touched", { skip: false }, () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261107000000_bay_containers", "migration.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  // A data change starts a statement: at the start of a line (function bodies are indented), after a semicolon, or after THEN. "ON UPDATE CASCADE" and "OR UPDATE ON" in DDL are not data changes.
  const targets = [...sql.matchAll(/(?:^|;|\bTHEN)[ \t]*(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:public\.)?"?([a-z_]+)"?/gim)].map((m) => m[1].toLowerCase());
  const allowed = new Set(["bays", "bay_containers", "bay_container_audit_events"]);
  const outside = [...new Set(targets.filter((t) => !allowed.has(t)))];
  // Function bodies may write the audit table and name other tables only in SELECTs; anything else listed here is a data change elsewhere.
  assert.deepEqual(outside, [], "DML outside bays and the new tables: " + outside.join(", "));
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|TYPE)|ALTER TABLE\s+(public\.)?"?(bookings|bay_occupancies|booking_bay_assignments)/i, "expand only");
});

test("BC1 the three starting containers come from today's bay types: Wash, Detailing and Paint, with their usual services", { skip }, async () => {
  const list = await s.listContainers(ADMIN, opts());
  assert.deepEqual(list.map((c) => [c.name, c.sortOrder, c.isActive, c.usualQueues]), [
    ["Wash", 0, true, ["WASH"]], ["Detailing", 1, true, ["DETAILING_COATING", "TINT_PPF"]], ["Paint", 2, true, ["REPAINT"]]]);
});

test("BC2 adding a container: ADMIN only, a browser-made id makes a retry harmless, names are unique across containers and bays, labels are checked", { skip }, async () => {
  const id = randomUUID();
  const body = { id, name: "  Express Area  ", usualQueues: ["WASH"] };
  const first = await s.addContainer(ADMIN, body, opts());
  assert.deepEqual([first.name, first.usualQueues, first.isActive, first.sortOrder], ["Express Area", ["WASH"], true, 3]);
  const again = await s.addContainer(ADMIN, body, opts());
  assert.deepEqual([again.id, again.updatedAt], [first.id, first.updatedAt], "a retry returns the same container");
  assert.equal(await count("bay_containers", `id = '${id}'`), 1);
  assert.equal(await count("bay_container_audit_events", `"targetId" = '${id}'`), 1, "and no second audit row");
  await refused(s.addContainer(ADMIN, { ...body, name: "Other Name" }, opts()), "VALIDATION_ERROR", "same id, different content");
  await refused(s.addContainer(ADMIN, { id: randomUUID(), name: "express AREA" }, opts()), "VALIDATION_ERROR", "duplicate container name", (e) => assert.deepEqual(Object.keys(e.fieldErrors), ["name"]));
  const bay = await newBay(undefined, { name: "Clash Name" });
  await refused(s.addContainer(ADMIN, { id: randomUUID(), name: " clash name" }, opts()), "VALIDATION_ERROR", "a container named like a bay");
  await refused(s.createBay(ADMIN, { name: "wash", sortOrder: 99 }, opts()), "VALIDATION_ERROR", "a bay named like a container");
  assert.ok(bay.id);
  await refused(s.addContainer(ADMIN, { id: randomUUID(), name: "Bad Label", usualQueues: ["NOT_A_QUEUE"] }, opts()), "VALIDATION_ERROR", "unknown queue");
  const labelled = await s.addContainer(ADMIN, { id: randomUUID(), name: "Two Labels", usualQueues: ["TINT_PPF", "REPAINT"] }, opts());
  assert.deepEqual(labelled.usualQueues, ["TINT_PPF", "REPAINT"]);
  const plain = await newContainer();
  assert.deepEqual(plain.usualQueues, [], "a new container has no label unless given one");
  for (const bad of [{ id: randomUUID(), name: "" }, { id: randomUUID(), name: "x".repeat(41) }, { id: "nope", name: "Bad Id" }, { name: "No Id" }, { id: randomUUID(), name: "Dup Labels", usualQueues: ["WASH", "WASH"] }, { id: randomUUID(), name: "Extra", paint: true }])
    await refused(s.addContainer(ADMIN, bad, opts()), "VALIDATION_ERROR", JSON.stringify(bad).slice(0, 50));
  await refused(s.addContainer(STAFF, { id: randomUUID(), name: "Nope" }, opts()), "FORBIDDEN", "STAFF");
});

test("BC3 rename and label: a stale version is refused, nothing changes when nothing differs, names stay unique, the label can be emptied, every change is audited", { skip }, async () => {
  let c = await newContainer({ usualQueues: ["WASH"] });
  const renamed = await s.updateContainer(ADMIN, c.id, { expectedUpdatedAt: c.updatedAt, name: "Renamed Area" }, opts());
  assert.equal(renamed.name, "Renamed Area");
  assert.ok(renamed.updatedAt > c.updatedAt, "the version moved");
  await refused(s.updateContainer(ADMIN, c.id, { expectedUpdatedAt: c.updatedAt, name: "Stale Name" }, opts()), "VERSION_CONFLICT", "stale");
  const same = await s.updateContainer(ADMIN, c.id, { expectedUpdatedAt: renamed.updatedAt, name: "Renamed Area", usualQueues: ["WASH"] }, opts());
  assert.equal(same.updatedAt, renamed.updatedAt, "no change, no new version");
  const other = await newContainer();
  await refused(s.updateContainer(ADMIN, other.id, { expectedUpdatedAt: other.updatedAt, name: "renamed AREA" }, opts()), "VALIDATION_ERROR", "rename onto an existing name");
  c = await s.updateContainer(ADMIN, c.id, { expectedUpdatedAt: renamed.updatedAt, usualQueues: ["DETAILING_COATING", "REPAINT"] }, opts());
  assert.deepEqual(c.usualQueues, ["DETAILING_COATING", "REPAINT"]);
  c = await s.updateContainer(ADMIN, c.id, { expectedUpdatedAt: c.updatedAt, usualQueues: [] }, opts());
  assert.deepEqual(c.usualQueues, [], "an empty label means it never prompts");
  const acts = (await db.bayContainerAuditEvent.findMany({ where: { targetId: c.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
  assert.deepEqual(acts, ["CONTAINER_CREATED", "CONTAINER_RENAMED", "CONTAINER_LABEL_SET", "CONTAINER_LABEL_SET"]);
  for (const bad of [{ expectedUpdatedAt: c.updatedAt }, { expectedUpdatedAt: "yesterday", name: "x" }, { name: "x" }, { expectedUpdatedAt: c.updatedAt, usualQueues: ["NOPE"] }])
    await refused(s.updateContainer(ADMIN, c.id, bad, opts()), "VALIDATION_ERROR", JSON.stringify(bad).slice(0, 60));
  await refused(s.updateContainer(STAFF, c.id, { expectedUpdatedAt: c.updatedAt, name: "Nope Name" }, opts()), "FORBIDDEN", "STAFF");
  await refused(s.updateContainer(ADMIN, randomUUID(), { expectedUpdatedAt: c.updatedAt, name: "Ghost" }, opts()), "NOT_FOUND", "unknown");
});

test("BC4 removing a container: only an empty one, never the last one, its name stays reserved, and a removed container takes nothing new", { skip }, async () => {
  const withBay = await newContainer();
  const bay = await newBay(withBay.id);
  await refused(s.removeContainer(ADMIN, withBay.id, { expectedUpdatedAt: withBay.updatedAt }, opts()), "NOT_ALLOWED", "a container with a bay", (e) => assert.match(e.message, /Move or remove its bays first/));
  const empty = await newContainer();
  const gone = await s.removeContainer(ADMIN, empty.id, { expectedUpdatedAt: empty.updatedAt }, opts());
  assert.equal(gone.isActive, false);
  assert.equal(await count("bay_containers", `id = '${empty.id}'`), 1, "history is kept");
  await refused(s.addContainer(ADMIN, { id: randomUUID(), name: empty.name.toUpperCase() }, opts()), "VALIDATION_ERROR", "the name stays reserved");
  await refused(s.updateContainer(ADMIN, empty.id, { expectedUpdatedAt: gone.updatedAt, name: "Back From The Dead" }, opts()), "NOT_ALLOWED", "rename a removed container");
  await refused(s.moveBay(ADMIN, bay.id, { expectedUpdatedAt: bay.updatedAt, containerId: empty.id }, opts()), "NOT_ALLOWED", "a bay into a removed container");
  const again = await s.removeContainer(ADMIN, empty.id, { expectedUpdatedAt: gone.updatedAt }, opts());
  assert.equal(again.updatedAt, gone.updatedAt, "removing it again changes nothing");
  await refused(s.removeContainer(ADMIN, withBay.id, { expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }, opts()), "VERSION_CONFLICT", "stale");
  await refused(s.removeContainer(STAFF, withBay.id, { expectedUpdatedAt: withBay.updatedAt }, opts()), "FORBIDDEN", "STAFF");
});

test("BC5 moving a bay: any active container, a stale version is refused, the same container changes nothing, and every move is audited", { skip }, async () => {
  const from = await newContainer(), to = await newContainer();
  const bay = await newBay(from.id);
  assert.equal(bay.containerId, from.id);
  const moved = await s.moveBay(ADMIN, bay.id, { expectedUpdatedAt: bay.updatedAt, containerId: to.id }, opts());
  assert.deepEqual([moved.containerId, moved.updatedAt > bay.updatedAt], [to.id, true]);
  await refused(s.moveBay(ADMIN, bay.id, { expectedUpdatedAt: bay.updatedAt, containerId: from.id }, opts()), "VERSION_CONFLICT", "stale");
  const same = await s.moveBay(ADMIN, bay.id, { expectedUpdatedAt: moved.updatedAt, containerId: to.id }, opts());
  assert.equal(same.updatedAt, moved.updatedAt);
  const audit = await db.bayContainerAuditEvent.findMany({ where: { targetId: bay.id } });
  assert.deepEqual(audit.map((a) => [a.action, a.relatedId]), [["BAY_MOVED", to.id]]);
  await refused(s.moveBay(ADMIN, randomUUID(), { expectedUpdatedAt: bay.updatedAt, containerId: to.id }, opts()), "NOT_FOUND", "unknown bay");
  await refused(s.moveBay(ADMIN, bay.id, { expectedUpdatedAt: moved.updatedAt, containerId: randomUUID() }, opts()), "NOT_FOUND", "unknown container");
  await refused(s.moveBay(STAFF, bay.id, { expectedUpdatedAt: moved.updatedAt, containerId: from.id }, opts()), "FORBIDDEN", "STAFF");
});

test("BC6 a bay made the old way (a type, no container) lands in the matching starting container; one made with a container lands there", { skip }, async () => {
  const legacy = await s.createBay(ADMIN, { name: `Legacy Style Bay ${++seq}`, sortOrder: 1, bayType: "DETAILING" }, opts());
  assert.equal(legacy.containerId, (await db.bayContainer.findFirstOrThrow({ where: { legacyBayType: "DETAILING", isActive: true }, orderBy: { sortOrder: "asc" } })).id);
  const direct = await newContainer();
  const bay = await newBay(direct.id);
  assert.equal(bay.containerId, direct.id);
  assert.equal(bay.bayType, "WASH", "the legacy type is only a placeholder now");
  // The raw insert a live (old) build would do: no container column at all.
  await db.$executeRawUnsafe(`INSERT INTO bays (id, name, "nameKey", "sortOrder", "bayType", "updatedAt") VALUES ('${randomUUID()}', 'Raw Old Bay', 'raw old bay', 1, 'PAINT', now())`);
  const raw = await db.bay.findFirstOrThrow({ where: { nameKey: "raw old bay" } });
  assert.equal(raw.containerId, (await db.bayContainer.findFirstOrThrow({ where: { legacyBayType: "PAINT", isActive: true }, orderBy: { sortOrder: "asc" } })).id);
});

test("BC7 a mixed booking is seated in a Wash container bay, moved to a Detailing bay in the middle of the job, and finished: the old kind rule is gone, finish and commission work", { skip }, async () => {
  const day = nextDay(), o = at(day);
  const washBay = await newBay((await container("Wash")).id), detBay = await newBay((await container("Detailing")).id);
  const worker = await s.addPerson(ADMIN, { name: "Mixed Flow Worker" }, opts());
  const b = await book(day);
  await s.addLine(ADMIN, b.id, { expectedRevision: await rev(b.id), serviceId: bySlug(r0(), "regular-tint").id, quantity: 1 }, o);
  const tint = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: b.id, serviceId: bySlug(r0(), "regular-tint").id } });
  await s.setLinePrice(ADMIN, b.id, tint.id, { expectedRevision: await rev(b.id), priceCentavos: 100_000, reason: "P1-62 test price" }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "CONFIRMED" }, o);
  await s.assignWorker(ADMIN, b.id, worker.id, { expectedRevision: await rev(b.id) }, o);
  await s.setBay(ADMIN, b.id, { expectedRevision: await rev(b.id), date: day, bayId: washBay.id }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "IN_PROGRESS" }, o);
  const wash = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: b.id, serviceId: { not: bySlug(r0(), "regular-tint").id } } });
  await s.setLineStatus(ADMIN, b.id, wash.id, { expectedRevision: await rev(b.id), workStatus: "DONE" }, o);
  // The wash is done: the car moves to a Detailing container bay (the kind rule used to refuse this).
  await s.setBay(ADMIN, b.id, { expectedRevision: await rev(b.id), date: day, bayId: detBay.id }, o);
  assert.equal((await db.bayOccupancy.findUniqueOrThrow({ where: { bookingId: b.id } })).bayId, detBay.id);
  await s.setLineStatus(ADMIN, b.id, tint.id, { expectedRevision: await rev(b.id), workStatus: "DONE" }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "COMPLETED" }, o);
  const done = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
  assert.equal(done.status, "COMPLETED");
  assert.equal(await db.bayOccupancy.count({ where: { bookingId: b.id } }), 0, "the bay is released");
  const entries = await db.commissionEntry.findMany({ where: { bookingId: b.id } });
  assert.deepEqual(entries.map((e) => [e.staffId, Number(e.baseCentavos)]), [[worker.id, 100_000]], "the finish flow and the commission are unchanged (the wash earns nothing)");
  assert.equal(await db.bookingBayAssignment.count({ where: { bookingId: b.id } }) >= 1, true, "the day's assignment history is kept");
});

test("BC8 the relaxed rule still refuses a seat for a finished booking or one before its day, and the database function no longer mentions the kind rule", { skip }, async () => {
  const def = (await db.$queryRawUnsafe<{ d: string }[]>(`SELECT pg_get_functiondef('validate_bay_board'::regproc) AS d`))[0].d;
  assert.doesNotMatch(def, /does not take this queue/);
  assert.match(def, /Invalid open bay occupancy/);
  // A direct owner insert of an occupancy for a booking that is finished (BC7 finished one) is refused by the guards that remain.
  const finished = await db.booking.findFirstOrThrow({ where: { status: "COMPLETED", snapshotVersion: "QUEUE_V3" } });
  const bay = await newBay();
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO bay_occupancies ("bookingId", "bayId", date, "assignedByStaffId") VALUES ('${finished.id}', '${bay.id}', '${finished.bookingDate.toISOString().slice(0, 10)}', '${ADMIN.staffId}')`), /Assign only open|Invalid open bay occupancy|revision/);
  // A car cannot be seated before its own day through the service either (the earlier-day rule stays).
  const later = await book("2028-12-01");
  await refused(s.setBay(ADMIN, later.id, { expectedRevision: await rev(later.id), date: "2028-12-01", bayId: bay.id }, opts()), "BOOKING_NOT_MANAGEABLE", "a car before its day");
});

test("BC9 adding containers and bays never changes a daily limit or a booking count", { skip }, async () => {
  const day = nextDay();
  await book(day);
  const before = await s.getDayQueues(ADMIN, { date: day }, opts());
  await newContainer(); await newBay();
  const after = await s.getDayQueues(ADMIN, { date: day }, opts());
  assert.deepEqual(after.queues.map((q) => [q.code, q.effectiveCap, q.committed]), before.queues.map((q) => [q.code, q.effectiveCap, q.committed]));
});

test("BC10 the board read has containers with their bays and cars, one Waiting list with each car's queue and each line's queue, and one Done list with finish time and workers", { skip }, async () => {
  const day = nextDay();
  const cont = await newContainer(), bay = await newBay(cont.id);
  const worker = await s.addPerson(ADMIN, { name: "Board Read Worker" }, opts());
  // A waiting mixed booking (wash + tint), and one seated.
  const wait = await book(day);
  await s.addLine(ADMIN, wait.id, { expectedRevision: await rev(wait.id), serviceId: bySlug(r0(), "regular-tint").id, quantity: 1 }, at(day));
  const seated = await book(day);
  await s.setBookingStatus(ADMIN, seated.id, { expectedRevision: await rev(seated.id), status: "CONFIRMED" }, at(day));
  await s.setBay(ADMIN, seated.id, { expectedRevision: await rev(seated.id), date: day, bayId: bay.id }, at(day));
  // A finished booking with a worker.
  const fin = await book(day);
  await s.assignWorker(ADMIN, fin.id, worker.id, { expectedRevision: await rev(fin.id) }, at(day));
  await s.setBookingStatus(ADMIN, fin.id, { expectedRevision: await rev(fin.id), status: "CONFIRMED" }, at(day));
  const finBay = await newBay(cont.id);
  await s.setBay(ADMIN, fin.id, { expectedRevision: await rev(fin.id), date: day, bayId: finBay.id }, at(day));
  await s.setBookingStatus(ADMIN, fin.id, { expectedRevision: await rev(fin.id), status: "IN_PROGRESS" }, at(day));
  for (const l of await db.bookingLineItem.findMany({ where: { bookingId: fin.id } })) await s.setLineStatus(ADMIN, fin.id, l.id, { expectedRevision: await rev(fin.id), workStatus: "DONE" }, at(day));
  await s.setBookingStatus(ADMIN, fin.id, { expectedRevision: await rev(fin.id), status: "COMPLETED" }, at(day));
  const board = await s.getDayBoard(STAFF, { date: day }, opts());
  const c = board.containers.find((x) => x.id === cont.id)!;
  assert.deepEqual([c.name, c.usualQueues], [cont.name, []]);
  assert.deepEqual(c.bays.map((x) => x.id).sort(), [bay.id, finBay.id].sort(), "a container lists its active bays, empty ones too");
  assert.ok(c.bays.some((x) => x.id === bay.id && x.cards.some((card) => card.id === seated.id)), "the seated car is in its bay");
  const w = board.waiting.find((card) => card.id === wait.id)!;
  assert.equal(w.queueCode, "WASH");
  assert.equal(w.queueName.length > 0, true);
  assert.deepEqual(w.lines.map((l) => l.queueCode).sort(), ["TINT_PPF", "WASH"], "each line carries its own service's queue");
  assert.ok(!board.waiting.some((card) => card.id === seated.id), "a seated car is not waiting");
  assert.equal(board.waiting.some((card) => card.id === fin.id), false);
  const d = board.done.find((card) => card.id === fin.id)!;
  assert.deepEqual(d.workers.map((x) => x.name), ["Board Read Worker"]);
  assert.ok(Math.abs(Date.parse(d.finishedAt) - Date.now()) < 120_000, "the finish time is the real finish moment");
  assert.equal(board.done.some((card) => card.id === seated.id), false);
  // The old shape is still there for the board that is live today.
  assert.ok(Array.isArray(board.queues) && Array.isArray(board.bays));
});

test("BC11 the runtime role cannot write containers, move a bay by itself or touch the audit table, and a non-admin actor id is refused inside the functions", { skip }, async () => {
  const c = await newContainer(), bay = await newBay(c.id);
  const denied = async (sql: string, label: string) => assert.rejects(app.$executeRawUnsafe(sql), /permission denied/i, label);
  await denied(`INSERT INTO bay_containers (name, "nameKey", "sortOrder") VALUES ('x', 'x', 1)`, "insert container");
  await denied(`UPDATE bay_containers SET name = 'x' WHERE id = '${c.id}'`, "update container");
  await denied(`DELETE FROM bay_containers`, "delete container");
  await denied(`UPDATE bays SET "containerId" = '${c.id}' WHERE id = '${bay.id}'`, "move a bay directly");
  await assert.rejects(app.$queryRawUnsafe(`SELECT * FROM bay_container_audit_events`), /permission denied/i, "read the audit table");
  await denied(`INSERT INTO bay_container_audit_events (action, "actorStaffId", "targetId") VALUES ('CONTAINER_CREATED', '${ADMIN.staffId}', 'x')`, "write the audit table");
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_container_create($1, $2, 'Sneaky', ARRAY[]::text[])`, detailerId, randomUUID()), /ZT004|Only an admin/);
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_bay_move($1, $2, $3, now())`, detailerId, bay.id, c.id), /ZT004|Only an admin/);
  await app.$queryRawUnsafe(`SELECT count(*) FROM bay_containers`);
});

test("BC12 history and audit are append-only for the owner too, containers cannot be deleted, and a removed container cannot hold an active bay", { skip }, async () => {
  const c = await newContainer(), bay = await newBay(c.id);
  const a = await db.bayContainerAuditEvent.findFirstOrThrow({ where: { targetId: c.id } });
  await assert.rejects(db.$executeRawUnsafe(`UPDATE bay_container_audit_events SET "targetLabel" = 'x' WHERE id = '${a.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM bay_container_audit_events WHERE id = '${a.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE bay_container_audit_events`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM bay_containers WHERE id = '${c.id}'`), /cannot be deleted|restrict|foreign key/i);
  await assert.rejects(db.$executeRawUnsafe(`UPDATE bay_containers SET "isActive" = false WHERE id = '${c.id}'`), /cannot hold an active bay|ZK004/);
  assert.equal((await db.bayContainer.findUniqueOrThrow({ where: { id: c.id } })).isActive, true);
  assert.ok(bay.id);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO bay_container_audit_events (action, "actorStaffId", "targetId", "targetLabel") VALUES ('BAY_MOVED', '${ADMIN.staffId}', 'x', 'a name')`), /bay_container_audit_shape/, "a name only on a removal");
  assert.equal(await count("bay_container_audit_events", `"targetId" = '${c.id}' AND action = 'CONTAINER_CREATED'`), 1);
});

// Runs last on purpose: it empties every container but one.
test("BC13 the last active container is never removed", { skip }, async () => {
  const all = await s.listContainers(ADMIN, opts());
  const keepId = all[0].id;
  for (const c of all) {
    if (c.id === keepId) continue;
    for (const b of await db.bay.findMany({ where: { containerId: c.id, isActive: true } })) {
      const cur = await db.bay.findUniqueOrThrow({ where: { id: b.id } });
      await s.moveBay(ADMIN, b.id, { expectedUpdatedAt: cur.updatedAt.toISOString(), containerId: keepId }, opts());
    }
    const fresh = (await s.listContainers(ADMIN, opts())).find((x) => x.id === c.id)!;
    await s.removeContainer(ADMIN, c.id, { expectedUpdatedAt: fresh.updatedAt }, opts());
  }
  const last = (await s.listContainers(ADMIN, opts()))[0];
  assert.equal((await s.listContainers(ADMIN, opts())).length, 1, "only one active container is left");
  for (const b of await db.bay.findMany({ where: { containerId: last.id, isActive: true } })) await db.$executeRawUnsafe(`UPDATE bays SET "isActive" = false WHERE id = '${b.id}'`);
  await refused(s.removeContainer(ADMIN, last.id, { expectedUpdatedAt: last.updatedAt }, opts()), "NOT_ALLOWED", "the last container", (e) => assert.match(e.message, /at least one/i));
  await assert.rejects(db.$executeRawUnsafe(`UPDATE bay_containers SET "isActive" = false WHERE id = '${last.id}'`), /At least one container must stay|ZK005/, "and the database refuses it too");
});

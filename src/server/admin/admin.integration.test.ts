// P1-07 admin queue and booking API services against real PostgreSQL with the P1-02 booking
// model. Uses its own sibling database (<T007 name>_admin); synthetic data only; nothing is
// dropped. Without T007_TEST_DATABASE_URL these tests skip.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CatalogSelection } from "@/types/catalog-contracts";
import type { AdminBookingDetail } from "@/types/admin-contracts";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "../catalog.fixture";
import { createAndMigrate, mapPublisher, publish, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const adminUrl = url ? siblingDatabaseUrl(url, "admin") : "postgresql://unused@localhost/zeus_t007_unused_admin";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: adminUrl } } });

type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
const manifest = readManifest();
let releaseId = "";
let ADMIN: StaffActor, MANAGER: StaffActor, STAFF: StaffActor;
const events: { event: string; fields: Record<string, unknown> }[] = [];
const secret = (seed: number) => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + seed * 101 + 11) % 256)).toString("base64url");
let ring: import("./history-key-ring").HistoryKeyRing;
let seq = 0;
const NOW = new Date("2027-03-01T02:00:00.000Z"); // 10:00 Manila on 2027-03-01
const opts = (extra: Record<string, unknown> = {}) => ({ db, now: () => NOW, ...extra });

const lit = (x: unknown): string => x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`;
async function insert(tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
}
const r0 = () => releaseFromManifest(manifest, releaseId);
const select = (size: string, ...lines: (string | [string, number])[]): CatalogSelection => ({
  vehicleCategoryId: sizeId(r0(), size),
  lines: lines.map((l) => (typeof l === "string" ? { serviceId: bySlug(r0(), l).id, quantity: 1 } : { serviceId: bySlug(r0(), l[0]).id, quantity: l[1] })),
});
const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
// A day-queue booking exactly as the customer create writes it (P1-02 contract handoff), at the next position.
async function book(selection: CatalogSelection, day: string, extra: Record<string, unknown> = {}): Promise<string> {
  const priced = pricing.priceSelection(r0(), selection);
  assert.equal(priced.kind, "QUOTED");
  const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
  const id = randomUUID(), n = ++seq;
  const size = r0().sizes.find((x) => x.id === q.vehicleCategoryId)!;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
    const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
    await insert(tx, "bookings", { id, referenceCode: `ZEUS-A${String(n).padStart(5, "0")}`, customerName: `Customer ${n}`, customerPhone: "+639170000001",
      customerEmail: null, vehicleModel: "Synthetic", vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day,
      startsAt: dayStart(day), endsAt: new Date(Date.parse(dayStart(day)) + 86_400_000).toISOString(), status: "PENDING", priceSnapshot: q.totalPriceCentavos / 100,
      serviceNameSnapshot: q.lines[0].name, vehicleCategoryNameSnapshot: size.name, idempotencyKey: randomUUID(), requestHash: "synthetic-" + n,
      updatedAt: new Date().toISOString(), snapshotVersion: "QUEUE_V3", catalogReleaseId: q.catalogReleaseId, vehicleSizeCodeSnapshot: size.code,
      catalogFingerprint: q.catalogFingerprint, pricingAlgorithm: q.pricingAlgorithm, queueCode: q.queueId, queuePosition: Number(p),
      receiptTotalCentavos: q.totalPriceCentavos, receiptEstimatedCentavos: q.estimatedTotalCentavos, ...extra });
    for (const [i, l] of q.lines.entries()) {
      await insert(tx, "booking_line_items", { id: randomUUID(), bookingId: id, order: i, releaseId: q.catalogReleaseId, serviceId: l.serviceId,
        vehicleCategoryId: q.vehicleCategoryId, offerId: l.offerId, type: l.kind, nameSnapshot: l.name, unit: l.unit, quantity: l.quantity,
        unitPriceCentavos: l.unitPriceCentavos, subtotalCentavos: l.subtotalCentavos, lineVersion: "QUEUE_V3", priceStatus: l.priceStatus,
        referenceUnitPriceCentavos: l.referenceUnitPriceCentavos, referenceSubtotalCentavos: l.referenceSubtotalCentavos });
    }
  });
  return id;
}
const detail = (id: string) => s.getBookingDetail(ADMIN, id, opts());
const audits = (bookingId: string) => db.bookingAuditEvent.findMany({ where: { bookingId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: import("./errors").AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as import("./errors").AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}
const lineIds = async (bookingId: string) => (await db.bookingLineItem.findMany({ where: { bookingId }, orderBy: { order: "asc" } })).map((l) => l.id);

before(async () => {
  if (skip) return;
  await createAndMigrate(root, adminUrl);
  pricing = await import("../catalog-pricing");
  s = await import("./index");
  (await import("./log")).setAdminEventSink((event, fields) => events.push({ event, fields }));
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, "p107-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  const manager = await db.staff.create({ data: { name: "Manager", phone: "", email: "p107-manager@example.test", role: "MANAGER" } });
  const detailer = await db.staff.create({ data: { name: "Detailer", phone: "", email: "p107-detailer@example.test", role: "DETAILER" } });
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  MANAGER = { staffId: manager.id, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
  // Synthetic caps (no launch value is hardcoded).
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=5, revision=revision+1, "updatedAt"=now()`);
  ring = (await import("./history-key-ring")).parseHistoryKeyRing({ HISTORY_LOOKUP_KEYS: `h-1:${secret(4)}`, HISTORY_LOOKUP_ACTIVE_KID: "h-1" });
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

test("W1 status: ADMIN confirms; STAFF cannot; stale revision, no-op policy, completion and terminal fields", { skip }, async () => {
  const id = await book(select("S", "basic-wash"), "2027-03-02");
  await refused(s.setBookingStatus(STAFF, id, { expectedRevision: 1, status: "CONFIRMED" }, opts()), "FORBIDDEN", "STAFF confirm",
    (e) => assert.equal(e.currentBooking?.id, id));
  await refused(s.setBookingStatus(ADMIN, id, { expectedRevision: 2, status: "CONFIRMED" }, opts()), "VERSION_CONFLICT", "stale",
    (e) => assert.equal(e.currentBooking?.revision, 1));
  const confirmed = await s.setBookingStatus(MANAGER, id, { expectedRevision: 1, status: "CONFIRMED" }, opts());
  assert.deepEqual([confirmed.noChange, confirmed.booking.status, confirmed.booking.revision], [false, "CONFIRMED", 2]);
  const [a] = await audits(id);
  assert.deepEqual([a.action, a.fromStatus, a.toStatus, a.fromRevision, a.toRevision, a.actorStaffId], ["STATUS_CHANGED", "PENDING", "CONFIRMED", 1, 2, MANAGER.staffId]);
  // S-05: a same-status request is noChange for an allowed role and 403 otherwise; neither writes.
  assert.equal((await s.setBookingStatus(ADMIN, id, { expectedRevision: 2, status: "CONFIRMED" }, opts())).noChange, true);
  await refused(s.setBookingStatus(STAFF, id, { expectedRevision: 2, status: "CONFIRMED" }, opts()), "FORBIDDEN", "STAFF same-status");
  assert.equal((await audits(id)).length, 1);
  // STAFF starts and completes (D4); completion needs every active line done.
  const started = await s.setBookingStatus(STAFF, id, { expectedRevision: 2, status: "IN_PROGRESS" }, opts());
  assert.equal(started.booking.status, "IN_PROGRESS");
  await refused(s.setBookingStatus(STAFF, id, { expectedRevision: 3, status: "COMPLETED" }, opts()), "BOOKING_NOT_MANAGEABLE", "open lines");
  const [line] = await lineIds(id);
  await s.setLineStatus(STAFF, id, line, { expectedRevision: 3, workStatus: "DONE" }, opts());
  const done = await s.setBookingStatus(STAFF, id, { expectedRevision: 4, status: "COMPLETED" }, opts());
  assert.equal(done.booking.status, "COMPLETED");
  const row = await db.booking.findUniqueOrThrow({ where: { id } });
  assert.ok(row.terminalAt);
  await refused(s.setBookingStatus(ADMIN, randomUUID(), { expectedRevision: 1, status: "CONFIRMED" }, opts()), "NOT_FOUND", "unknown");
  await refused(s.setBookingStatus(ADMIN, id, { expectedRevision: 5, status: "CONFIRMED" }, opts()), "BOOKING_NOT_MANAGEABLE", "completed is final");
});

test("W2 decline and D5 reinstate: ADMIN only, reason required, fixed decline kind, cap-checked reinstatement", { skip }, async () => {
  const day = "2027-03-03";
  const id = await book(select("S", "regular-tint"), day);
  await refused(s.declineBooking(STAFF, id, { expectedRevision: 1, reason: "No stock" }, opts()), "FORBIDDEN", "STAFF decline");
  await refused(s.declineBooking(ADMIN, id, { expectedRevision: 1 }, opts()), "VALIDATION_ERROR", "no reason");
  const declined = await s.declineBooking(ADMIN, id, { expectedRevision: 1, reason: "Film out of stock" }, opts());
  assert.deepEqual([declined.booking.status, declined.booking.cancellationKind], ["CANCELLED", "SHOP_DECLINED"]);
  const [a] = await audits(id);
  assert.deepEqual([a.action, a.toStatus, a.reason], ["STATUS_CHANGED", "CANCELLED", "Film out of stock"]);
  // Fill the day (cap 5), then reinstating is refused; freeing a unit allows it.
  const others = [];
  for (let i = 0; i < 5; i++) others.push(await book(select("S", "regular-tint"), day));
  await refused(s.setBookingStatus(ADMIN, id, { expectedRevision: 2, status: "PENDING", reason: "Declined by mistake" }, opts()), "SCHEDULE_CONFLICT", "full day");
  await s.declineBooking(ADMIN, others[0], { expectedRevision: 1, reason: "Customer asked" }, opts());
  await refused(s.setBookingStatus(STAFF, id, { expectedRevision: 2, status: "PENDING", reason: "x" }, opts()), "FORBIDDEN", "STAFF reinstate");
  const back = await s.setBookingStatus(ADMIN, id, { expectedRevision: 2, status: "PENDING", reason: "Declined by mistake" }, opts());
  assert.deepEqual([back.booking.status, back.booking.cancellationKind, back.booking.revision], ["PENDING", null, 3]);
});

test("W3 move: ADMIN, cap-checked target, closed days, range, new position and window; earlier bay days released", { skip }, async () => {
  const id = await book(select("S", "basic-wash"), "2027-03-04");
  const bay = await s.createBay(ADMIN, { name: "Move Bay", sortOrder: 1 }, opts());
  await s.setBay(STAFF, id, { expectedRevision: 1, date: "2027-03-04", bayId: bay.id }, opts());
  await refused(s.moveBooking(STAFF, id, { expectedRevision: 2, toDate: "2027-03-05", toQueueCode: "WASH" }, opts()), "FORBIDDEN", "STAFF move");
  for (let i = 0; i < 5; i++) await book(select("S", "basic-wash"), "2027-03-06");
  await refused(s.moveBooking(ADMIN, id, { expectedRevision: 2, toDate: "2027-03-06", toQueueCode: "WASH" }, opts()), "SCHEDULE_CONFLICT", "full target",
    (e) => assert.ok("toDate" in e.fieldErrors));
  await db.blockedDate.create({ data: { date: new Date("2027-03-07T00:00:00Z"), reason: "Staff outing", isFullDay: true } });
  await refused(s.moveBooking(ADMIN, id, { expectedRevision: 2, toDate: "2027-03-07", toQueueCode: "WASH" }, opts()), "SCHEDULE_CONFLICT", "closed day");
  await refused(s.moveBooking(ADMIN, id, { expectedRevision: 2, toDate: "2027-02-28", toQueueCode: "WASH" }, opts()), "VALIDATION_ERROR", "past day");
  await refused(s.moveBooking(ADMIN, id, { expectedRevision: 2, toDate: "2027-07-01", toQueueCode: "WASH" }, opts()), "VALIDATION_ERROR", "beyond 90 days");
  const moved = await s.moveBooking(ADMIN, id, { expectedRevision: 2, toDate: "2027-03-05", toQueueCode: "DETAILING_COATING" }, opts());
  assert.deepEqual([moved.booking.bookingDate, moved.booking.queueCode, moved.booking.queuePosition, moved.booking.revision, moved.booking.bay], ["2027-03-05", "DETAILING_COATING", 1, 3, null]);
  const row = await db.booking.findUniqueOrThrow({ where: { id } });
  assert.equal(row.startsAt.toISOString(), dayStart("2027-03-05"));
  // Rows from one transaction share the DB-stamped createdAt, so compare the move's rows as a set.
  const actions = (await audits(id)).map((a) => a.action);
  assert.deepEqual([actions[0], actions.slice(1).sort()], ["BAY_ASSIGNED", ["BAY_UNASSIGNED", "QUEUE_MOVED", "RESCHEDULED"]]);
  assert.equal((await s.moveBooking(ADMIN, id, { expectedRevision: 3, toDate: "2027-03-05", toQueueCode: "DETAILING_COATING" }, opts())).noChange, true);
});

test("W4 reorder: ADMIN, exactly the day's open bookings, revision per booking, order by new positions", { skip }, async () => {
  const day = "2027-03-08";
  const ids = [await book(select("M", "basic-wash"), day), await book(select("M", "basic-wash"), day), await book(select("M", "basic-wash"), day)];
  const list = (order: string[], rev = 1) => ({ bookings: order.map((id) => ({ id, expectedRevision: rev })) });
  await refused(s.reorderQueueDay(STAFF, "WASH", day, list([...ids].reverse()), opts()), "FORBIDDEN", "STAFF reorder");
  await refused(s.reorderQueueDay(ADMIN, "WASH", day, list(ids.slice(0, 2)), opts()), "VALIDATION_ERROR", "missing booking");
  await refused(s.reorderQueueDay(ADMIN, "WASH", day, list([...ids].reverse(), 2), opts()), "VERSION_CONFLICT", "stale");
  const result = await s.reorderQueueDay(ADMIN, "WASH", day, list([ids[2], ids[0], ids[1]]), opts());
  assert.deepEqual(result.queue.bookings.map((b) => b.id), [ids[2], ids[0], ids[1]]);
  assert.deepEqual(result.queue.bookings.map((b) => b.revision), [2, 2, 2]);
  for (const id of ids) assert.deepEqual((await audits(id)).map((a) => a.action), ["REORDERED"]);
});

test("W5-W8 lines: add from the head release, composition rules, soft removal, ADMIN price, status drives the booking", { skip }, async () => {
  const id = await book(select("S", "basic-wash"), "2027-03-09");
  const svc = (slug: string) => bySlug(r0(), slug).id;
  await refused(s.addLine(STAFF, id, { expectedRevision: 1, serviceId: svc("arcane-graphene"), quantity: 1 }, opts()), "FORBIDDEN", "STAFF add");
  await refused(s.addLine(ADMIN, id, { expectedRevision: 1, serviceId: svc("motorcycle-graphene"), quantity: 1 }, opts()), "VALIDATION_ERROR", "not offered for S");
  await refused(s.addLine(ADMIN, id, { expectedRevision: 1, serviceId: svc("basic-wash"), quantity: 1 }, opts()), "VALIDATION_ERROR", "duplicate");
  await refused(s.addLine(ADMIN, id, { expectedRevision: 1, serviceId: svc("arcane-graphene"), quantity: 2 }, opts()), "VALIDATION_ERROR", "vehicle quantity");
  const added = await s.addLine(ADMIN, id, { expectedRevision: 1, serviceId: svc("arcane-graphene"), quantity: 1 }, opts());
  const coating = added.booking.lines.find((l) => l.serviceId === svc("arcane-graphene"))!;
  assert.deepEqual([coating.priceStatus, coating.referenceSubtotalCentavos, coating.order, added.booking.totals.forQuoteCount, added.booking.totals.currentTotalCentavos],
    ["FOR_QUOTE", 1_310_000, 1, 1, 18000]);
  const withAddOn = await s.addLine(ADMIN, id, { expectedRevision: 2, serviceId: svc("bac-to-zero"), quantity: 1 }, opts());
  const addOn = withAddOn.booking.lines.find((l) => l.serviceId === svc("bac-to-zero"))!;
  // Removing the wash would orphan the wash add-on; remove the add-on first.
  const wash = withAddOn.booking.lines.find((l) => l.serviceId === svc("basic-wash"))!;
  await refused(s.removeLine(ADMIN, id, wash.id, { expectedRevision: 3 }, opts()), "VALIDATION_ERROR", "orphaned add-on");
  const removed = await s.removeLine(ADMIN, id, addOn.id, { expectedRevision: 3, reason: "Customer declined" }, opts());
  assert.equal(removed.booking.lines.find((l) => l.id === addOn.id)!.removed, true);
  // Price: ADMIN only, with a reason; the audit keeps the previous value.
  await refused(s.setLinePrice(STAFF, id, coating.id, { expectedRevision: 4, priceCentavos: 1_200_000, reason: "Inspected" }, opts()), "FORBIDDEN", "STAFF price");
  const priced = await s.setLinePrice(ADMIN, id, coating.id, { expectedRevision: 4, priceCentavos: 1_200_000, reason: "Inspected" }, opts());
  assert.deepEqual([priced.booking.totals.currentTotalCentavos, priced.booking.totals.forQuoteCount], [1_218_000, 0]);
  await s.setLinePrice(ADMIN, id, coating.id, { expectedRevision: 5, priceCentavos: 1_250_000, reason: "Extra panel" }, opts());
  const priceAudits = (await audits(id)).filter((a) => a.action === "PRICE_SET");
  assert.deepEqual(priceAudits.map((a) => [a.previousPriceCentavos, a.newPriceCentavos]), [[null, 1_200_000], [1_200_000, 1_250_000]]);
  // Line status: the first IN_PROGRESS line starts the booking (§16, R1), one revision, two audit rows.
  const started = await s.setLineStatus(STAFF, id, coating.id, { expectedRevision: 6, workStatus: "IN_PROGRESS" }, opts());
  assert.deepEqual([started.booking.status, started.booking.revision], ["IN_PROGRESS", 7]);
  const last = (await audits(id)).slice(-2).map((a) => [a.action, a.toRevision]);
  assert.deepEqual(last.sort(), [["LINE_STATUS_CHANGED", 7], ["STATUS_CHANGED", 7]]);
  assert.equal((await s.setLineStatus(STAFF, id, coating.id, { expectedRevision: 7, workStatus: "IN_PROGRESS" }, opts())).noChange, true);
  // The last base cannot go.
  await s.removeLine(ADMIN, id, wash.id, { expectedRevision: 7 }, opts());
  await refused(s.removeLine(ADMIN, id, coating.id, { expectedRevision: 8 }, opts()), "VALIDATION_ERROR", "last base");
});

test("W9 bays and W10/W11 bay list: STAFF assigns, ADMIN manages, versions and names checked", { skip }, async () => {
  const id = await book(select("S", "basic-wash"), "2027-03-10");
  await refused(s.createBay(STAFF, { name: "Bay X", sortOrder: 1 }, opts()), "FORBIDDEN", "STAFF bay list");
  const bay = await s.createBay(ADMIN, { name: "Bay 1", sortOrder: 1 }, opts());
  await refused(s.createBay(ADMIN, { name: " bay 1 ", sortOrder: 2 }, opts()), "VALIDATION_ERROR", "duplicate name");
  const other = await s.createBay(ADMIN, { name: "Bay 2", sortOrder: 2 }, opts());
  await refused(s.setBay(STAFF, id, { expectedRevision: 1, date: "2027-03-09", bayId: bay.id }, opts()), "VALIDATION_ERROR", "before the day");
  const a1 = await s.setBay(STAFF, id, { expectedRevision: 1, date: "2027-03-10", bayId: bay.id }, opts());
  assert.deepEqual(a1.booking.bay, { id: bay.id, name: "Bay 1" });
  assert.equal((await s.setBay(STAFF, id, { expectedRevision: 2, date: "2027-03-10", bayId: bay.id }, opts())).noChange, true);
  await s.setBay(STAFF, id, { expectedRevision: 2, date: "2027-03-10", bayId: other.id }, opts());
  const cleared = await s.setBay(STAFF, id, { expectedRevision: 3, date: "2027-03-10", bayId: null }, opts());
  assert.equal(cleared.booking.bay, null);
  await refused(s.updateBay(ADMIN, other.id, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z", isActive: false }, opts()), "VERSION_CONFLICT", "stale bay");
  const off = await s.updateBay(ADMIN, other.id, { expectedUpdatedAt: other.updatedAt, isActive: false }, opts());
  assert.equal(off.isActive, false);
  await refused(s.setBay(STAFF, id, { expectedRevision: 4, date: "2027-03-10", bayId: other.id }, opts()), "VALIDATION_ERROR", "inactive bay");
  assert.deepEqual((await db.bookingAuditEvent.findMany({ where: { bayId: bay.id, bookingId: null } })).map((a) => a.action), ["BAY_LIST_CHANGED"]);
});

test("W12-W14 caps: ADMIN only; never below committed bookings today or later; overrides; audited", { skip }, async () => {
  const day = "2027-03-11";
  for (let i = 0; i < 2; i++) await book(select("M", ["panel-repaint", 2]), day);
  const queue = await db.bookingQueue.findUniqueOrThrow({ where: { code: "REPAINT" } });
  await refused(s.setDefaultCap(STAFF, "REPAINT", { expectedRevision: queue.revision, dailyCap: 9 }, opts()), "FORBIDDEN", "STAFF cap");
  await refused(s.setDefaultCap(ADMIN, "REPAINT", { expectedRevision: queue.revision, dailyCap: 1 }, opts()), "SCHEDULE_CONFLICT", "below committed");
  await refused(s.setDefaultCap(ADMIN, "REPAINT", { expectedRevision: queue.revision + 1, dailyCap: 9 }, opts()), "VERSION_CONFLICT", "stale cap");
  const raised = await s.setDefaultCap(ADMIN, "REPAINT", { expectedRevision: queue.revision, dailyCap: 9 }, opts());
  assert.deepEqual([raised.dailyCap, raised.revision], [9, queue.revision + 1]);
  await refused(s.setCapOverride(ADMIN, "REPAINT", day, { expectedRevision: null, dailyCap: 1 }, opts()), "SCHEDULE_CONFLICT", "override below");
  const o = await s.setCapOverride(ADMIN, "REPAINT", day, { expectedRevision: null, dailyCap: 2 }, opts());
  await refused(s.setCapOverride(ADMIN, "REPAINT", day, { expectedRevision: null, dailyCap: 3 }, opts()), "VERSION_CONFLICT", "override exists");
  const o2 = await s.setCapOverride(ADMIN, "REPAINT", day, { expectedRevision: o.revision, dailyCap: 3 }, opts());
  await s.deleteCapOverride(ADMIN, "REPAINT", day, { expectedRevision: o2.revision }, opts());
  const caps = (await db.bookingAuditEvent.findMany({ where: { action: "CAP_CHANGED", queueCode: "REPAINT" }, orderBy: { createdAt: "asc" } }))
    .map((a) => [a.capDate?.toISOString().slice(0, 10) ?? null, a.previousCap, a.newCap]);
  assert.deepEqual(caps, [[null, 5, 9], [day, null, 2], [day, 2, 3], [day, 3, null]]);
  const view = await s.getCaps(STAFF, { from: day, to: day }, opts());
  assert.deepEqual(view.find((q) => q.code === "REPAINT")!.committed, [{ date: day, count: 2 }]);
});

test("W15 notify: no email, sent, rate limit, provider failure, and the send happens after commit", { skip }, async () => {
  const noEmail = await book(select("S", "basic-wash"), "2027-03-12");
  const sent: string[] = [];
  const sender = { async send(bookingId: string) { sent.push(bookingId); return "SENT" as const; } };
  const r1 = await s.notifyCustomer(STAFF, noEmail, { expectedRevision: 1 }, opts({ sender }));
  assert.deepEqual([r1.notice, (await audits(noEmail)).length, sent.length], ["NO_EMAIL", 0, 0]);
  const id = await book(select("S", "basic-wash"), "2027-03-12", { customerEmail: "c@example.test" });
  let duringSend: { active: number } | null = null;
  const watching = { async send(bookingId: string) { duringSend = (await import("@/server/auth/db-admission")).staffDbStats().STAFF_MUTATION; sent.push(bookingId); return "SENT" as const; } };
  const r2 = await s.notifyCustomer(STAFF, id, { expectedRevision: 1 }, opts({ sender: watching }));
  assert.deepEqual([r2.notice, r2.booking.revision, duringSend], ["SENT", 1, { active: 0, queued: 0 }]);
  assert.deepEqual((await audits(id)).map((a) => a.action), ["CUSTOMER_NOTIFIED"]);
  await refused(s.notifyCustomer(STAFF, id, { expectedRevision: 1 }, opts({ sender })), "RATE_LIMITED", "within 30 minutes", (e) => assert.ok((e.retryAfterSeconds ?? 0) > 0));
  const failing = await book(select("S", "basic-wash"), "2027-03-12", { customerEmail: "d@example.test" });
  const broken = { async send() { throw new Error("provider down"); } };
  const r3 = await s.notifyCustomer(ADMIN, failing, { expectedRevision: 1 }, opts({ sender: broken }));
  assert.deepEqual([r3.notice, (await audits(failing)).length], ["NOT_SENT", 1]);
});

test("W16 history: ADMIN only, one customer's bookings, fixed empty shape, keyed digest audit, fail closed, rate limit", { skip }, async () => {
  const phone = "+639281234567";
  const mine = await book(select("S", "basic-wash"), "2027-03-13", { customerPhone: phone, customerName: "History Person" });
  await book(select("S", "basic-wash"), "2027-03-13", { customerPhone: "+639289999999", customerName: "CANARY Other" });
  await refused(s.lookupCustomerHistory(STAFF, { phone }, opts({ ring })), "FORBIDDEN", "STAFF");
  const found = await s.lookupCustomerHistory(ADMIN, { phone: "0928 123 4567" }, opts({ ring }));
  assert.deepEqual(found.bookings.map((b) => b.id), [mine]);
  assert.equal(JSON.stringify(found).includes("CANARY"), false);
  const empty = { bookings: [], truncated: false };
  assert.deepEqual(await s.lookupCustomerHistory(ADMIN, { phone: "+639000000999" }, opts({ ring })), empty);
  assert.deepEqual(await s.lookupCustomerHistory(ADMIN, { phone: "not a phone" }, opts({ ring })), empty);
  const lookups = await db.bookingAuditEvent.findMany({ where: { action: "HISTORY_LOOKUP" }, orderBy: { createdAt: "asc" } });
  const { historyDigest } = await import("./history-key-ring");
  assert.deepEqual(lookups.map((a) => [a.phoneDigest, a.resultCount, a.bookingId]),
    [[historyDigest(ring, phone), 1, null], [historyDigest(ring, "+639000000999"), 0, null], [historyDigest(ring, null, "not a phone"), 0, null]]);
  assert.equal(JSON.stringify(lookups, (_k, x) => (typeof x === "bigint" ? x.toString() : x)).includes("9281234567"), false);
  assert.equal(JSON.stringify(events).includes("9281234567"), false, "no phone in logs");
  // No key ring: 503 before any lookup or audit.
  await refused(s.lookupCustomerHistory(ADMIN, { phone }, opts({ ring: null })), "RETRYABLE_ERROR", "no ring");
  assert.equal(await db.bookingAuditEvent.count({ where: { action: "HISTORY_LOOKUP" } }), 3);
  // Per-session limit: 10 per minute.
  const actor = { ...ADMIN, sessionId: randomUUID() };
  for (let i = 0; i < 10; i++) await s.lookupCustomerHistory(actor, { phone }, opts({ ring }));
  await refused(s.lookupCustomerHistory(actor, { phone }, opts({ ring })), "RATE_LIMITED", "11th lookup");
});

test("reads: the day view orders queues and positions, shows totals and for-quote lines, legacy and closed days; list, search and detail", { skip }, async () => {
  const day = "2027-03-14";
  const a = await book(select("S", "basic-wash"), day);
  const b = await book(select("S", "arcane-graphene", "basic-wash"), day);
  const c = await book(select("S", "basic-wash"), day);
  await s.declineBooking(ADMIN, a, { expectedRevision: 1, reason: "No show" }, opts());
  const view = await s.getDayQueues(STAFF, { date: day }, opts());
  assert.deepEqual(view.queues.map((q) => q.code), ["WASH", "DETAILING_COATING", "TINT_PPF", "REPAINT"]);
  const wash = view.queues[0], detailing = view.queues[1];
  assert.deepEqual(wash.bookings.map((x) => x.id), [c, a], "open by position, cancelled last");
  assert.deepEqual([wash.effectiveCap, wash.committed], [5, 1]);
  assert.deepEqual(detailing.bookings[0].totals, { receiptTotalCentavos: 18000, receiptEstimatedCentavos: 1_328_000, currentTotalCentavos: 18000,
    currentEstimateCentavos: 1_328_000, forQuoteCount: 1 });
  assert.equal(JSON.stringify(view).includes("+639"), false, "no phone in the day view");
  await db.blockedDate.create({ data: { date: new Date(day + "T00:00:00Z"), reason: "Water outage", isFullDay: true } });
  assert.deepEqual((await s.getDayQueues(STAFF, { date: day }, opts())).closed, { reason: "Water outage" });
  // List pagination is keyset and stable; search modes are echoed.
  const page1 = await s.listBookings(STAFF, { from: day, to: day, limit: 2 }, opts());
  const page2 = await s.listBookings(STAFF, { from: day, to: day, limit: 2, cursor: page1.nextCursor! }, opts());
  assert.deepEqual([...page1.items, ...page2.items].map((x) => x.id).sort(), [a, b, c].sort());
  assert.equal(page2.nextCursor, null);
  await refused(s.listBookings(STAFF, { q: "x" }, opts()), "VALIDATION_ERROR", "q on list");
  const ref = (await db.booking.findUniqueOrThrow({ where: { id: b } })).referenceCode;
  assert.deepEqual([(await s.searchBookings(STAFF, { q: ref.toLowerCase() }, opts())).searchMode, (await s.searchBookings(STAFF, { q: ref }, opts())).items.map((x) => x.id)], ["REFERENCE", [b]]);
  assert.equal((await s.searchBookings(STAFF, { q: "4567" }, opts())).searchMode, "PHONE_SUFFIX");
  assert.equal((await s.searchBookings(STAFF, { q: "Customer" }, opts())).searchMode, "NAME");
  await refused(s.searchBookings(STAFF, { q: "%%" }, opts()), "VALIDATION_ERROR", "unclassifiable");
  const d: AdminBookingDetail = await detail(a);
  assert.deepEqual([d.customerPhone, d.cancellationKind, d.history[0].action, d.history[0].reason], ["+639170000001", "SHOP_DECLINED", "STATUS_CHANGED", "No show"]);
  assert.deepEqual((await s.listBays(STAFF, opts())).map((x) => typeof x.name), (await db.bay.findMany()).map(() => "string"));
});

test("legacy bookings: status and decline only; queue, line and bay writes are not manageable", { skip }, async () => {
  const id = randomUUID();
  const size = r0().sizes[1];
  await db.$executeRawUnsafe(`INSERT INTO bookings (id,"referenceCode","customerName","customerPhone","vehicleModel","vehicleCategoryId","serviceId","bookingDate","startTime","endTime","startsAt","endsAt","durationMinutes","priceSnapshot","serviceNameSnapshot","vehicleCategoryNameSnapshot","idempotencyKey","requestHash","updatedAt")
    VALUES (${lit(id)},'ZEUS-LEG001','Legacy','+639000000001','Synthetic',${lit(size.id)},${lit(bySlug(r0(), "basic-wash").id)},'2027-03-15','08:00','08:30','2027-03-15T00:00:00Z','2027-03-15T00:30:00Z',30,180,'Legacy wash',${lit(size.name)},${lit(randomUUID())},'legacy',now())`);
  await refused(s.moveBooking(ADMIN, id, { expectedRevision: 1, toDate: "2027-03-16", toQueueCode: "WASH" }, opts()), "BOOKING_NOT_MANAGEABLE", "legacy move");
  await refused(s.setBay(STAFF, id, { expectedRevision: 1, date: "2027-03-15", bayId: null }, opts()), "BOOKING_NOT_MANAGEABLE", "legacy bay");
  const confirmed = await s.setBookingStatus(ADMIN, id, { expectedRevision: 1, status: "CONFIRMED" }, opts());
  assert.deepEqual([confirmed.booking.snapshot, confirmed.booking.status], ["LEGACY", "CONFIRMED"]);
  assert.ok((await s.getDayQueues(STAFF, { date: "2027-03-15" }, opts())).legacy.some((x) => x.id === id));
});

test("races: two staff on one booking, and a staff move against real P1-03 create for the last unit (D2)", { skip }, async () => {
  const id = await book(select("L", "basic-wash"), "2027-03-17");
  const results = await Promise.allSettled([s.setBookingStatus(ADMIN, id, { expectedRevision: 1, status: "CONFIRMED" }, opts()),
    s.declineBooking(ADMIN, id, { expectedRevision: 1, reason: "Duplicate" }, opts())]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code, "VERSION_CONFLICT");

  const { createServer } = await import("node:http");
  const { createDayBooking } = await import("../bookings-create");
  const { parseBookingConfiguration } = await import("../bookings-credentials");
  const { getBookingQuote } = await import("../catalog-quote");
  const config = parseBookingConfiguration({
    BOOKING_QUOTE_KEYS: "q:" + secret(10), BOOKING_QUOTE_ACTIVE_KID: "q",
    MANAGEMENT_GRANT_KEYS: "g:" + secret(11), MANAGEMENT_GRANT_ACTIVE_KID: "g",
    MANAGEMENT_SESSION_KEYS: "m:" + secret(12), MANAGEMENT_SESSION_ACTIVE_KID: "m",
    ONLINE_BOOKING_MODE: "OPEN", APP_ORIGIN: "http://localhost:3000", NODE_ENV: "test",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_ALLOWED_HOSTNAMES: "localhost", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1",
  });
  // Real HTTP challenge verification against a loopback stand-in, never Cloudflare.
  const challenge = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, hostname: "localhost", action: "booking_create" }));
  });
  await new Promise<void>(resolve => challenge.listen(0, "127.0.0.1", resolve));
  try {
    const target = new Date(Date.now() + 8 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
    const source = new Date(Date.parse(target) + 86400000).toISOString().slice(0, 10);
    await db.scheduleConfig.create({ data: { effectiveDate: new Date("2000-01-01") } });
    await db.timeSlot.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "08:00", endTime: "18:00", maxVehicleCapacity: 2 })) });
    for (let i = 0; i < 4; i++) await book(select("L", "basic-wash"), target);
    const mover = await book(select("L", "basic-wash"), source);
    const selection = select("L", "basic-wash");
    const quoted = await getBookingQuote(selection, { db, ring: config.quote });
    assert.ok(quoted.ok);
    if (!quoted.ok) throw Error("Synthetic quote refused");
    const create = createDayBooking({ contractVersion: 4, idempotencyKey: randomUUID(), ...selection, bookingDate: target,
      acceptedQuote: quoted.data.quote, turnstileToken: randomUUID(), customerName: "Race Customer", customerPhone: "+639170000099", vehicleModel: "Synthetic Car" }, {
      db, config, headers: new Headers({ origin: config.origin, "x-zeus-booking": "1", "content-type": "application/json", "x-forwarded-for": "192.0.2.199" }),
      turnstileEndpoint: "http://127.0.0.1:" + (challenge.address() as { port: number }).port + "/siteverify",
    });
    const race = await Promise.allSettled([
      s.moveBooking(ADMIN, mover, { expectedRevision: 1, toDate: target, toQueueCode: "WASH" }, opts({ now: () => new Date() })),
      create.then(r => { if (!r.result.ok) throw Object.assign(new Error("Customer create refused"), { code: r.result.error.code }); return r; }),
    ]);
    assert.deepEqual(race.map(r => r.status).sort(), ["fulfilled", "rejected"]);
    const loser = (race.find(r => r.status === "rejected") as PromiseRejectedResult).reason as { code: string };
    assert.ok(["SCHEDULE_CONFLICT", "FULLY_BOOKED"].includes(loser.code), loser.code);
    assert.equal(await db.booking.count({ where: { bookingDate: new Date(target + "T00:00:00Z"), queueCode: "WASH", status: { not: "CANCELLED" } } }), 5);
    assert.equal(await db.bookingOperation.count({ where: { kind: "CREATE", outcome: "COMMITTED" } }), race[1].status === "fulfilled" ? 1 : 0);
    assert.equal((await audits(mover)).filter(a => a.action === "RESCHEDULED").length, race[0].status === "fulfilled" ? 1 : 0);
  } finally {
    challenge.closeAllConnections();
    await new Promise<void>(resolve => challenge.close(() => resolve()));
  }
});

test("Codex F1: only eligible SHOP_DECLINED bookings can be reinstated, with target checks and no partial writes", { skip }, async (t) => {
  for (const [label, day, kind, inactive, code] of [
    ["customer cancellation", "2027-04-01", "CUSTOMER", false, "BOOKING_NOT_MANAGEABLE"],
    ["staff cancellation", "2027-04-02", "STAFF", false, "BOOKING_NOT_MANAGEABLE"],
    ["inactive queue", "2027-04-03", "SHOP_DECLINED", true, "VALIDATION_ERROR"],
    ["past day", "2027-02-28", "SHOP_DECLINED", false, "BOOKING_NOT_MANAGEABLE"],
    ["beyond horizon", "2027-06-01", "SHOP_DECLINED", false, "VALIDATION_ERROR"],
  ] as const) {
    await t.test(label, async () => {
      const id = await book(select("S", "regular-tint"), day, { status: "CANCELLED", cancellationKind: kind, terminalAt: new Date().toISOString() });
      const before = await db.booking.findUniqueOrThrow({ where: { id } });
      if (inactive) await db.bookingQueue.update({ where: { code: "TINT_PPF" }, data: { isActive: false } });
      try {
        await refused(s.setBookingStatus(ADMIN, id, { expectedRevision: 2, status: "PENDING", reason: "Review correction" }, opts()), "VERSION_CONFLICT", "revision first",
          (e) => assert.equal(e.currentBooking?.revision, 1));
        await refused(s.setBookingStatus(ADMIN, id, { expectedRevision: 1, status: "PENDING", reason: "Review correction" }, opts()), code, label);
        assert.deepEqual(await db.booking.findUniqueOrThrow({ where: { id } }), before);
        assert.equal((await audits(id)).length, 0);
      } finally {
        if (inactive) await db.bookingQueue.update({ where: { code: "TINT_PPF" }, data: { isActive: true } });
      }
    });
  }
  for (const day of ["2027-03-01", "2027-05-30"]) {
    const id = await book(select("S", "regular-tint"), day, { status: "CANCELLED", cancellationKind: "SHOP_DECLINED", terminalAt: new Date().toISOString() });
    await refused(s.setBookingStatus(STAFF, id, { expectedRevision: 1, status: "PENDING", reason: "Review correction" }, opts()), "FORBIDDEN", "ADMIN only");
    const changed = await s.setBookingStatus(ADMIN, id, { expectedRevision: 1, status: "PENDING", reason: "Review correction" }, opts());
    assert.deepEqual([changed.booking.status, changed.booking.revision, changed.booking.cancellationKind], ["PENDING", 2, null]);
    assert.deepEqual((await audits(id)).map((a) => [a.action, a.fromRevision, a.toRevision]), [["STATUS_CHANGED", 1, 2]]);
  }
});

test("Codex F2: historical LEGACY_V1 and CATALOG_V2 can complete without mutable line progress", { skip }, async () => {
  const priced = pricing.priceSelection(r0(), select("S", "basic-wash"));
  assert.equal(priced.kind, "QUOTED");
  if (priced.kind !== "QUOTED") throw new Error("Missing fixed-wash fixture");
  const q = priced.quote, line = q.lines[0];
  for (const version of ["LEGACY_V1", "CATALOG_V2"] as const) {
    const id = randomUUID(), lineId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
      await insert(tx, "bookings", { id, referenceCode: version === "LEGACY_V1" ? "ZEUS-LG0002" : "ZEUS-V20002", customerName: "Synthetic historical", customerPhone: "+639170000001", vehicleModel: "Synthetic",
        vehicleCategoryId: q.vehicleCategoryId, serviceId: line.serviceId, bookingDate: "2027-04-04", startTime: "08:00", endTime: "08:30", startsAt: "2027-04-04T00:00:00Z", endsAt: "2027-04-04T00:30:00Z", durationMinutes: 30,
        priceSnapshot: 180, serviceNameSnapshot: line.name, vehicleCategoryNameSnapshot: "Small", idempotencyKey: randomUUID(), requestHash: "historical-completion", updatedAt: new Date().toISOString(), status: "IN_PROGRESS", snapshotVersion: version,
        ...(version === "CATALOG_V2" ? { catalogReleaseId: releaseId, vehicleSizeCodeSnapshot: "S", catalogFingerprint: "a".repeat(64), pricingAlgorithm: "php-service-size-v2" } : {}) });
      if (version === "CATALOG_V2") await insert(tx, "booking_line_items", { id: lineId, bookingId: id, order: 0, releaseId, serviceId: line.serviceId, vehicleCategoryId: q.vehicleCategoryId,
        offerId: line.offerId, type: line.kind, nameSnapshot: line.name, unit: line.unit, quantity: 1, unitPriceCentavos: line.unitPriceCentavos, subtotalCentavos: line.subtotalCentavos, addedMinutes: 30 });
    });
    const originalLines = await db.bookingLineItem.findMany({ where: { bookingId: id } });
    if (version === "CATALOG_V2") await refused(s.setLineStatus(STAFF, id, lineId, { expectedRevision: 1, workStatus: "DONE" }, opts()), "BOOKING_NOT_MANAGEABLE", "historical line stays immutable");
    const completed = await s.setBookingStatus(STAFF, id, { expectedRevision: 1, status: "COMPLETED" }, opts());
    assert.deepEqual([completed.booking.status, completed.booking.revision], ["COMPLETED", 2]);
    assert.deepEqual(await db.bookingLineItem.findMany({ where: { bookingId: id } }), originalLines);
    assert.deepEqual((await audits(id)).map((a) => [a.action, a.fromStatus, a.toStatus, a.fromRevision, a.toRevision]), [["STATUS_CHANGED", "IN_PROGRESS", "COMPLETED", 1, 2]]);
    assert.equal((await s.setBookingStatus(ADMIN, id, { expectedRevision: 2, status: "COMPLETED" }, opts())).noChange, true);
    assert.equal((await audits(id)).length, 1);
  }
});

test("Codex F3: malformed cursor key returns 400 before a database permit", { skip }, async () => {
  const { encodeCursor, filterHash } = await import("./cursor");
  const cursor = encodeCursor({ s: "DAY_ASC", f: filterHash(["LIST", null, null, null, null]), k: ["not-a-date"] });
  let transactions = 0;
  const tracked = new Proxy(db, { get(target, key) { if (key === "$transaction") { transactions++; } return Reflect.get(target, key); } });
  await refused(s.listBookings(STAFF, { cursor }, opts({ db: tracked })), "VALIDATION_ERROR", "bad cursor",
    (e) => { assert.equal(e.status, 400); assert.ok(e.fieldErrors.cursor); });
  assert.equal(transactions, 0);
});

test("Codex F4: unknown and malformed history use equivalent query work, fixed empties and separate HMAC audits", { skip }, async () => {
  const queries: import("@prisma/client").Prisma.BookingFindManyArgs[] = [];
  const tracked = new Proxy(db, { get(target, key) {
    if (key === "$transaction") return <T,>(work: (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>, settings?: { maxWait?: number; timeout?: number; isolationLevel?: import("@prisma/client").Prisma.TransactionIsolationLevel }) =>
      target.$transaction((tx) => work(new Proxy(tx, { get(t, k) {
        if (k === "booking") return new Proxy(t.booking, { get(delegate, op) {
          if (op === "findMany") return (args: import("@prisma/client").Prisma.BookingFindManyArgs) => { queries.push(args); return delegate.findMany(args); };
          return Reflect.get(delegate, op);
        } });
        return Reflect.get(t, k);
      } })), settings);
    return Reflect.get(target, key);
  } });
  const before = await db.bookingAuditEvent.count({ where: { action: "HISTORY_LOOKUP" } });
  const unknown = await s.lookupCustomerHistory({ ...ADMIN, sessionId: randomUUID() }, { phone: "+639000000998" }, opts({ db: tracked, ring }));
  const malformed = await s.lookupCustomerHistory({ ...ADMIN, sessionId: randomUUID() }, { phone: "not a phone" }, opts({ db: tracked, ring }));
  assert.deepEqual(unknown, { bookings: [], truncated: false });
  assert.deepEqual(malformed, unknown);
  assert.equal(queries.length, 2, "both inputs run the lookup before the common audit");
  assert.deepEqual(queries[1], { ...queries[0], where: { customerPhone: "" } });
  const lookups = await db.bookingAuditEvent.findMany({ where: { action: "HISTORY_LOOKUP" }, orderBy: { createdAt: "asc" }, skip: before });
  const { historyDigest } = await import("./history-key-ring");
  assert.deepEqual(lookups.map((a) => [a.phoneDigest, a.resultCount]), [[historyDigest(ring, "+639000000998"), 0], [historyDigest(ring, null, "not a phone"), 0]]);
  assert.equal(JSON.stringify(events).includes("not a phone"), false);
});

test("D2 NULL caps: move and reinstate are unlimited; zero and reached set caps still refuse", { skip }, async () => {
  await s.setDefaultCap(ADMIN, "WASH", { expectedRevision: (await db.bookingQueue.findUniqueOrThrow({ where: { code: "WASH" } })).revision, dailyCap: null }, opts());
  const mover = await book(select("S", "basic-wash"), "2027-03-26");
  const moved = await s.moveBooking(ADMIN, mover, { expectedRevision: 1, toDate: "2027-03-27", toQueueCode: "WASH" }, opts());
  assert.deepEqual([moved.booking.bookingDate, moved.booking.revision], ["2027-03-27", 2]);
  const declined = await book(select("S", "basic-wash"), "2027-03-27");
  await s.declineBooking(ADMIN, declined, { expectedRevision: 1, reason: "Synthetic mistake" }, opts());
  const restored = await s.setBookingStatus(ADMIN, declined, { expectedRevision: 2, status: "PENDING", reason: "Restore" }, opts());
  assert.deepEqual([restored.booking.status, restored.booking.revision], ["PENDING", 3]);
  assert.deepEqual((await audits(mover)).map(a => a.action), ["RESCHEDULED"]);
  assert.equal((await audits(declined)).length, 2);
  for (const [date, cap] of [["2027-04-02", 0], ["2027-04-03", 1]] as const) {
    await s.setCapOverride(ADMIN, "WASH", date, { expectedRevision: null, dailyCap: cap }, opts());
    if (cap) await book(select("S", "basic-wash"), date);
    await refused(s.moveBooking(ADMIN, mover, { expectedRevision: 2, toDate: date, toQueueCode: "WASH" }, opts()), "SCHEDULE_CONFLICT", "configured cap", e => assert.equal(e.currentBooking?.revision, 2));
  }
  await s.declineBooking(ADMIN, declined, { expectedRevision: 3, reason: "Synthetic retry" }, opts());
  await s.setCapOverride(ADMIN, "WASH", "2027-03-27", { expectedRevision: null, dailyCap: 1 }, opts());
  await refused(s.setBookingStatus(ADMIN, declined, { expectedRevision: 4, status: "PENDING", reason: "Restore" }, opts()), "SCHEDULE_CONFLICT", "reinstatement set cap");
  assert.equal((await detail(declined)).revision, 4);
  assert.equal((await audits(declined)).length, 3);
});

test("D2 notification adapter sends via loopback SMTP only after the audited admin action commits", { skip }, async () => {
  const { smtpSimulation } = await import("../notifications/smtp.fixture");
  const notice = await import("./notice");
  const smtp = await smtpSimulation();
  try {
    const id = await book(select("S", "basic-wash"), "2027-03-28", { customerEmail: "turn@example.test" });
    const sender = notice.bookingTurnNoticeSender({ db, notification: smtp.config });
    const response = await s.notifyCustomer(STAFF, id, { expectedRevision: 1 }, opts({ sender: { async send(bookingId: string) {
      assert.equal(await db.bookingAuditEvent.count({ where: { bookingId, action: "CUSTOMER_NOTIFIED" } }), 1, "audit is visible from a separate connection before SMTP");
      return sender.send(bookingId);
    } } }));
    assert.equal(response.notice, "SENT");
    assert.equal(smtp.attempts.length, 1);
    assert.equal(smtp.attempts[0].to, "turn@example.test");
    await refused(s.notifyCustomer(STAFF, id, { expectedRevision: 1 }, opts({ sender })), "RATE_LIMITED", "second attempt");
    assert.equal(smtp.attempts.length, 1);
    const noEmail = await book(select("S", "basic-wash"), "2027-03-28");
    assert.equal((await s.notifyCustomer(STAFF, noEmail, { expectedRevision: 1 }, opts({ sender }))).notice, "NO_EMAIL");
    assert.equal((await audits(noEmail)).length, 0);
    const failed = await book(select("S", "basic-wash"), "2027-03-28", { customerEmail: "failure@example.test" });
    smtp.setRejected(true);
    assert.equal((await s.notifyCustomer(STAFF, failed, { expectedRevision: 1 }, opts({ sender }))).notice, "NOT_SENT");
    assert.equal((await audits(failed)).filter(a => a.action === "CUSTOMER_NOTIFIED").length, 1);
  } finally { await smtp.close(); }
});


test("D2 NULL settings: disabling a default limit preserves occupied days and their bookings", { skip }, async () => {
  const id = await book(select("S", ["panel-repaint", 1]), "2027-04-10");
  const queue = await db.bookingQueue.findUniqueOrThrow({ where: { code: "REPAINT" } });
  const result = await s.setDefaultCap(ADMIN, "REPAINT", { expectedRevision: queue.revision, dailyCap: null }, opts());
  assert.deepEqual([result.dailyCap, result.revision], [null, queue.revision + 1]);
  assert.equal((await detail(id)).status, "PENDING");
  assert.equal(await db.bookingAuditEvent.count({ where: { action: "CAP_CHANGED", queueCode: "REPAINT", previousCap: queue.dailyCap, newCap: null } }), 1);
});

test("D2 NULL settings: removing an override on an occupied day falls back to unlimited", { skip }, async () => {
  // Explicit synthetic setup isolates override removal from default-limit editing.
  await db.$executeRawUnsafe('UPDATE booking_queues SET "dailyCap"=NULL,revision=revision+1,"updatedAt"=now() WHERE code=\'WASH\'');
  const day = "2027-04-11", id = await book(select("S", "basic-wash"), day);
  const override = await s.setCapOverride(ADMIN, "WASH", day, { expectedRevision: null, dailyCap: 2 }, opts());
  await s.deleteCapOverride(ADMIN, "WASH", day, { expectedRevision: override.revision }, opts());
  assert.equal(await db.queueCapOverride.count({ where: { queueCode: "WASH", date: new Date(day + "T00:00:00Z") } }), 0);
  assert.equal((await detail(id)).status, "PENDING");
});

// P1-37 Commissions: bookings are completed through the real services (setBookingStatus, the same path the Bay board
// uses) as the runtime role (zeus_app) against real PostgreSQL with the real migration, and the accrual trigger does the
// rest. Own sibling database (<T007 name>_comm); synthetic data only; nothing is dropped. Without T007_TEST_DATABASE_URL
// the tests skip. Fixtures and trigger checks use the owner client (db); every service call uses the app client.
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
const commUrl = url ? siblingDatabaseUrl(url, "comm") : "postgresql://unused@localhost/zeus_t007_unused_comm";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: commUrl } } }); // owner
let app: PrismaClient; // zeus_app
type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
const manifest = readManifest();
let releaseId = "";
let ADMIN: StaffActor;
let seq = 0;
const at = (day: string) => ({ db: app, now: () => new Date(day + "T02:00:00.000Z") });
const opts = () => ({ db: app });

const lit = (x: unknown): string => (x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`);
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
  const id = randomUUID(), n = ++seq, reference = `ZEUS-C${String(n).padStart(5, "0")}`;
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
const dayOf = (n: number) => `2027-07-${String(n).padStart(2, "0")}`;
let dayCounter = 0;
const nextDay = () => dayOf(1 + (dayCounter++ % 28));

async function person(name: string, ratePercent?: string | null) {
  return s.addPerson(ADMIN, { name, ...(ratePercent === undefined ? {} : { ratePercent }) }, opts());
}
interface Job { id: string; reference: string; day: string }
// A booking brought to IN_PROGRESS through the real services, with the given workers assigned in order and an optional total.
async function inProgress(workers: string[], total?: number, withUnpriced = false): Promise<Job> {
  const day = nextDay();
  const b = await book(select("S", "basic-wash"), day);
  const o = at(day);
  if (total !== undefined) {
    const line = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: b.id } });
    await s.setLinePrice(ADMIN, b.id, line.id, { expectedRevision: await rev(b.id), priceCentavos: total, reason: "P1-37 test price" }, o);
  }
  if (withUnpriced) await s.addLine(ADMIN, b.id, { expectedRevision: await rev(b.id), serviceId: bySlug(r0(), "arcane-graphene").id, quantity: 1 }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "CONFIRMED" }, o);
  const n = ++seq;
  const bay = await s.createBay(ADMIN, { name: "Bay " + n, sortOrder: n, bayType: "WASH" }, o);
  await s.setBay(ADMIN, b.id, { expectedRevision: await rev(b.id), date: day, bayId: bay.id }, o);
  for (const w of workers) await s.assignWorker(ADMIN, b.id, w, { expectedRevision: await rev(b.id) }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "IN_PROGRESS" }, o);
  return { ...b, day };
}
async function finish(job: Job) {
  const o = at(job.day);
  for (const l of await db.bookingLineItem.findMany({ where: { bookingId: job.id, removedAt: null } }))
    await s.setLineStatus(ADMIN, job.id, l.id, { expectedRevision: await rev(job.id), workStatus: "DONE" }, o);
  await s.setBookingStatus(ADMIN, job.id, { expectedRevision: await rev(job.id), status: "COMPLETED" }, o);
}
const completed = async (workers: string[], total?: number, withUnpriced = false) => { const j = await inProgress(workers, total, withUnpriced); await finish(j); return j; };
// The money columns are bigint in the database (Codex F2); these helpers hand the assertions plain numbers (all test amounts are small).
const header = async (bookingId: string) => { const h = await db.commissionAccrual.findUnique({ where: { bookingId } }); return h && { ...h, serviceTotalCentavos: Number(h.serviceTotalCentavos) }; };
const entries = async (bookingId: string) => (await db.commissionEntry.findMany({ where: { bookingId }, orderBy: { position: "asc" } })).map((e) => ({ ...e, baseCentavos: Number(e.baseCentavos), amountCentavos: Number(e.amountCentavos) }));
const manilaDay = (d: Date) => new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
// A three-day window around today in Manila (completions use the real clock). The service allows ranges of a year at most.
const shiftDay = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const aroundToday = () => ({ from: shiftDay(manilaDay(new Date()), -1), to: shiftDay(manilaDay(new Date()), 1) });
const count = async (table: string, where = "TRUE") => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0].n);

async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}

before(async () => {
  if (skip) return;
  await createAndMigrate(root, commUrl);
  provisionRuntimeRole(commUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(commUrl) } } });
  pricing = await import("../catalog-pricing");
  s = await import("./index");
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, "p137-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  ADMIN = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

test("C1 completing a booking with one worker records the header, one entry and one audit row, in centavos, at the default 10%", { skip }, async () => {
  const w = await person("Solo Worker");
  const job = await completed([w.id], 100_001);
  const h = (await header(job.id))!;
  const booking = await db.booking.findUniqueOrThrow({ where: { id: job.id } });
  assert.deepEqual([h.serviceTotalCentavos, h.unpricedLineCount, h.creditedCount], [100_001, 0, 1]);
  assert.equal(h.completedOn.toISOString().slice(0, 10), manilaDay(booking.terminalAt!), "the Manila day of completion");
  const e = await entries(job.id);
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].staffId, e[0].position, e[0].baseCentavos, e[0].rateBp, e[0].amountCentavos, e[0].paidAt], [w.id, 1, 100_001, 1000, 10_000, null]);
  const audit = await db.adminAuditEvent.findMany({ where: { bookingId: job.id } });
  assert.deepEqual(audit.map((a) => [a.action, a.actorStaffId, a.entryCount]), [["COMMISSION_ACCRUED", null, 1]]);
});

test("C2 two workers split the total equally and each uses their own percentage", { skip }, async () => {
  const a = await person("Worker A", "15"), b = await person("Worker B", null);
  const job = await completed([a.id, b.id], 100_001);
  const e = await entries(job.id);
  assert.deepEqual(e.map((x) => [x.staffId, x.baseCentavos, x.rateBp, x.amountCentavos]), [[a.id, 50_001, 1500, 7_500], [b.id, 50_000, 1000, 5_000]]);
});

test("C3 three workers at 12.5%: leftover centavos go to the largest remainders and the amounts add up to exactly 12,500", { skip }, async () => {
  const s1 = await s.getCommissionSettings(ADMIN, opts());
  await s.setDefaultRate(ADMIN, { expectedRevision: s1.revision, ratePercent: "12.5" }, opts());
  const ws = [await person("Three A"), await person("Three B"), await person("Three C")];
  const job = await completed(ws.map((w) => w.id), 100_000);
  const e = await entries(job.id);
  assert.deepEqual(e.map((x) => x.baseCentavos), [33_334, 33_333, 33_333]);
  assert.deepEqual(e.map((x) => x.amountCentavos), [4_167, 4_167, 4_166]);
  assert.equal(e.reduce((sum, x) => sum + x.amountCentavos, 0), 12_500);
  assert.ok(e.every((x) => x.rateBp === 1250), "the default at that moment is stored on each entry");
  const settings = await s.getCommissionSettings(ADMIN, opts());
  await s.setDefaultRate(ADMIN, { expectedRevision: settings.revision, ratePercent: "10" }, opts());
});

test("C4 nobody assigned: a header with creditedCount 0 and no entries, shown as a warning", { skip }, async () => {
  const job = await completed([], 50_000);
  const h = (await header(job.id))!;
  assert.deepEqual([h.creditedCount, h.serviceTotalCentavos], [0, 50_000]);
  assert.equal((await entries(job.id)).length, 0);
  const day = h.completedOn.toISOString().slice(0, 10);
  const summary = await s.listCommissions(ADMIN, { from: day, to: day }, opts());
  assert.ok(summary.warnings.nobodyCredited >= 1);
});

test("C5 a service with no final price is flagged and the commission is on the priced total only", { skip }, async () => {
  const w = await person("Unpriced Worker", "10");
  const job = await completed([w.id], undefined, true);
  const h = (await header(job.id))!;
  assert.equal(h.unpricedLineCount, 1);
  assert.equal(h.serviceTotalCentavos, 18_000, "only the priced wash counts");
  const [e] = await entries(job.id);
  assert.deepEqual([e.baseCentavos, e.amountCentavos], [18_000, 1_800]);
  const day = h.completedOn.toISOString().slice(0, 10);
  const summary = await s.listCommissions(ADMIN, { from: day, to: day }, opts());
  assert.ok(summary.warnings.unpricedEntries >= 1);
});

test("C6 a legacy booking records nothing", { skip }, async () => {
  // Completed with the trigger off (so nothing is recorded), then reshaped as a legacy row the way the check constraint
  // requires, then the accrual is asked for it: a legacy booking is not eligible, so nothing is written.
  const w = await person("Legacy Worker", "10");
  await db.$executeRawUnsafe(`ALTER TABLE bookings DISABLE TRIGGER commission_accrue_on_complete`);
  let job: Job;
  try { job = await completed([w.id], 20_000); } finally { await db.$executeRawUnsafe(`ALTER TABLE bookings ENABLE TRIGGER commission_accrue_on_complete`); }
  assert.equal(await header(job.id), null);
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    // A real legacy booking never had a bay assignment; leaving one behind would fail the board's global validation for everyone.
    await tx.$executeRawUnsafe(`DELETE FROM booking_bay_assignments WHERE "bookingId" = '${job.id}'`);
    await tx.$executeRawUnsafe(`UPDATE bookings SET "snapshotVersion" = 'LEGACY_V1', "queueCode" = NULL, "queuePosition" = NULL, "receiptTotalCentavos" = NULL,
      "receiptEstimatedCentavos" = NULL, "startTime" = '09:00', "endTime" = '10:00', "durationMinutes" = 60, "catalogReleaseId" = NULL,
      "catalogFingerprint" = NULL, "pricingAlgorithm" = NULL, "vehicleSizeCodeSnapshot" = NULL WHERE id = '${job.id}'`);
  });
  const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT commission_accrue('${job.id}') AS n`);
  assert.equal(Number(n), 0);
  assert.equal(await header(job.id), null);
  assert.equal((await entries(job.id)).length, 0);
  assert.equal(await count("admin_audit_events", `"bookingId" = '${job.id}'`), 0);
});

test("C7 the trigger fires only on the move into COMPLETED: other updates, a repeated COMPLETED and a second accrual change nothing", { skip }, async () => {
  const w = await person("Idempotent Worker", "10");
  const job = await completed([w.id], 40_000);
  const snapshot = async () => [await count("commission_accruals"), await count("commission_entries"), await count("admin_audit_events")];
  const before = await snapshot();
  // Another column on a completed booking (a column the runtime role may update).
  await app.$executeRawUnsafe(`UPDATE bookings SET "updatedAt" = now() WHERE id = '${job.id}'`);
  assert.deepEqual(await snapshot(), before, "an update of another column");
  // The same status again: the service reports no change and runs no UPDATE.
  const again = await s.setBookingStatus(ADMIN, job.id, { expectedRevision: await rev(job.id), status: "COMPLETED" }, at(job.day));
  assert.equal(again.noChange, true);
  assert.deepEqual(await snapshot(), before, "COMPLETED twice");
  // Running the accrual again is a no-op (the header key), whoever calls it.
  const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT commission_accrue('${job.id}') AS n`);
  assert.equal(Number(n), 0);
  assert.deepEqual(await snapshot(), before, "a second accrual");
  // The trigger's own WHEN clause: an UPDATE of status to the value it already has is not a transition.
  const trig = await db.$queryRawUnsafe<{ def: string }[]>(`SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'commission_accrue_on_complete' AND NOT tgisinternal`);
  assert.equal(trig.length, 1);
  assert.match(trig[0].def, /AFTER UPDATE OF status ON .*bookings/);
  // PostgreSQL prints the stored WHEN clause in lower case with the enum cast spelled out.
  assert.match(trig[0].def, /old\.status IS DISTINCT FROM 'COMPLETED'/i);
  assert.match(trig[0].def, /new\.status = 'COMPLETED'/i);
  assert.match(trig[0].def, /snapshotVersion" = 'QUEUE_V3'/);
});

test("C8 changing a percentage later never rewrites an earlier record", { skip }, async () => {
  const w = await person("History Worker", "10");
  const job = await completed([w.id], 100_000);
  const [before] = await entries(job.id);
  const fresh = (await s.listTeam(ADMIN, opts())).people.find((p) => p.id === w.id)!;
  await s.updatePerson(ADMIN, w.id, { expectedRevision: fresh.revision, ratePercent: "50" }, opts());
  const [after] = await entries(job.id);
  assert.deepEqual([after.rateBp, after.amountCentavos, after.baseCentavos], [before.rateBp, before.amountCentavos, before.baseCentavos]);
  const job2 = await completed([w.id], 100_000);
  assert.equal((await entries(job2.id))[0].rateBp, 5000, "later completions use the new percentage");
});

test("C9 mark paid and unpaid: audited per entry, idempotent, unknown ids counted, other people's entries untouched", { skip }, async () => {
  const a = await person("Paid A", "10"), b = await person("Paid B", "10");
  const job = await completed([a.id, b.id], 100_000);
  const [ea, eb] = await entries(job.id);
  const first = await s.setCommissionsPaid(ADMIN, { ids: [ea.id, randomUUID()], paid: true }, opts());
  assert.deepEqual(first, { changed: 1, unknown: 1 });
  const paidA = (await entries(job.id))[0], unpaidB = (await entries(job.id))[1];
  assert.deepEqual([paidA.paidByStaffId, unpaidB.paidAt], [ADMIN.staffId, null]);
  assert.ok(paidA.paidAt);
  assert.deepEqual(await s.setCommissionsPaid(ADMIN, { ids: [ea.id], paid: true }, opts()), { changed: 0, unknown: 0 }, "already paid");
  const rows = await db.adminAuditEvent.findMany({ where: { bookingId: job.id, action: { in: ["COMMISSION_PAID", "COMMISSION_UNPAID"] } } });
  assert.deepEqual(rows.map((r) => [r.action, r.targetStaffId, r.newValue]), [["COMMISSION_PAID", a.id, String(ea.amountCentavos)]]);
  assert.deepEqual(await s.setCommissionsPaid(ADMIN, { ids: [ea.id, eb.id], paid: false }, opts()), { changed: 1, unknown: 0 });
  assert.equal((await entries(job.id))[0].paidAt, null);
  for (const bad of [{ ids: [], paid: true }, { ids: ["not-a-uuid"], paid: true }, { ids: [ea.id], paid: "yes" }, { ids: Array.from({ length: 201 }, () => randomUUID()), paid: true }, { ids: [ea.id], paid: true, amount: 1 }])
    await refused(s.setCommissionsPaid(ADMIN, bad, opts()), "VALIDATION_ERROR", JSON.stringify(bad).slice(0, 40));
  await refused(s.setCommissionsPaid({ ...ADMIN, role: "STAFF" }, { ids: [ea.id], paid: true }, opts()), "FORBIDDEN", "STAFF");
});

test("C10 an entry's money can never be changed or deleted, even by the owner, and a hand-built set that does not add up is rejected at commit", { skip }, async () => {
  const w = await person("Immutable Worker", "10");
  const job = await completed([w.id], 100_000);
  const [e] = await entries(job.id);
  for (const col of ['"amountCentavos" = 1', '"baseCentavos" = 1', '"rateBp" = 1', `"staffId" = '${ADMIN.staffId}'`, '"position" = 2', `"bookingId" = '${job.id}x'`])
    await assert.rejects(db.$executeRawUnsafe(`UPDATE commission_entries SET ${col} WHERE id = '${e.id}'`), /immutable|violates/i, col);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM commission_entries WHERE id = '${e.id}'`), /cannot be deleted/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE commission_entries, commission_adjustments`), /Commission records cannot be truncated/);
  await assert.rejects(db.$executeRawUnsafe(`UPDATE commission_accruals SET "creditedCount" = 9 WHERE "bookingId" = '${job.id}'`), /immutable/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM commission_accruals WHERE "bookingId" = '${job.id}'`), /cannot be deleted/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM commission_settings`), /cannot be deleted/);
  // The commit-time check: an owner-built header and entries whose amounts do not add up are refused at COMMIT.
  const b = await book(select("S", "basic-wash"), nextDay());
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
    await tx.$executeRawUnsafe(`INSERT INTO commission_accruals ("bookingId", "serviceTotalCentavos", "unpricedLineCount", "creditedCount", "completedOn") VALUES ('${b.id}', 1000, 0, 1, '2027-07-01')`);
    await tx.$executeRawUnsafe(`INSERT INTO commission_entries ("bookingId", "staffId", "position", "baseCentavos", "rateBp", "amountCentavos") VALUES ('${b.id}', '${w.id}', 1, 1000, 1000, 999)`);
  }), /ZC009|add up|within one centavo/i);
  assert.equal(await header(b.id), null, "nothing was kept");
});

test("C11 the default percentage: a stale revision changes nothing, the new value is audited, and the screen has a clear value to show", { skip }, async () => {
  const cur = await s.getCommissionSettings(ADMIN, opts());
  await refused(s.setDefaultRate(ADMIN, { expectedRevision: cur.revision + 5, ratePercent: "11" }, opts()), "VERSION_CONFLICT", "stale");
  assert.equal((await s.getCommissionSettings(ADMIN, opts())).defaultRateBp, cur.defaultRateBp);
  const same = await s.setDefaultRate(ADMIN, { expectedRevision: cur.revision, ratePercent: String(cur.defaultRateBp / 100) }, opts());
  assert.equal(same.revision, cur.revision, "no change, no revision bump");
  const set = await s.setDefaultRate(ADMIN, { expectedRevision: cur.revision, ratePercent: "11.25" }, opts());
  assert.deepEqual([set.defaultRateBp, set.revision], [1125, cur.revision + 1]);
  const row = (await db.adminAuditEvent.findMany({ where: { action: "COMMISSION_DEFAULT_SET" }, orderBy: { createdAt: "desc" } }))[0];
  assert.deepEqual([row.previousValue, row.newValue, row.actorStaffId], [String(cur.defaultRateBp), "1125", ADMIN.staffId]);
  for (const bad of ["101", "-1", "1.234", "", "abc", "10%"]) await refused(s.setDefaultRate(ADMIN, { expectedRevision: set.revision, ratePercent: bad }, opts()), "VALIDATION_ERROR", bad);
  await s.setDefaultRate(ADMIN, { expectedRevision: set.revision, ratePercent: "10" }, opts());
});

test("C12 an accrual that fails still lets the booking complete, leaves an audit row with no personal data, and repair redoes it exactly once", { skip }, async () => {
  const w = await person("Failing Worker", "10");
  const job = await inProgress([w.id], 60_000);
  await db.$executeRawUnsafe(`ALTER TABLE commission_entries ADD CONSTRAINT test_force_fail CHECK ("amountCentavos" < 0) NOT VALID`);
  try {
    await finish(job);
  } finally {
    await db.$executeRawUnsafe(`ALTER TABLE commission_entries DROP CONSTRAINT test_force_fail`);
  }
  assert.equal((await db.booking.findUniqueOrThrow({ where: { id: job.id } })).status, "COMPLETED", "the booking completed");
  assert.equal(await header(job.id), null, "the failed accrual left no partial record");
  assert.equal((await entries(job.id)).length, 0);
  const failed = await db.adminAuditEvent.findMany({ where: { bookingId: job.id } });
  assert.deepEqual(failed.map((f) => [f.action, f.actorStaffId, f.reason]), [["COMMISSION_ACCRUAL_FAILED", null, "SQLSTATE 23514"]]);
  const text = JSON.stringify(failed, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  for (const pii of ["Failing", "Worker", "Zed Customer", "639170000888", "example.test", "ZZZ9999", "Synthetic Roadster", "Gate code", "violates", "amountCentavos"]) assert.ok(!text.includes(pii), `the failure row leaked ${pii}`);
  const summary = await s.listCommissions(ADMIN, aroundToday(), opts());
  assert.ok(summary.warnings.missingRecords >= 1, "the screen shows records are missing");
  const first = await s.repairCommissions(ADMIN, opts());
  assert.ok(first.repaired >= 1);
  const [e] = await entries(job.id);
  assert.deepEqual([e.baseCentavos, e.amountCentavos], [60_000, 6_000]);
  const second = await s.repairCommissions(ADMIN, opts());
  assert.equal(second.repaired, 0, "repair is idempotent");
  assert.equal((await entries(job.id)).length, 1);
  assert.equal(await count("admin_audit_events", `"bookingId" = '${job.id}' AND action = 'COMMISSION_ACCRUED'`), 1);
  await refused(s.repairCommissions({ ...ADMIN, role: "STAFF" }, opts()), "FORBIDDEN", "STAFF repair");
});

test("C12b a wrong result from the rule itself is caught by the independent check: the booking completes, nothing is kept, and SQLSTATE ZC009 is audited", { skip }, async () => {
  const w = await person("Wrong Rule Worker", "10");
  const job = await inProgress([w.id], 100_000);
  const [{ def }] = await db.$queryRawUnsafe<{ def: string }[]>(`SELECT pg_get_functiondef('commission_split(bigint, integer[])'::regprocedure) AS def`);
  // A deliberately wrong rule: every person is given the whole total as their commission.
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION commission_split(p_base bigint, p_rates integer[]) RETURNS TABLE(idx integer, share_centavos bigint, amount_centavos bigint)
    LANGUAGE sql IMMUTABLE AS $$ SELECT g, p_base, p_base FROM generate_series(1, COALESCE(array_length(p_rates, 1), 0)) g $$`);
  try {
    await finish(job);
  } finally {
    await db.$executeRawUnsafe(def); // the real rule, exactly as the migration defined it
  }
  assert.equal((await db.booking.findUniqueOrThrow({ where: { id: job.id } })).status, "COMPLETED", "completion is not blocked by a wrong rule");
  assert.equal(await header(job.id), null, "no record of a wrong amount was kept");
  assert.equal((await entries(job.id)).length, 0);
  const rows = await db.adminAuditEvent.findMany({ where: { bookingId: job.id } });
  assert.deepEqual(rows.map((r) => [r.action, r.reason]), [["COMMISSION_ACCRUAL_FAILED", "SQLSTATE ZC009"]]);
  // The real rule is back: repair now records the right amount.
  await s.repairCommissions(ADMIN, opts());
  assert.equal((await entries(job.id))[0].amountCentavos, 10_000);
});

test("C13 history before the release is never back-filled, and the Manila day is cut at midnight +08:00", { skip }, async () => {
  const w = await person("Boundary Worker", "10");
  await db.$executeRawUnsafe(`ALTER TABLE bookings DISABLE TRIGGER commission_accrue_on_complete`);
  let late: Job, early: Job, old: Job;
  try {
    early = await completed([w.id], 10_000);
    late = await completed([w.id], 10_000);
    old = await completed([w.id], 10_000);
  } finally {
    await db.$executeRawUnsafe(`ALTER TABLE bookings ENABLE TRIGGER commission_accrue_on_complete`);
  }
  const setTerminal = (id: string, at: string) => db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`UPDATE bookings SET "terminalAt" = '${at}' WHERE id = '${id}'`);
  });
  await setTerminal(early.id, "2027-03-01T15:59:59.000Z"); // 23:59:59 on 1 March in Manila
  await setTerminal(late.id, "2027-03-01T16:00:00.000Z"); //  00:00:00 on 2 March in Manila
  await setTerminal(old.id, "2020-01-01T00:00:00.000Z"); //  before commissions began
  await s.repairCommissions(ADMIN, opts());
  assert.equal((await header(early.id))!.completedOn.toISOString().slice(0, 10), "2027-03-01");
  assert.equal((await header(late.id))!.completedOn.toISOString().slice(0, 10), "2027-03-02");
  assert.equal(await header(old.id), null, "a booking completed before commissions began is not back-filled");
  const mar1 = await s.listCommissions(ADMIN, { from: "2027-03-01", to: "2027-03-01", staffId: w.id }, opts());
  const mar2 = await s.listCommissions(ADMIN, { from: "2027-03-02", to: "2027-03-02", staffId: w.id }, opts());
  assert.deepEqual([mar1.entries.map((e) => e.bookingReference), mar2.entries.map((e) => e.bookingReference)], [[early.reference], [late.reference]]);
  assert.deepEqual([mar1.grandTotal.earnedCentavos, mar2.grandTotal.earnedCentavos], [1_000, 1_000]);
});

test("C14 per-person totals come from stored centavos: earned, paid and unpaid, with filters by person and by status", { skip }, async () => {
  const a = await person("Totals A", "10"), b = await person("Totals B", "20");
  const j1 = await completed([a.id, b.id], 100_000);
  await completed([a.id], 50_000);
  const all = await s.listCommissions(ADMIN, { ...aroundToday(), staffId: a.id }, opts());
  const earned = (await db.commissionEntry.findMany({ where: { staffId: a.id } })).reduce((n, e) => n + Number(e.amountCentavos), 0);
  assert.equal(all.totals.length, 1);
  assert.deepEqual([all.totals[0].earnedCentavos, all.totals[0].paidCentavos, all.totals[0].unpaidCentavos, all.totals[0].entryCount], [earned, 0, earned, 2]);
  const ea = (await entries(j1.id)).find((e) => e.staffId === a.id)!;
  await s.setCommissionsPaid(ADMIN, { ids: [ea.id], paid: true }, opts());
  const after = await s.listCommissions(ADMIN, { ...aroundToday(), staffId: a.id }, opts());
  assert.deepEqual([after.totals[0].paidCentavos, after.totals[0].unpaidCentavos], [ea.amountCentavos, earned - ea.amountCentavos]);
  const paidOnly = await s.listCommissions(ADMIN, { ...aroundToday(), staffId: a.id, status: "PAID" }, opts());
  assert.deepEqual(paidOnly.entries.map((e) => e.id), [ea.id]);
  assert.equal(paidOnly.totals[0].earnedCentavos, earned, "the totals ignore the status filter");
  const unpaidOnly = await s.listCommissions(ADMIN, { ...aroundToday(), staffId: a.id, status: "UNPAID" }, opts());
  assert.equal(unpaidOnly.entries.length, 1);
  for (const bad of [{ from: "2027-03-02", to: "2027-03-01" }, { from: "2020-01-01", to: "2027-01-01" }, { from: "bad", to: "2027-01-01" }, { from: "2027-01-01", to: "2027-01-02", status: "MAYBE" }, { from: "2027-01-01", to: "2027-01-02", extra: 1 }])
    await refused(s.listCommissions(ADMIN, bad, opts()), "VALIDATION_ERROR", JSON.stringify(bad));
  await refused(s.listCommissions({ ...ADMIN, role: "STAFF" }, { from: "2027-01-01", to: "2027-01-02" }, opts()), "FORBIDDEN", "STAFF");
  const text = JSON.stringify(all);
  for (const pii of ["Zed Customer", "639170000888", "example.test", "ZZZ9999", "Synthetic Roadster", "Gate code"]) assert.ok(!text.includes(pii), `the commission list leaked ${pii}`);
});

test("C15 deleting a booking: refused while commission entries exist, allowed when only an empty header exists", { skip }, async () => {
  const w = await person("Delete Worker", "10");
  const withMoney = await completed([w.id], 30_000);
  await refused(s.deleteBooking(ADMIN, withMoney.id, { expectedRevision: await rev(withMoney.id), reference: withMoney.reference }, at(withMoney.day)), "BOOKING_NOT_MANAGEABLE", "entries", (e) =>
    assert.match(e.message, /payout, assignment or stock record still points/));
  assert.equal(await count("bookings", `id = '${withMoney.id}'`), 1);
  assert.equal((await entries(withMoney.id)).length, 1);
  const nobody = await completed([], 30_000);
  assert.ok(await header(nobody.id));
  const done = await s.deleteBooking(ADMIN, nobody.id, { expectedRevision: await rev(nobody.id), reference: nobody.reference }, at(nobody.day));
  assert.deepEqual([done.deleted, done.reference], [true, nobody.reference]);
  assert.equal(await header(nobody.id), null, "the empty header went with its booking");
  assert.equal(await count("bookings", `id = '${nobody.id}'`), 0);
});

test("C16 a completion and an admin write at the same moment do not deadlock and leave consistent rows (the shop lock orders them)", { skip, timeout: 240_000 }, async () => {
  const w = await person("Concurrent Worker", "10");
  const keep = await person("Concurrent Keep", "10");
  const base = await completed([w.id], 20_000);
  const [paidTarget] = await entries(base.id);
  for (let round = 0; round < 6; round++) {
    const job = await inProgress([w.id, keep.id], 20_000 + round);
    const disposable = await person(`Disposable ${round}`);
    const outcomes = await Promise.allSettled([
      finish(job),
      s.removePerson(ADMIN, disposable.id, { expectedRevision: 1 }, opts()),
      s.setCommissionsPaid(ADMIN, { ids: [paidTarget.id], paid: round % 2 === 0 }, opts()),
      s.updatePerson(ADMIN, keep.id, { expectedRevision: (await s.listTeam(ADMIN, opts())).people.find((p) => p.id === keep.id)!.revision, ratePercent: String(10 + round) }, opts()),
    ]);
    for (const o of outcomes) if (o.status === "rejected") assert.ok(!/deadlock|40P01/i.test(String(o.reason)), `round ${round}: ${String(o.reason)}`);
    assert.equal(outcomes[0].status, "fulfilled", `round ${round}: the completion succeeded`);
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: job.id } })).status, "COMPLETED");
    const e = await entries(job.id);
    assert.equal(e.length, 2, `round ${round}: both workers credited`);
  }
  // Every record in the database still passes the independent consistency check.
  const all = await db.commissionAccrual.findMany({ select: { bookingId: true } });
  // The check returns void, which Prisma cannot read as a column, so it runs as a statement; it raises if anything is off.
  for (const { bookingId } of all) await db.$executeRawUnsafe(`SELECT commission_consistency_check('${bookingId}')`);
  assert.ok(all.length >= 6);
});

test("C17 deactivating or removing a person who still has an open job is refused, and works once the job is finished", { skip }, async () => {
  const w = await person("Open Job Worker", "10");
  const job = await inProgress([w.id], 15_000);
  const p = (await s.listTeam(ADMIN, opts())).people.find((x) => x.id === w.id)!;
  assert.equal(p.openJobs, 1);
  await refused(s.setPersonActive(ADMIN, w.id, { expectedRevision: p.revision, active: false }, opts()), "NOT_ALLOWED", "deactivate", (e) => assert.match(e.message, /open jobs/));
  await refused(s.removePerson(ADMIN, w.id, { expectedRevision: p.revision }, opts()), "NOT_ALLOWED", "remove", (e) => assert.match(e.message, /open jobs/));
  assert.equal((await db.staff.findUniqueOrThrow({ where: { id: w.id } })).isActive, true);
  await finish(job);
  const removed = await s.removePerson(ADMIN, w.id, { expectedRevision: p.revision }, opts());
  assert.equal(removed.outcome, "DEACTIVATED", "they have commission history now, so they are deactivated, not erased");
  assert.equal((await entries(job.id)).length, 1, "their earnings are still there");
});

// Codex F1 (High). The runtime role may create temporary objects, and PostgreSQL searches the temporary schema FIRST for types
// and relations unless pg_temp is named last in a function's search_path. Without that, a temporary domain called
// "AdminAuditAction" made its CHECK run inside the SECURITY DEFINER function, with the owner's rights, and it granted the app
// UPDATE on staff. Here the app role builds that trap (plus temporary tables that shadow every table the functions use), runs
// every admin function and delete_booking on the same connection, and must neither gain the privilege nor lose any function.
test("C18 a temporary type, table or function made by the runtime role cannot hijack any admin function or delete_booking", { skip }, async () => {
  const w = await person("Hijack Worker", "10");
  const job = await completed([w.id], 100_000);
  const entry = (await entries(job.id))[0];
  const pending = await book(select("S", "basic-wash"), nextDay());
  const pendingRevision = await rev(pending.id);
  const [{ r: settingsRevision }] = await db.$queryRawUnsafe<{ r: number }[]>(`SELECT revision AS r FROM commission_settings WHERE id = 1`);
  const actor = lit(ADMIN.staffId);
  const seen: string[] = [];
  class Done extends Error {}
  await assert.rejects(app.$transaction(async (tx) => {
    function q<R>(sql: string) { return tx.$queryRawUnsafe<R[]>(sql); }
    const gained = async (label: string) => {
      const [{ g }] = await q<{ g: boolean }>(`SELECT has_table_privilege('zeus_app', 'public.staff', 'UPDATE') AS g`);
      assert.equal(g, false, `${label}: the runtime role must not gain UPDATE on staff`);
      seen.push(label);
    };
    // The trap: a temporary function that would grant the app write access, run by a temporary domain's CHECK.
    await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.evil(v text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN GRANT UPDATE ON public.staff TO zeus_app; RETURN true; END $$`);
    await tx.$executeRawUnsafe(`CREATE DOMAIN pg_temp."AdminAuditAction" AS public."AdminAuditAction" CHECK (pg_temp.evil(VALUE::text))`);
    // Temporary tables that would capture any unqualified table name inside the functions.
    for (const t of ["staff", "bookings", "staff_credentials", "staff_sessions", "booking_worker_assignments", "commission_entries", "commission_accruals", "commission_settings", "admin_audit_events", "booking_line_items"])
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE "${t}" (id text)`);
    await gained("traps set");

    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.admin_team_list(${actor})`);
    assert.ok(n >= 2, "admin_team_list still works"); await gained("admin_team_list");
    const [{ id }] = await q<{ id: string }>(`SELECT public.admin_staff_create(${actor}, 'Hijack Probe', '', '', NULL) AS id`);
    assert.ok(id, "admin_staff_create still works"); await gained("admin_staff_create");
    const [{ u }] = await q<{ u: { changed: boolean } }>(`SELECT public.admin_staff_update(${actor}, ${lit(id)}, 'Hijack Probe 2', NULL, NULL, 'SET', 1500, 1) AS u`);
    assert.equal(u.changed, true, "admin_staff_update still works"); await gained("admin_staff_update");
    const [{ a }] = await q<{ a: { changed: boolean } }>(`SELECT public.admin_staff_set_active(${actor}, ${lit(id)}, false, 2) AS a`);
    assert.equal(a.changed, true, "admin_staff_set_active (deactivate) still works"); await gained("admin_staff_set_active deactivate");
    const [{ b }] = await q<{ b: { changed: boolean } }>(`SELECT public.admin_staff_set_active(${actor}, ${lit(id)}, true, 3) AS b`);
    assert.equal(b.changed, true, "admin_staff_set_active (reactivate) still works"); await gained("admin_staff_set_active reactivate");
    const [{ d }] = await q<{ d: { changed: boolean } }>(`SELECT public.admin_commission_default_set(${actor}, 1100, ${settingsRevision}) AS d`);
    assert.equal(d.changed, true, "admin_commission_default_set still works"); await gained("admin_commission_default_set");
    const [{ p }] = await q<{ p: { changed: number } }>(`SELECT public.admin_commission_paid_set(${actor}, ARRAY[${lit(entry.id)}]::text[], true) AS p`);
    assert.equal(p.changed, 1, "admin_commission_paid_set still works"); await gained("admin_commission_paid_set");
    const [{ rp }] = await q<{ rp: { repaired: number } }>(`SELECT public.admin_commission_repair(${actor}) AS rp`);
    assert.equal(typeof rp.repaired, "number", "admin_commission_repair still works"); await gained("admin_commission_repair");
    const [{ rm }] = await q<{ rm: string }>(`SELECT public.admin_staff_remove(${actor}, ${lit(id)}, 4) AS rm`);
    assert.equal(rm, "DELETED", "admin_staff_remove still works"); await gained("admin_staff_remove");
    const [{ del }] = await q<{ del: { reference: string } }>(`SELECT public.delete_booking(${lit(pending.id)}, ${actor}, ${pendingRevision}, ${lit(pending.reference)}) AS del`);
    assert.equal(del.reference, pending.reference, "delete_booking still works"); await gained("delete_booking");
    throw new Done("roll back every probe");
  }), (e: unknown) => e instanceof Done);
  assert.equal(seen.length, 11, `every function was exercised: ${seen.join(", ")}`);
  // The rolled-back probes left nothing behind and the privilege is still absent for new connections.
  assert.equal(await count("staff", `name LIKE 'Hijack Probe%'`), 0);
  const [{ g }] = await db.$queryRawUnsafe<{ g: boolean }[]>(`SELECT has_table_privilege('zeus_app', 'public.staff', 'UPDATE') AS g`);
  assert.equal(g, false);
});

// Codex F2 (Medium). The migration used to clip the booking total at 100,000,000 centavos, but admin validation allows each
// line price up to 100,000,000, so a booking with two such lines paid commission on half its value, silently. Here the real
// services price two lines at the maximum, one 10% worker finishes the job, and the record must carry the whole amount.
test("C19 two lines at the maximum price: the total is 200,000,000, not clipped, and the commission is 20,000,000", { skip }, async () => {
  const w = await person("Big Total Worker", "10");
  const day = nextDay();
  const b = await book(select("S", "basic-wash"), day);
  const o = at(day);
  await s.addLine(ADMIN, b.id, { expectedRevision: await rev(b.id), serviceId: bySlug(r0(), "arcane-graphene").id, quantity: 1 }, o);
  for (const l of await db.bookingLineItem.findMany({ where: { bookingId: b.id, removedAt: null } }))
    await s.setLinePrice(ADMIN, b.id, l.id, { expectedRevision: await rev(b.id), priceCentavos: 100_000_000, reason: "P1-37 maximum price test" }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "CONFIRMED" }, o);
  const n = ++seq;
  const bay = await s.createBay(ADMIN, { name: "Bay " + n, sortOrder: n, bayType: "WASH" }, o);
  await s.setBay(ADMIN, b.id, { expectedRevision: await rev(b.id), date: day, bayId: bay.id }, o);
  await s.assignWorker(ADMIN, b.id, w.id, { expectedRevision: await rev(b.id) }, o);
  await s.setBookingStatus(ADMIN, b.id, { expectedRevision: await rev(b.id), status: "IN_PROGRESS" }, o);
  await finish({ ...b, day });
  assert.equal((await db.bookingLineItem.count({ where: { bookingId: b.id, removedAt: null } })), 2);
  const h = (await header(b.id))!;
  assert.deepEqual([h.serviceTotalCentavos, h.creditedCount, h.unpricedLineCount], [200_000_000, 1, 0], "the whole total is recorded");
  const e = await entries(b.id);
  assert.deepEqual([e[0].baseCentavos, e[0].rateBp, e[0].amountCentavos], [200_000_000, 1000, 20_000_000]);
  assert.equal(await count("admin_audit_events", `action = 'COMMISSION_ACCRUAL_FAILED' AND "bookingId" = ${lit(b.id)}`), 0, "no failure row");
  // The screen reads it back exactly, and the money columns accept the supported range and nothing above it.
  const list = await s.listCommissions(ADMIN, aroundToday(), opts());
  const shown = list.entries.find((x) => x.id === e[0].id)!;
  assert.deepEqual([shown.serviceTotalCentavos, shown.amountCentavos], [200_000_000, 20_000_000]);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO commission_accruals ("bookingId", "serviceTotalCentavos", "unpricedLineCount", "creditedCount", "completedOn") VALUES ('x', 1000000000001, 0, 0, '2027-01-01')`), /commission_accruals_total_range/);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO commission_entries ("bookingId", "staffId", "position", "baseCentavos", "rateBp", "amountCentavos") VALUES ('x', 'x', 1, 1000000000001, 1000, 1)`), /commission_entries_base_range/);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO commission_entries ("bookingId", "staffId", "position", "baseCentavos", "rateBp", "amountCentavos") VALUES ('x', 'x', 1, 1, 1000, 1000000000001)`), /commission_entries_amount_range/);
});

// Codex F4 (Low). The commit-time check only compared sums, so a header of 100 shared by two people could hold shares of 100 and 0
// (and amounts 10 and 0) and still commit. The check now also requires positions 1..n, the equal-split share for each position
// and the leftover centavos on the largest remainders. Each case below is built by hand as the owner, as Codex did.
test("C20 the commit-time check rejects shares that are not the equal split, wrong positions, and a wrong allocation of leftover centavos", { skip }, async () => {
  const a = await person("Check Worker A", "10"), b = await person("Check Worker B", "10"), c = await person("Check Worker C", "12.5");
  type Row = [staff: string, position: number, base: number, rate: number, amount: number];
  const build = async (total: number, rows: Row[], expected: RegExp | null) => {
    const booking = await book(select("S", "basic-wash"), nextDay());
    class Rollback extends Error {}
    const write = async (tx: { $executeRawUnsafe(q: string): Promise<number> }) => {
      await tx.$executeRawUnsafe(`INSERT INTO commission_accruals ("bookingId", "serviceTotalCentavos", "unpricedLineCount", "creditedCount", "completedOn") VALUES ('${booking.id}', ${total}, 0, ${rows.length}, '2027-07-01')`);
      for (const [staff, position, base, rate, amount] of rows)
        await tx.$executeRawUnsafe(`INSERT INTO commission_entries ("bookingId", "staffId", "position", "baseCentavos", "rateBp", "amountCentavos") VALUES ('${booking.id}', '${staff}', ${position}, ${base}, ${rate}, ${amount})`);
    };
    if (expected) {
      await assert.rejects(db.$transaction(write), expected);
      assert.equal(await header(booking.id), null, "nothing was kept");
    } else {
      // A correct set must pass the check. Forced immediately and rolled back, so the immutable rows are not left behind.
      await assert.rejects(db.$transaction(async (tx) => { await write(tx); await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE"); throw new Rollback("undo"); }), (e: unknown) => e instanceof Rollback);
    }
  };
  // The reviewer's counterexample: total 100, two credited, shares 100 and 0 (sums are right, the split is not).
  await build(100, [[a.id, 1, 100, 1000, 10], [b.id, 2, 0, 1000, 0]], /equal split/);
  await build(100, [[a.id, 1, 0, 1000, 0], [b.id, 2, 100, 1000, 10]], /equal split/);
  // Positions must be exactly 1..n: a gap, or a repeat.
  await build(100, [[a.id, 1, 50, 1000, 5], [b.id, 3, 50, 1000, 5]], /equal split/);
  await build(100, [[a.id, 1, 50, 1000, 5], [b.id, 1, 50, 1000, 5]], /equal split/);
  // The extra centavo of an odd total goes to the first position, not the last.
  await build(101, [[a.id, 1, 50, 1000, 5], [b.id, 2, 51, 1000, 5]], /equal split/);
  // 100,000 centavos among three at 12.5%: the leftover centavos must go to positions 1 and 2 (remainders 7500 and 6250, then
  // 6250 again, ties to the earlier position). Giving them to positions 2 and 3 has the right sum and is wrong.
  await build(100_000, [[a.id, 1, 33_334, 1250, 4_166], [b.id, 2, 33_333, 1250, 4_167], [c.id, 3, 33_333, 1250, 4_167]], /largest remainders/);
  // The correct sets pass: the equal split with its allocation, an odd total, and the maximum range.
  await build(100, [[a.id, 1, 50, 1000, 5], [b.id, 2, 50, 1000, 5]], null);
  await build(101, [[a.id, 1, 51, 1000, 5], [b.id, 2, 50, 1000, 5]], null);
  await build(100_000, [[a.id, 1, 33_334, 1250, 4_167], [b.id, 2, 33_333, 1250, 4_167], [c.id, 3, 33_333, 1250, 4_166]], null);
  await build(200_000_000, [[a.id, 1, 200_000_000, 1000, 20_000_000]], null);
});

test("C21 a completed booking takes no price change: the service refuses it and the database refuses it too (review F1)", { skip }, async () => {
  const w = await person("Late Price Worker", "10");
  const job = await completed([w.id], 50_000);
  const line = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: job.id } });
  await refused(s.setLinePrice(ADMIN, job.id, line.id, { expectedRevision: await rev(job.id), priceCentavos: 60_000, reason: "Late price" }, at(job.day)), "BOOKING_NOT_MANAGEABLE", "late price through the service");
  await assert.rejects(
    db.$executeRawUnsafe(`UPDATE booking_line_items SET "staffPriceCentavos" = 60000, "staffPriceSetByStaffId" = '${ADMIN.staffId}' WHERE id = '${line.id}'`),
    /A completed booking takes no line change/, "the database wall");
  assert.equal((await db.bookingLineItem.findUniqueOrThrow({ where: { id: line.id } })).staffPriceCentavos, 50_000, "the price did not move");
  assert.equal((await entries(job.id))[0].amountCentavos, 5_000, "the commission did not move");
});

test("C22 a late price reaches the commission as an adjustment: ADMIN only, reason required, never below zero, paid on its own, audited, immutable (review F1)", { skip }, async () => {
  const w = await person("Adjust Worker", "10");
  const job = await completed([w.id], 100_000, true); // one service had no price at completion
  const [e] = await entries(job.id);
  assert.equal(e.amountCentavos, 10_000);
  const adjust = (body: unknown, actor: StaffActor = ADMIN) => s.adjustCommission(actor, body, opts());
  await refused(adjust({ id: randomUUID(), entryId: e.id, amountCentavos: 5_000, reason: "x" }, { ...ADMIN, role: "STAFF" }), "FORBIDDEN", "STAFF");
  const K = () => ({ id: randomUUID(), entryId: e.id });
  for (const bad of [{ ...K(), amountCentavos: 0, reason: "zero" }, { ...K(), amountCentavos: 1.5, reason: "fraction" }, { ...K(), amountCentavos: 5_000, reason: "  " },
    { ...K(), amountCentavos: 5_000 }, { ...K(), amountCentavos: 5_000, reason: "x".repeat(201) }, { ...K(), amountCentavos: 1_000_000_000_001, reason: "too large" },
    { id: randomUUID(), entryId: "not-a-uuid", amountCentavos: 5_000, reason: "bad id" }, { ...K(), amountCentavos: 5_000, reason: "extra", paid: true },
    { entryId: e.id, amountCentavos: 5_000, reason: "no id" }, { id: "nope", entryId: e.id, amountCentavos: 5_000, reason: "bad adjustment id" }])
    await refused(adjust(bad), "VALIDATION_ERROR", JSON.stringify(bad).slice(0, 50));
  await refused(adjust({ id: randomUUID(), entryId: randomUUID(), amountCentavos: 5_000, reason: "unknown entry" }), "NOT_FOUND", "unknown entry");
  await refused(adjust({ ...K(), amountCentavos: -10_001, reason: "too much" }), "VALIDATION_ERROR", "below zero");
  assert.equal(await count("commission_adjustments", `"entryId" = '${e.id}'`), 0, "nothing was written by the refusals");

  const lateId = randomUUID();
  const made = await adjust({ id: lateId, entryId: e.id, amountCentavos: 12_000, reason: "Coating priced at 120,000 after completion" });
  assert.equal(made.id, lateId);
  // A retry after a lost response (same id, same content) returns the same row and writes nothing more (review R2-2).
  assert.equal((await adjust({ id: lateId, entryId: e.id, amountCentavos: 12_000, reason: "Coating priced at 120,000 after completion" })).id, lateId);
  assert.equal(await count("commission_adjustments", `"entryId" = '${e.id}'`), 1, "the retry did not add a second row");
  assert.equal(await count("admin_audit_events", `"bookingId" = '${job.id}' AND action = 'COMMISSION_ADJUSTED'`), 1, "and no second audit row");
  await refused(adjust({ id: lateId, entryId: e.id, amountCentavos: 99_000, reason: "same id, different amount" }), "VALIDATION_ERROR", "id reused for something else");
  assert.ok(made.id);
  assert.deepEqual([(await entries(job.id))[0].amountCentavos, (await header(job.id))!.serviceTotalCentavos], [10_000, 100_000], "the entry and the header are untouched");
  const range = { ...aroundToday(), staffId: w.id };
  let list = await s.listCommissions(ADMIN, range, opts());
  const shown = list.entries.find((x) => x.id === e.id)!;
  assert.deepEqual(shown.adjustments.map((a) => [a.id, a.amountCentavos, a.reason, a.paidAt]), [[made.id, 12_000, "Coating priced at 120,000 after completion", null]]);
  assert.deepEqual([list.totals[0].earnedCentavos, list.totals[0].paidCentavos, list.totals[0].unpaidCentavos], [22_000, 0, 22_000], "earned counts the adjustment");
  const audit = await db.adminAuditEvent.findMany({ where: { bookingId: job.id, action: "COMMISSION_ADJUSTED" } });
  assert.deepEqual(audit.map((a) => [a.actorStaffId, a.targetStaffId, a.newValue, a.reason]), [[ADMIN.staffId, w.id, "12000", "Coating priced at 120,000 after completion"]]);

  assert.deepEqual(await s.setCommissionsPaid(ADMIN, { ids: [made.id], paid: true }, opts()), { changed: 1, unknown: 0 }, "an adjustment is paid on its own");
  list = await s.listCommissions(ADMIN, range, opts());
  assert.deepEqual([list.totals[0].paidCentavos, list.totals[0].unpaidCentavos], [12_000, 10_000]);
  assert.equal((await entries(job.id))[0].paidAt, null, "the entry itself is still unpaid");

  await adjust({ ...K(), amountCentavos: -22_000, reason: "Price was entered twice" }); // exactly to zero is allowed
  await refused(adjust({ ...K(), amountCentavos: -1, reason: "one centavo too far" }), "VALIDATION_ERROR", "below zero after two");
  list = await s.listCommissions(ADMIN, range, opts());
  assert.equal(list.totals[0].earnedCentavos, 0);

  const row = `"entryId" = '${e.id}'`;
  await assert.rejects(db.$executeRawUnsafe(`UPDATE commission_adjustments SET "amountCentavos" = 1 WHERE ${row}`), /immutable except for payment/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM commission_adjustments WHERE ${row}`), /cannot be deleted/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE commission_adjustments`), /Commission records cannot be truncated/);
  await assert.rejects(app.$executeRawUnsafe(`INSERT INTO commission_adjustments ("entryId", "amountCentavos", reason, "actorStaffId") VALUES ('${e.id}', 1, 'x', '${ADMIN.staffId}')`), /permission denied/);
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_commission_adjust('${w.id}', '${randomUUID()}', '${e.id}', 100, 'a detailer id')`), /Only an admin/i);
});

test("C23 repair handles each booking on its own: one that keeps failing is reported and does not block the others (review F2)", { skip }, async () => {
  const w = await person("Repair Worker", "10");
  const bad = await inProgress([w.id], 30_000), good = await inProgress([w.id], 40_000);
  await db.$executeRawUnsafe(`ALTER TABLE commission_entries ADD CONSTRAINT test_force_fail_all CHECK ("amountCentavos" < 0) NOT VALID`);
  try { await finish(bad); await finish(good); } finally { await db.$executeRawUnsafe(`ALTER TABLE commission_entries DROP CONSTRAINT test_force_fail_all`); }
  assert.deepEqual([(await entries(bad.id)).length, (await entries(good.id)).length], [0, 0], "both accruals failed at completion");
  // Only the first booking keeps failing: a header check that names it. The other one is repairable.
  await db.$executeRawUnsafe(`ALTER TABLE commission_accruals ADD CONSTRAINT test_poison CHECK ("bookingId" <> '${bad.id}') NOT VALID`);
  let result: { repaired: number; failed: number };
  try { result = await s.repairCommissions(ADMIN, opts()); } finally { await db.$executeRawUnsafe(`ALTER TABLE commission_accruals DROP CONSTRAINT test_poison`); }
  assert.ok(result.failed >= 1, "the failure is reported");
  assert.equal((await entries(good.id)).length, 1, "the good booking was repaired in the same call");
  assert.equal((await entries(bad.id)).length, 0);
  const failures = await db.adminAuditEvent.findMany({ where: { bookingId: bad.id, action: "COMMISSION_ACCRUAL_FAILED" } });
  assert.ok(failures.length >= 2, "the completion failure and the repair failure are both audited");
  assert.ok(failures.every((f) => /^SQLSTATE [0-9A-Z]{5}$/.test(f.reason ?? "")));
  const after = await s.repairCommissions(ADMIN, opts()); // the cause is gone: the poisoned booking is repaired now
  assert.ok(after.repaired >= 1);
  assert.equal((await entries(bad.id)).length, 1);
});

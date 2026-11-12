// P1-31 failed emails: a send that did not go out leaves no audit row, so staff can retry at once; a sent one still blocks.
// Runs as the runtime role (zeus_app) with the loopback SMTP simulator. Own sibling database (<T007 name>_notifyf); synthetic data only.
// dropped. Without T007_TEST_DATABASE_URL these tests skip.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
// The per-address daily email cap counts across tests in one process; each test starts from zero.
beforeEach(async () => (await import("@/server/notifications/bookings")).resetSendGuard());
import { PrismaClient } from "@prisma/client";
import type { CatalogSelection } from "@/types/catalog-contracts";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "../catalog.fixture";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const delUrl = url ? siblingDatabaseUrl(url, "notifyf") : "postgresql://unused@localhost/zeus_t007_unused_notifyf";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: delUrl } } }); // owner: fixtures and trigger checks
let app: PrismaClient; // zeus_app: every service call and every "the app cannot" check

type Services = typeof import("./index");
let s: Services;
let pricing: typeof import("../catalog-pricing");
const manifest = readManifest();
let releaseId = "";
let STAFF: StaffActor;
let seq = 0;
const NOW = new Date("2027-03-01T02:00:00.000Z");

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

const notifications = (bookingId: string) => db.bookingAuditEvent.count({ where: { bookingId, action: "CUSTOMER_NOTIFIED" } });
const lines: string[] = [];
const realWarn = console.warn;

before(async () => {
  if (skip) return;
  await createAndMigrate(root, delUrl);
  provisionRuntimeRole(delUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(delUrl) } } });
  pricing = await import("../catalog-pricing");
  s = await import("./index");
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  await mapPublisher(db, "p131-admin@example.test");
  releaseId = await publish(db, manifest, tooling.stableId);
  const detailer = await db.staff.create({ data: { name: "Detailer", phone: "", email: "p131-detailer@example.test", role: "DETAILER" } });
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);
});
after(async () => { console.warn = realWarn; if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

async function withSmtp<T>(run: (smtp: Awaited<ReturnType<(typeof import("../notifications/smtp.fixture"))["smtpSimulation"]>>, sender: import("./notice").TurnNoticeSender) => Promise<T>): Promise<T> {
  const { smtpSimulation } = await import("../notifications/smtp.fixture");
  const notice = await import("./notice");
  const smtp = await smtpSimulation();
  try { return await run(smtp, notice.bookingTurnNoticeSender({ db: app, notification: smtp.config })); } finally { await smtp.close(); }
}
const notify = (id: string, sender: import("./notice").TurnNoticeSender, actor = STAFF) => s.notifyCustomer(actor, id, { expectedRevision: 1 }, { db: app, now: () => NOW, sender });

test("N1 a send that fails leaves no audit row, so staff retry at once; the retry that goes out records one", { skip }, async () => {
  await withSmtp(async (smtp, sender) => {
    const { id } = await book(select("S", "basic-wash"), "2027-05-01");
    smtp.setRejected(true);
    for (let i = 0; i < 5; i++) { // more than the daily cap of 3: failed sends never use the allowance
      const failed = await notify(id, sender);
      assert.equal(failed.notice, "NOT_SENT", "attempt " + i);
      assert.equal(await notifications(id), 0, "no audit row after a failed send");
    }
    smtp.setRejected(false);
    assert.equal((await notify(id, sender)).notice, "SENT");
    assert.equal(await notifications(id), 1);
    assert.equal(smtp.messages.length, 1);
  });
});

test("N2 a sent notice still blocks the next click with the existing rate-limit text and sends no second email", { skip }, async () => {
  await withSmtp(async (smtp, sender) => {
    const { id } = await book(select("S", "basic-wash"), "2027-05-02");
    assert.equal((await notify(id, sender)).notice, "SENT");
    await assert.rejects(notify(id, sender), (e: unknown) => {
      const err = e as import("./errors").AdminServiceError;
      assert.equal(err.code, "RATE_LIMITED");
      assert.equal(err.message, "This customer was notified recently. Try again later.");
      return true;
    });
    assert.equal(smtp.messages.length, 1);
    assert.equal(await notifications(id), 1);
  });
});

test("N3 two clicks at once send once; the guard is released after a thrown error and after a normal finish", { skip }, async () => {
  const { id } = await book(select("S", "basic-wash"), "2027-05-03");
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let sends = 0;
  const slow: import("./notice").TurnNoticeSender = { async send() { sends++; await gate; return "SENT"; } };
  const first = notify(id, slow);
  await new Promise((r) => setTimeout(r, 300)); // the first is inside its send
  await assert.rejects(notify(id, slow), (e: unknown) => (e as import("./errors").AdminServiceError).code === "RATE_LIMITED", "second click while sending");
  assert.equal(sends, 1);
  release();
  assert.equal((await first).notice, "SENT");
  assert.equal(await notifications(id), 1);
  // A sender that throws must not lock the booking out.
  const { id: id2 } = await book(select("S", "basic-wash"), "2027-05-03");
  const boom: import("./notice").TurnNoticeSender = { async send() { throw new Error("provider exploded"); } };
  assert.equal((await notify(id2, boom)).notice, "NOT_SENT");
  assert.equal(await notifications(id2), 0);
  const ok: import("./notice").TurnNoticeSender = { async send() { return "SENT"; } };
  assert.equal((await notify(id2, ok)).notice, "SENT", "retry right after a thrown error");
});

test("N4 failed emails log a reason class and kind only; no address, name or password reaches the log", { skip }, async () => {
  await withSmtp(async (smtp, sender) => {
    const notifs = await import("../notifications/bookings");
    notifs.resetEmailFailureLog();
    lines.length = 0;
    console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try {
      const { id } = await book(select("S", "basic-wash"), "2027-05-04");
      smtp.setRejected(true);
      assert.equal((await notify(id, sender)).notice, "NOT_SENT");
      const seen = lines.filter((l) => l.includes("booking.email_not_sent"));
      assert.equal(seen.length, 1);
      const log = JSON.parse(seen[0]);
      assert.deepEqual(Object.keys(log).sort(), ["bookingId", "event", "kind", "reason"]);
      assert.equal(log.kind, "turn_notice");
      assert.ok(["refused", "error", "timeout", "unreachable"].includes(log.reason), log.reason);
      const all = lines.join("\n");
      for (const secret of ["example.test", "Zed Customer", smtp.config.password, "shop@", "Synthetic Roadster"]) assert.ok(!all.includes(secret), "log leaked " + secret);
    } finally { console.warn = realWarn; }
  });
});

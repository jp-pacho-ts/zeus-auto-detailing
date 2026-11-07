// P1-62 A2 synthetic fixture for the Bay board browser checks (containers.browser.check.cjs and the older board checks). Run it ONCE on a
// loopback database whose name starts with zeus_t007_ (it creates the database):
//   node --require ./src/server/__tests__/register.cjs src/server/admin/board-browser.fixture.ts
// Needs T007_TEST_DATABASE_URL, P120_TEST_EMAIL, P120_TEST_PASSWORD, QSA_DETAILER_EMAIL, QSA_DETAILER_PASSWORD (fresh random passwords).
// Same setup as team-browser.fixture.ts (see its header for building and starting the app). It builds TODAY's board through the real services:
//   containers  Wash (bays Wash 1, Wash 2), Detailing (Detail 1), Paint (Paint 1), Express wash (Express 1; no label)
//   waiting     ZEUS wash car "W-one", wash car "W-two", a mixed booking (wash + tint + 1 more), a tint car
//   in a bay    a wash car in Wash 1 (Ana assigned, in service)
//   done        one completed car finished today with Ana and Ben
//   tomorrow    one wash car (the server refuses to seat it before its day)
// Never touches real data: it refuses any non-loopback or non-zeus_t007_ database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { setStaffPassword } from "@/server/auth/credentials";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "@/server/catalog.fixture";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl } from "@/server/catalog-db.fixture";
import type { CatalogSelection } from "@/types/catalog-contracts";
import type { StaffActor } from "@/server/admin/context";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const manilaToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

async function main() {
  const url = env("T007_TEST_DATABASE_URL");
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname), "loopback database only");
  assert.match(parsed.pathname, /^\/zeus_t007_/, "the database name must start with zeus_t007_");
  const adminEmail = env("P120_TEST_EMAIL"), adminPassword = env("P120_TEST_PASSWORD");
  const detailerEmail = env("QSA_DETAILER_EMAIL"), detailerPassword = env("QSA_DETAILER_PASSWORD");
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const root = new PrismaClient({ datasources: { db: { url: maintenance.toString() } } });
  const db = new PrismaClient({ datasources: { db: { url } } }); // owner
  await createAndMigrate(root, url);
  provisionRuntimeRole(url);
  const app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(url) } } }); // zeus_app
  const s = await import("@/server/admin");
  const pricing = await import("@/server/catalog-pricing");
  const manifest = readManifest();
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as { stableId(k: string): string };
  const adminId = await mapPublisher(db, adminEmail);
  const releaseId = await publish(db, manifest, tooling.stableId);
  for (const [input, password] of [[{ email: adminEmail }, adminPassword], [{ email: detailerEmail, name: "Synthetic Staff", role: "DETAILER" as const }, detailerPassword]] as const) {
    const result = await setStaffPassword(db, input, password);
    assert.equal(result.ok, true, `credential for ${input.email}: ${JSON.stringify(result)}`);
  }
  const ADMIN: StaffActor = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  const opts = { db: app };
  const r0 = () => releaseFromManifest(manifest, releaseId);
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);
  const today = manilaToday();

  let seq = 0;
  const lit = (x: unknown): string => (x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`);
  const insert = async (tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
  };
  const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
  async function book(day: string, slug: string, model: string): Promise<string> {
    const selection: CatalogSelection = { vehicleCategoryId: sizeId(r0(), "S"), lines: [{ serviceId: bySlug(r0(), slug).id, quantity: 1 }] };
    const priced = pricing.priceSelection(r0(), selection);
    assert.equal(priced.kind, "QUOTED");
    const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
    const id = randomUUID(), n = ++seq, reference = `ZEUS-B${String(n).padStart(5, "0")}`;
    const size = r0().sizes.find((x) => x.id === q.vehicleCategoryId)!;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
      const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
      await insert(tx, "bookings", { id, referenceCode: reference, customerName: `Synthetic Customer ${n}`, customerPhone: "+639170000999",
        customerEmail: `synthetic${n}@example.test`, vehicleModel: model, vehiclePlate: `SYN ${1000 + n}`, notes: "synthetic", vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day,
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
  const rev = async (id: string) => (await db.booking.findUniqueOrThrow({ where: { id } })).revision;
  const containers = await s.listContainers(ADMIN, opts);
  const home = (name: string) => containers.find((c) => c.name === name)!.id;
  const addContainer = (name: string) => s.addContainer(ADMIN, { id: randomUUID(), name }, opts);
  const bay = (name: string, containerId: string) => s.createBay(ADMIN, { name, sortOrder: ++seq, containerId }, opts);
  await bay("Wash 1", home("Wash")); await bay("Wash 2", home("Wash"));
  await bay("Detail 1", home("Detailing")); await bay("Paint 1", home("Paint"));
  const express = await addContainer("Express wash");
  await bay("Express 1", express.id);

  const ana = await s.addPerson(ADMIN, { name: "Ana Reyes", phone: "+63 917 555 0101" }, opts);
  const ben = await s.addPerson(ADMIN, { name: "Ben Cruz", phone: "+63 917 555 0102" }, opts);

  // Waiting
  await book(today, "basic-wash", "Synthetic Vios");
  await book(today, "basic-wash", "Synthetic City");
  const mixed = await book(today, "basic-wash", "Synthetic Fortuner");
  await s.addLine(ADMIN, mixed, { expectedRevision: await rev(mixed), serviceId: bySlug(r0(), "regular-tint").id, quantity: 1 }, opts);
  await s.addLine(ADMIN, mixed, { expectedRevision: await rev(mixed), serviceId: bySlug(r0(), "interior-detailing").id, quantity: 1 }, opts);
  await book(today, "regular-tint", "Synthetic Xpander");

  // In a bay (Wash 1)
  const washBay = (await db.bay.findFirstOrThrow({ where: { name: "Wash 1" } })).id;
  const busy = await book(today, "basic-wash", "Synthetic Seltos");
  await s.setBookingStatus(ADMIN, busy, { expectedRevision: await rev(busy), status: "CONFIRMED" }, opts);
  await s.setBay(ADMIN, busy, { expectedRevision: await rev(busy), date: today, bayId: washBay }, opts);
  await s.assignWorker(ADMIN, busy, ana.id, { expectedRevision: await rev(busy) }, opts);
  await s.setBookingStatus(ADMIN, busy, { expectedRevision: await rev(busy), status: "IN_PROGRESS" }, opts);

  // Done today, with two names
  const fin = await book(today, "basic-wash", "Synthetic Civic");
  await s.setBookingStatus(ADMIN, fin, { expectedRevision: await rev(fin), status: "CONFIRMED" }, opts);
  const finBay = await bay("Finish bay", home("Wash"));
  await s.setBay(ADMIN, fin, { expectedRevision: await rev(fin), date: today, bayId: finBay.id }, opts);
  for (const w of [ana.id, ben.id]) await s.assignWorker(ADMIN, fin, w, { expectedRevision: await rev(fin) }, opts);
  await s.setBookingStatus(ADMIN, fin, { expectedRevision: await rev(fin), status: "IN_PROGRESS" }, opts);
  for (const l of await db.bookingLineItem.findMany({ where: { bookingId: fin, removedAt: null } }))
    await s.setLineStatus(ADMIN, fin, l.id, { expectedRevision: await rev(fin), workStatus: "DONE" }, opts);
  await s.setBookingStatus(ADMIN, fin, { expectedRevision: await rev(fin), status: "COMPLETED" }, opts);

  // Tomorrow: one car whose day has not started, so the server refuses to seat it today (the refusal-visibility check).
  const tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  await book(tomorrow, "basic-wash", "Synthetic Tomorrow");

  console.log("fixture ready: 5 containers' worth of bays, 4 waiting cars, 1 in Wash 1, 1 done today");
  await Promise.all([app.$disconnect(), db.$disconnect(), root.$disconnect()]);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

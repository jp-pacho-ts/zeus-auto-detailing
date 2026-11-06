// P1-37 synthetic fixture for team.browser.check.cjs. Run it ONCE on a loopback database whose name starts with zeus_t007_:
//   node --require ./src/server/__tests__/register.cjs src/server/admin/team-browser.fixture.ts
// It migrates the database, publishes the catalog, provisions the runtime role, creates one ADMIN and one DETAILER login with the
// passwords given in the environment, and builds the shop the check expects, through the real services:
//   people  Ana Reyes (shop default 10%), Ben Cruz (12.5%), Cleo Santos (no jobs)
//   jobs    five completed bookings. Each has the online wash (₱180.00, earns no commission) plus a tint the shop priced:
//           Ana alone, tint 1,000.00 (earns 200.00 at the 20% default); Ben alone, tint 2,500.00 (12.5%: 312.50);
//           Ana + Ben together, tint 1,000.01 (Ana 100.00, Ben 62.50); one tint job with nobody assigned; and one wash-only job
//           with Ana assigned (no commission: car wash).
//   totals  Ana 300.00, Ben 375.00, together 675.00.
// How to run the whole browser check (loopback only, synthetic data, never .env):
//   1. a throwaway PostgreSQL on 127.0.0.1 (trust auth, max_connections 200); give T007_TEST_DATABASE_URL a NEW zeus_t007_* database name
//      (this script creates it) and set the four credential variables above to fresh random passwords;
//   2. run this fixture; build the app (npm run build); start it with `next start -H 127.0.0.1` and a synthetic environment: APP_ORIGIN an
//      https .invalid origin, DATABASE_URL = the zeus_app role on that database with connection_limit=32&pool_timeout=2, CLIENT_IP_SOURCE=
//      PROXY_HOPS and TRUSTED_PROXY_HOPS=1, random key rings and non-test Turnstile values (see .env.example);
//   3. node --test src/components/admin/team/team.browser.check.cjs with P120_BROWSER_ORIGIN (the loopback URL), P120_APP_ORIGIN (the .invalid
//      origin), the credential variables, P137_SHOTS (a scratch folder for screenshots), PLAYWRIGHT_MODULE and P120_CHROME_EXECUTABLE if needed.
//   The check changes data (it adds, removes and adjusts), so build a fresh database for every run.
// Never touches real data: it refuses any non-loopback or non-zeus_t007_ database. Needs T007_TEST_DATABASE_URL,
// P120_TEST_EMAIL, P120_TEST_PASSWORD, QSA_DETAILER_EMAIL, QSA_DETAILER_PASSWORD.
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

async function main() {
  const url = env("T007_TEST_DATABASE_URL");
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname), "loopback database only");
  assert.match(parsed.pathname, /^\/zeus_t007_/, "the database name must start with zeus_t007_");
  const adminEmail = env("P120_TEST_EMAIL"), adminPassword = env("P120_TEST_PASSWORD");
  const detailerEmail = env("QSA_DETAILER_EMAIL"), detailerPassword = env("QSA_DETAILER_PASSWORD");

  const maintenance = new URL(url);
  maintenance.pathname = "/postgres"; // CREATE DATABASE needs a connection to another database
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
  for (const [input, password] of [[{ email: adminEmail }, adminPassword], [{ email: detailerEmail, name: "Synthetic Detailer", role: "DETAILER" as const }, detailerPassword]] as const) {
    const result = await setStaffPassword(db, input, password);
    assert.equal(result.ok, true, `credential for ${input.email}: ${JSON.stringify(result)}`);
  }
  const ADMIN: StaffActor = { staffId: adminId, role: "ADMIN", sessionId: randomUUID() };
  const opts = { db: app };
  const r0 = () => releaseFromManifest(manifest, releaseId);
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now()`);

  let seq = 0;
  const lit = (x: unknown): string => (x === null || x === undefined ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`);
  const insert = async (tx: { $executeRawUnsafe(q: string): Promise<number> }, table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
  };
  const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
  const selection: CatalogSelection = { vehicleCategoryId: sizeId(r0(), "S"), lines: [{ serviceId: bySlug(r0(), "basic-wash").id, quantity: 1 }] };
  async function book(day: string): Promise<string> {
    const priced = pricing.priceSelection(r0(), selection);
    assert.equal(priced.kind, "QUOTED");
    const q = priced.kind === "QUOTED" ? priced.quote : (null as never);
    const id = randomUUID(), n = ++seq, reference = `ZEUS-B${String(n).padStart(5, "0")}`;
    const size = r0().sizes.find((x) => x.id === q.vehicleCategoryId)!;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
      const [{ p }] = await tx.$queryRawUnsafe<{ p: number }[]>(`SELECT COALESCE(max("queuePosition"),0)+1 AS p FROM bookings WHERE "bookingDate"=${lit(day)} AND "queueCode"=${lit(q.queueId)}`);
      await insert(tx, "bookings", { id, referenceCode: reference, customerName: `Synthetic Customer ${n}`, customerPhone: "+639170000999",
        customerEmail: `synthetic${n}@example.test`, vehicleModel: "Synthetic Roadster", vehiclePlate: "ZZZ9999", notes: "synthetic", vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day,
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
  // totalCentavos null = a wash-only booking (earns no commission); otherwise the shop adds a tint and prices it at that amount.
  async function completedJob(day: string, workers: string[], totalCentavos: number | null) {
    const id = await book(day);
    const o = { db: app, now: () => new Date(day + "T02:00:00.000Z") };
    if (totalCentavos !== null) {
      const tintId = bySlug(r0(), "regular-tint").id;
      await s.addLine(ADMIN, id, { expectedRevision: await rev(id), serviceId: tintId, quantity: 1 }, o);
      const tint = await db.bookingLineItem.findFirstOrThrow({ where: { bookingId: id, serviceId: tintId, removedAt: null } });
      await s.setLinePrice(ADMIN, id, tint.id, { expectedRevision: await rev(id), priceCentavos: totalCentavos, reason: "fixture price" }, o);
    }
    await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(id), status: "CONFIRMED" }, o);
    const n = ++seq;
    const bay = await s.createBay(ADMIN, { name: "Bay " + n, sortOrder: n, bayType: "WASH" }, o);
    await s.setBay(ADMIN, id, { expectedRevision: await rev(id), date: day, bayId: bay.id }, o);
    for (const w of workers) await s.assignWorker(ADMIN, id, w, { expectedRevision: await rev(id) }, o);
    await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(id), status: "IN_PROGRESS" }, o);
    for (const l of await db.bookingLineItem.findMany({ where: { bookingId: id, removedAt: null } }))
      await s.setLineStatus(ADMIN, id, l.id, { expectedRevision: await rev(id), workStatus: "DONE" }, o);
    await s.setBookingStatus(ADMIN, id, { expectedRevision: await rev(id), status: "COMPLETED" }, o);
  }

  const ana = await s.addPerson(ADMIN, { name: "Ana Reyes", phone: "+63 917 555 0101" }, opts);
  const ben = await s.addPerson(ADMIN, { name: "Ben Cruz", phone: "+63 917 555 0102", ratePercent: "12.5" }, opts);
  await s.addPerson(ADMIN, { name: "Cleo Santos", phone: "+63 917 555 0103" }, opts);
  await completedJob("2027-07-01", [ana.id], 100_000);
  await completedJob("2027-07-02", [ben.id], 250_000);
  await completedJob("2027-07-03", [ana.id, ben.id], 100_001);
  await completedJob("2027-07-04", [], 50_000);
  await completedJob("2027-07-05", [ana.id], null);

  const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM commission_entries`);
  assert.equal(n, 4, "four entries: Ana 2, Ben 2");
  console.log("fixture ready: 3 people, 5 completed jobs, 4 commission entries");
  await Promise.all([app.$disconnect(), db.$disconnect(), root.$disconnect()]);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

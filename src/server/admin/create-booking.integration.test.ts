// Admin walk-in and phone bookings (2026-11-27): the public create engine in admin mode. The admin skips only the
// anti-stranger checks (challenge, per-client and shop budgets, the online pause); every other booking rule holds.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, mapPublisher, publish, serviceClient, siblingDatabaseUrl } from "@/server/catalog-db.fixture";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "@/server/catalog.fixture";
import { getBookingQuote } from "@/server/catalog-quote";
import { parseBookingConfiguration } from "@/server/bookings-credentials";
import { ADMIN_CLIENT_HASH, createAdminDayBooking, createDayBooking, type BookingCommit, type CreateDayBookingOptions } from "@/server/bookings-create";
import { sha256 } from "@/server/bookings-hash";
import { smtpSimulation } from "@/server/notifications/smtp.fixture";

beforeEach(async () => (await import("@/server/notifications/bookings")).resetSendGuard());
const url = process.env.T007_TEST_DATABASE_URL, skip = !url;
const root = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused@localhost/zeus_t007_unused" } } });
const clients: PrismaClient[] = [];
let smtp: Awaited<ReturnType<typeof smtpSimulation>>, sequence = 0, server: Server, siteverify = "";
const manifest = readManifest(), release = releaseFromManifest();
const config = parseBookingConfiguration({
  BOOKING_QUOTE_KEYS: "q:" + randomBytes(32).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID: "q", MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(32).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID: "g",
  MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(32).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID: "s", ONLINE_BOOKING_MODE: "OPEN", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_ALLOWED_HOSTNAMES: "localhost", APP_ORIGIN: "http://localhost:3000", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1", NODE_ENV: "test",
});
const day = (offset = 1) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const headers = () => new Headers({ origin: config.origin, "x-zeus-booking": "1", "content-type": "application/json", "x-forwarded-for": "192.0.2." + (++sequence) });
const code = (r: BookingCommit) => (r.result.ok ? "OK" : r.result.error.code);
const phone = (n: number) => "+63917" + String(n).padStart(7, "0");
const customerMails = () => smtp.messages.filter((m) => m.to === "walkin@example.test").length;

before(async () => {
  if (skip) return;
  assert.equal(url, process.env.DATABASE_URL);
  // Cloudflare stand-in for the public bookings these tests compare against.
  server = createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ success: true, action: "booking_create", hostname: "localhost" })); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  siteverify = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/siteverify";
  smtp = await smtpSimulation();

});
after(async () => {
  for (const c of clients) await c.$disconnect();
  await root.$disconnect();
  if (smtp) await smtp.close();
  if (server) { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
});

async function fixture(suffix: string) {
  const dbUrl = siblingDatabaseUrl(url!, "admincreate_" + suffix), db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  clients.push(db);
  await createAndMigrate(root, dbUrl);
  const app = await serviceClient(dbUrl, db);
  if (app !== db) clients.push(app);
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs"));
  const actor = await mapPublisher(db, suffix + "@example.test");
  await publish(db, manifest, tooling.stableId);
  await db.$executeRaw`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1,"updatedAt"=now(),"updatedByStaffId"=${actor}`;
  await db.scheduleConfig.create({ data: { effectiveDate: new Date("2000-01-01") } });
  await db.timeSlot.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "08:00", endTime: "18:00", maxVehicleCapacity: 2 })) });
  const options: CreateDayBookingOptions = { db: app, config, notification: { ...smtp.config, origin: config.origin } };
  // An admin body: the wizard's fields without the challenge token.
  async function request(date = day(), customerPhone = phone(1)) {
    const selection = { vehicleCategoryId: sizeId(release, "S"), lines: [{ serviceId: bySlug(release, "basic-wash").id, quantity: 1 }] };
    const quoted = await getBookingQuote(selection, { db: app, ring: config.quote });
    if (!quoted.ok) throw Error(JSON.stringify(quoted));
    return {
      contractVersion: 4 as const, idempotencyKey: randomUUID(), vehicleCategoryId: selection.vehicleCategoryId, lines: quoted.data.quote.lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })),
      bookingDate: date, acceptedQuote: quoted.data.quote, customerFirstName: "Walk", customerLastName: "In", customerPhone, customerEmail: "walkin@example.test", vehicleModel: "Test Car",
    };
  }
  const admin = (body: unknown, extra: Partial<CreateDayBookingOptions> = {}) => createAdminDayBooking(body, { ...options, ...extra });
  const pub = async (body: Awaited<ReturnType<typeof request>>, extra: Partial<CreateDayBookingOptions> = {}) =>
    createDayBooking({ ...body, turnstileToken: randomUUID() }, { ...options, ...extra, headers: headers(), turnstileEndpoint: siteverify });
  return { db, app, actor, request, admin, pub };
}

test("admin books while paused (env and database) with no token: PENDING, next queue position, one email, no challenge row", { skip }, async () => {
  const f = await fixture("paused");
  await f.db.$executeRawUnsafe(`UPDATE shop_settings SET "bookingPaused" = true, revision = revision + 1 WHERE id = 1`);
  const sent = customerMails();
  const first = await f.admin(await f.request(), { config: { ...config, mode: "PAUSED" } });
  assert.equal(code(first), "OK", JSON.stringify(first.result));
  const second = await f.admin(await f.request(day(), phone(2)), { config: { ...config, mode: "PAUSED" } });
  assert.equal(code(second), "OK", JSON.stringify(second.result));
  const rows = await f.db.booking.findMany({ orderBy: { queuePosition: "asc" } });
  assert.deepEqual(rows.map((b) => [b.status, b.queuePosition]), [["PENDING", 1], ["PENDING", 2]]);
  assert.equal(await f.db.bookingTurnstileUse.count(), 0);
  assert.equal(customerMails(), sent + 2, "the customer confirmation still goes out");
  const ops = await f.db.bookingOperation.findMany({ where: { kind: "CREATE" } });
  assert.ok(ops.length === 2 && ops.every((o) => o.clientHash === ADMIN_CLIENT_HASH), "admin ledger rows carry the admin marker");
});

test("admin bookings skip the per-client and shop budgets, do not use them up, and NULL legacy rows still count", { skip }, async () => {
  const f = await fixture("budgets");
  const budget = { config: { ...config, shopDailyBudget: 2 } };
  for (let i = 0; i < 7; i++) assert.equal(code(await f.admin(await f.request(day(1 + (i % 3)), phone(10 + i)), budget)), "OK", "admin booking " + (i + 1));
  // A receipt with no client (made before client hashes existed) still counts toward the shop budget.
  const booked = await f.db.booking.findFirstOrThrow();
  const now = new Date();
  await f.db.bookingOperation.create({ data: { keyHash: sha256(randomUUID()), kind: "CREATE", outcome: "COMMITTED", bookingId: booked.id, requestHash: sha256(randomUUID()),
    resultingRevision: 1, credentialVersion: 1, committedAt: now, clientHash: null, createdAt: now, recoveryExpiresAt: new Date(now.getTime() + 86400000) } });
  assert.equal(code(await f.pub(await f.request(day(4), phone(30)), budget)), "OK", "admin bookings did not use the shop budget");
  assert.equal(code(await f.pub(await f.request(day(5), phone(31)), budget)), "ONLINE_BOOKING_UNAVAILABLE", "the legacy row and the public booking fill it");
});

test("admin is refused on closed and full days and by the phone rule, with admin wording", { skip }, async () => {
  const f = await fixture("refusals");
  await f.db.blockedDate.create({ data: { date: new Date(day()), reason: "CANARY STAFF REASON" } });
  assert.equal(code(await f.admin(await f.request(day()))), "DAY_CLOSED");
  await f.db.$executeRaw`UPDATE booking_queues SET "dailyCap"=NULL,revision=revision+1,"updatedAt"=now() WHERE code<>'WASH'`;
  await f.db.queueCapOverride.create({ data: { queueCode: "WASH", date: new Date(day(2)), dailyCap: 1, updatedAt: new Date(), updatedByStaffId: f.actor } });
  assert.equal(code(await f.admin(await f.request(day(2), phone(1)))), "OK");
  assert.equal(code(await f.admin(await f.request(day(2), phone(2)))), "FULLY_BOOKED");
  assert.equal(code(await f.admin(await f.request(day(3), phone(1)))), "OK");
  const third = await f.admin(await f.request(day(4), phone(1)));
  assert.equal(code(third), "BOOKING_LIMIT_REACHED");
  if (!third.result.ok) assert.equal(third.result.error.message, "This phone number already has 2 active bookings.");
});

test("admin replay returns the same booking without a second booking or email", { skip }, async () => {
  const f = await fixture("replay");
  const body = await f.request();
  const first = await f.admin(body);
  assert.equal(code(first), "OK");
  const sent = customerMails();
  const again = await f.admin(body);
  assert.equal(code(again), "OK");
  assert.equal(again.created, false);
  if (first.result.ok && again.result.ok) assert.equal(again.result.data.booking.id, first.result.data.booking.id);
  assert.equal(await f.db.booking.count(), 1);
  assert.equal(customerMails(), sent);
});

test("the public path still needs its challenge token", { skip }, async () => {
  const f = await fixture("public");
  const r = await createDayBooking(await f.request(), { db: f.app, config, headers: headers() });
  assert.equal(code(r), "VALIDATION_ERROR");
  assert.equal(await f.db.booking.count(), 0);
});

test("the admin service: STAFF is refused with nothing written, ADMIN books without a management code, a full day names the day field", { skip }, async () => {
  const f = await fixture("service");
  const { createBooking } = await import("@/server/admin");
  const { AdminServiceError } = await import("@/server/admin/errors");
  const actor = (role: "ADMIN" | "STAFF") => ({ staffId: f.actor, role, sessionId: randomUUID() });
  await assert.rejects(createBooking(actor("STAFF"), await f.request(), { db: f.app }), (e: unknown) => e instanceof AdminServiceError && e.adminCode === "FORBIDDEN");
  assert.equal(await f.db.booking.count(), 0);
  const made = await createBooking(actor("ADMIN"), await f.request(day(2)), { db: f.app, bookingConfig: config });
  assert.equal(made.booking.status, "PENDING");
  assert.equal(made.replayed, false);
  assert.equal("managementAccess" in made, false);
  await f.db.$executeRaw`UPDATE booking_queues SET "dailyCap"=NULL,revision=revision+1,"updatedAt"=now() WHERE code<>'WASH'`;
  await f.db.queueCapOverride.create({ data: { queueCode: "WASH", date: new Date(day(2)), dailyCap: 1, updatedAt: new Date(), updatedByStaffId: f.actor } });
  await assert.rejects(createBooking(actor("ADMIN"), await f.request(day(2), phone(5)), { db: f.app, bookingConfig: config }),
    (e: unknown) => e instanceof AdminServiceError && e.adminCode === "SCHEDULE_CONFLICT" && Boolean(e.fieldErrors.bookingDate?.length));
  await assert.rejects(createBooking(actor("ADMIN"), { contractVersion: 4 }, { db: f.app, bookingConfig: config }),
    (e: unknown) => e instanceof AdminServiceError && e.adminCode === "VALIDATION_ERROR");
});

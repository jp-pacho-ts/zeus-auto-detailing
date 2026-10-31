// P1-32: the "reference code + last name" booking lookup, against real PostgreSQL as the runtime role
// (zeus_app). Own sibling database (<T007 name>_lookup); synthetic data only; the Turnstile endpoint and
// the SMTP-free path are loopback. Without T007_TEST_DATABASE_URL these tests skip.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "./catalog-db.fixture";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "./catalog.fixture";
import { getBookingQuote } from "./catalog-quote";
import { createDayBooking } from "./bookings-create";
import { parseBookingConfiguration } from "./bookings-credentials";
import * as management from "./bookings-management";
import { managementHttp } from "./bookings-management-http";

const url = process.env.T007_TEST_DATABASE_URL, skip = !url;
const lookupUrl = url ? siblingDatabaseUrl(url, "lookup") : "postgresql://unused@localhost/zeus_t007_unused_lookup";
const root = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: lookupUrl } } }); // owner: fixtures
let app: PrismaClient; // zeus_app: every create and lookup under test
const c = parseBookingConfiguration({
  BOOKING_QUOTE_KEYS: "q:" + randomBytes(32).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID: "q",
  MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(32).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID: "g",
  MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(32).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID: "s",
  ONLINE_BOOKING_MODE: "OPEN", TURNSTILE_SECRET_KEY: "synthetic_secret_for_local_lookup_checks",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic_site_key_for_lookup_checks", TURNSTILE_ALLOWED_HOSTNAMES: "localhost",
  APP_ORIGIN: "http://localhost:3000", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1", NODE_ENV: "test",
});
const manifest = readManifest(), release = releaseFromManifest();
let server: Server, endpoint = "", seq = 0, challenge: { success: boolean; action: string } = { success: true, action: "booking_create" };
const day = (n = 4) => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const ip = () => "198.51." + Math.floor(++seq / 250) + "." + ((seq % 250) + 1);
const headers = (client = ip(), cookie?: string) => new Headers({ origin: c.origin, "x-zeus-booking": "1", "content-type": "application/json", "x-forwarded-for": client, ...(cookie ? { cookie } : {}) });
const opts = (extra: Record<string, unknown> = {}, client?: string) => ({ db: app, config: c, headers: headers(client), turnstileEndpoint: endpoint, ...extra });
const GENERIC = "We couldn't find that booking. Check the reference code and last name.";
const LIMIT_TEXT = "Too many tries. Use the link in your confirmation email, or call the shop.";

before(async () => {
  if (skip) return;
  await createAndMigrate(root, lookupUrl);
  provisionRuntimeRole(lookupUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(lookupUrl) } } });
  const tooling = await import(path.join(process.cwd(), "prisma/catalog/catalog.mjs"));
  await mapPublisher(db, "p132-admin@example.test");
  await publish(db, manifest, tooling.stableId);
  await db.scheduleConfig.create({ data: { effectiveDate: new Date("2000-01-01") } });
  await db.timeSlot.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "08:00", endTime: "18:00", maxVehicleCapacity: 2 })) });
  server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: challenge.success, action: challenge.action, hostname: "localhost" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
after(async () => {
  if (app) await app.$disconnect();
  await db.$disconnect(); await root.$disconnect();
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

interface Made { id: string; reference: string; phone: string; email: string | null }
// A real customer create (as zeus_app) with the given name fields.
async function book(names: Record<string, string>, extra: Record<string, unknown> = {}): Promise<Made> {
  const selection = { vehicleCategoryId: sizeId(release, "S"), lines: [{ serviceId: bySlug(release, "basic-wash").id, quantity: 1 }] };
  const q = await getBookingQuote(selection, { db: app, ring: c.quote });
  assert.ok(q.ok);
  if (!q.ok) throw Error("quote");
  const n = ++seq, phone = "+63917" + String(n).padStart(7, "0");
  challenge = { success: true, action: "booking_create" };
  const commit = await createDayBooking({
    contractVersion: 4 as const, idempotencyKey: randomUUID(), vehicleCategoryId: selection.vehicleCategoryId,
    lines: q.data.quote.lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })), bookingDate: day(4 + (n % 3)),
    acceptedQuote: q.data.quote, turnstileToken: randomUUID(), ...names, customerPhone: phone, customerEmail: "juan.delacruz" + n + "@gmail.com",
    vehicleModel: "Synthetic car", vehiclePlate: "PRIVATE PLATE", specialRequests: "PRIVATE NOTES", ...extra,
  }, opts());
  assert.ok(commit.result.ok, JSON.stringify(commit.result));
  const data = commit.result.ok ? commit.result.data : (null as never);
  return { id: data.booking.id, reference: data.booking.referenceCode, phone, email: "juan.delacruz" + n + "@gmail.com" };
}
const lookup = (referenceCode: string, lastName: string, extra: Record<string, unknown> = {}, o: Record<string, unknown> = {}, client?: string) => {
  challenge = { success: true, action: "booking_lookup" };
  return management.lookupManagedBooking({ referenceCode, lastName, turnstileToken: randomUUID(), ...extra }, opts(o, client));
};
const failure = (r: { result: { ok: boolean; error?: { code: string; message: string } } }) => (r.result.ok ? "OK" : r.result.error!.code + ": " + r.result.error!.message);

test("L1 a right reference and last name opens the booking with a short session, masked contact and status-level progress", { skip }, async () => {
  const b = await book({ customerFirstName: "Ana", customerLastName: "dela Cruz" });
  const r = await lookup(" " + b.reference.toLowerCase() + " ", "DÉLA  cruz");
  assert.ok(r.result.ok, JSON.stringify(r.result));
  if (!r.result.ok) return;
  assert.equal(r.result.data.booking.id, b.id);
  assert.deepEqual(r.result.data.progress, { label: "Received", step: 1, steps: ["Received", "Confirmed", "In service", "Completed"], cancelled: false });
  assert.deepEqual(r.result.data.contact, { phone: "+63 9•• ••• " + b.phone.slice(-4), email: "j•••@gmail.com" });
  const session = (r as { session?: { token: string; expiresAt: string } }).session;
  assert.ok(session, "a session is issued");
  const minutes = (Date.parse(session!.expiresAt) - Date.now()) / 60000;
  assert.ok(minutes > 20 && minutes <= 31, "about 30 minutes, got " + minutes);
  // The existing manage endpoints accept the new session.
  const read = await management.readManagedBooking({ db: app, config: c, headers: headers(ip(), "booking-management=" + session!.token) });
  assert.ok(read.result.ok, JSON.stringify(read.result));
  const text = JSON.stringify(r.result.data);
  for (const secret of [b.phone, b.email!, "Ana", "Cruz", "PRIVATE PLATE", "PRIVATE NOTES", "bayId", "assignedWorkers", "queuePosition", "dailyCap", "workStatus", "occupancy"]) assert.ok(!text.includes(secret), "response leaked " + secret);
});

test("L2 every kind of failure is the same answer: same code, text, status, headers and size", { skip }, async () => {
  // A fresh booking for each case that names a real reference: one reference allows only 5 tries a minute.
  const real = async () => (await book({ customerFirstName: "Ana", customerLastName: "Santos" })).reference;
  const cases: [string, string][] = [["unknown code", "ZEUS-ZZZZZZ|Santos"], ["wrong name", (await real()) + "|Reyes"], ["malformed code", "hello|Santos"], ["empty name", (await real()) + "|"], ["partial name", (await real()) + "|Sant"]];
  const seen = new Set<string>(), sizes = new Set<number>(), statuses = new Set<number>(), headerSets = new Set<string>();
  for (const [label, pair] of cases) {
    const [reference, name] = pair.split("|");
    const r = await lookup(reference, name);
    assert.equal(failure(r), "NOT_FOUND: " + GENERIC, label);
    seen.add(JSON.stringify(r.result));
    challenge = { success: true, action: "booking_lookup" };
    const res = await managementHttp(new Request("http://localhost:3000/api/bookings/manage/lookup", { method: "POST", headers: headers(), body: JSON.stringify({ referenceCode: reference, lastName: name, turnstileToken: randomUUID() }) }), "lookup", { db: app, config: c, turnstileEndpoint: endpoint });
    const body = await res.text();
    statuses.add(res.status); sizes.add(body.length);
    headerSets.add(JSON.stringify([...res.headers.entries()].filter(([k]) => !["date", "content-length"].includes(k)).sort()));
    assert.ok(!body.includes(reference) && !body.includes("Santos"), label);
  }
  assert.equal(seen.size, 1, "one identical result");
  assert.deepEqual([...statuses], [404]);
  assert.equal(sizes.size, 1, "one response size");
  assert.equal(headerSets.size, 1, "one header set");
});

test("L3 the security check is mandatory on every attempt: none, a failed one, or one for another action all stop it before any lookup", { skip }, async () => {
  const b = await book({ customerFirstName: "Ana", customerLastName: "Reyes" });
  const noToken = await management.lookupManagedBooking({ referenceCode: b.reference, lastName: "Reyes" }, opts());
  assert.equal(noToken.result.ok, false);
  assert.ok(!noToken.result.ok && ["CHALLENGE_FAILED", "VALIDATION_ERROR"].includes(noToken.result.error.code));
  challenge = { success: false, action: "booking_lookup" };
  const failed = await management.lookupManagedBooking({ referenceCode: b.reference, lastName: "Reyes", turnstileToken: randomUUID() }, opts());
  assert.equal(failure(failed).split(":")[0], "CHALLENGE_FAILED");
  challenge = { success: true, action: "booking_create" }; // a booking-create token replayed on the lookup
  const wrongAction = await management.lookupManagedBooking({ referenceCode: b.reference, lastName: "Reyes", turnstileToken: randomUUID() }, opts());
  assert.equal(failure(wrongAction).split(":")[0], "CHALLENGE_FAILED");
  const ok = await lookup(b.reference, "Reyes");
  assert.ok(ok.result.ok, "the same details open it with a good check");
});

test("L4 one reference is capped across different IPs: 5 a minute, so 11 attempts from 11 IPs are blocked; another reference is unaffected", { skip }, async () => {
  const b = await book({ customerFirstName: "Ana", customerLastName: "Cruz" }), other = await book({ customerFirstName: "Ben", customerLastName: "Cruz" });
  const results: string[] = [];
  for (let i = 0; i < 11; i++) results.push(failure(await lookup(b.reference, i === 10 ? "Cruz" : "Wrong" + i, {}, {}, "203.0.113." + (10 + i))));
  assert.deepEqual(results.slice(0, 5), Array(5).fill("NOT_FOUND: " + GENERIC));
  for (const r of results.slice(5)) assert.equal(r, "RATE_LIMITED: " + LIMIT_TEXT, "blocked, even the right name on the 11th");
  const fine = await lookup(other.reference, "Cruz", {}, {}, "203.0.113.99");
  assert.ok(fine.result.ok, "a different reference is not locked out");
  const { LOOKUP_POLICIES } = await import("./bookings-management-policy");
  assert.deepEqual([LOOKUP_POLICIES.reference.perKeyPerMinute, LOOKUP_POLICIES.reference.perKeyPerDay, LOOKUP_POLICIES.client.perKeyPerMinute, LOOKUP_POLICIES.client.perKeyPerDay], [5, 10, 10, 100]);
});

test("L5 one IP is capped too: 10 a minute across different references", { skip }, async () => {
  const client = "198.18.0.77";
  const results: string[] = [];
  for (let i = 0; i < 12; i++) results.push(failure(await lookup("ZEUS-" + String(100000 + i), "Nobody", {}, {}, client)));
  assert.equal(results.slice(0, 10).every((r) => r === "NOT_FOUND: " + GENERIC), true);
  assert.deepEqual(results.slice(10), Array(2).fill("RATE_LIMITED: " + LIMIT_TEXT));
});

test("L6 a global ceiling on failed lookups per hour slows every answer and logs one alert line without secrets", { skip }, async () => {
  const lines: string[] = [], waits: number[] = [], real = console.warn;
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const seams = { lookup: { ceiling: { failedPerHour: 3, delayMs: 40 }, sleep: async (ms: number) => { waits.push(ms); } } };
    for (let i = 0; i < 8; i++) await lookup("ZEUS-" + String(200000 + i), "Nobody", {}, seams);
  } finally { console.warn = real; }
  assert.ok(waits.length >= 4 && waits.every((w) => w === 40), "answers after the ceiling are slowed: " + JSON.stringify(waits));
  const alerts = lines.filter((l) => l.includes("booking.lookup_alert"));
  assert.equal(alerts.length, 1, "one alert line per window");
  assert.deepEqual(Object.keys(JSON.parse(alerts[0])).sort(), ["event", "failedLastHour"]);
});

test("L7 no reference, name, phone, email, IP or token ever reaches the log", { skip }, async () => {
  const lines: string[] = [], real = { warn: console.warn, info: console.info, log: console.log, error: console.error };
  const grab = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.warn = grab; console.info = grab; console.log = grab; console.error = grab;
  const b = await book({ customerFirstName: "Ana", customerLastName: "Villanueva" });
  const client = "192.0.2.123", token = "tok-" + randomUUID();
  try {
    await lookup(b.reference, "Wrongname", { turnstileToken: token }, {}, client);
    await lookup(b.reference, "Villanueva", { turnstileToken: token }, {}, client);
    await lookup("ZEUS-ABCDEF", "Nobody", { turnstileToken: token }, {}, client);
    challenge = { success: false, action: "booking_lookup" };
    await management.lookupManagedBooking({ referenceCode: b.reference, lastName: "Villanueva", turnstileToken: token }, opts({}, client));
  } finally { Object.assign(console, real); }
  const all = lines.join("\n");
  for (const secret of [b.reference, "Villanueva", "Wrongname", "Nobody", b.phone, b.email!, client, token, "ZEUS-ABCDEF"]) assert.ok(!all.includes(secret), "log leaked " + secret);
  const events = lines.filter((l) => l.includes("booking.lookup")).map((l) => JSON.parse(l).outcome);
  assert.deepEqual(events.slice(0, 3), ["not_found", "found", "not_found"]);
  assert.ok(events.includes("turnstile_failed"));
});

test("L8 an old single-name booking is found by the last word of its name; a one-word name cannot be", { skip }, async () => {
  const old = await book({ customerName: "Juan Dela Cruz" });
  const row = await db.booking.findUniqueOrThrow({ where: { id: old.id } });
  assert.deepEqual([row.customerName, row.customerFirstName, row.customerLastName], ["Juan Dela Cruz", null, null]);
  assert.ok((await lookup(old.reference, "cruz")).result.ok);
  assert.equal(failure(await lookup(old.reference, "Dela")), "NOT_FOUND: " + GENERIC);
  const single = await book({ customerName: "Cher" });
  assert.equal(failure(await lookup(single.reference, "Cher")), "NOT_FOUND: " + GENERIC);
});

test("L9 a new booking stores first and last name and the display name First Last; an old-style request still works after the migration", { skip }, async () => {
  const b = await book({ customerFirstName: "Ana", customerLastName: "dela Cruz" });
  const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
  assert.deepEqual([row.customerName, row.customerFirstName, row.customerLastName], ["Ana dela Cruz", "Ana", "dela Cruz"]);
  // The database itself refuses half a name.
  await assert.rejects(db.$executeRawUnsafe(`UPDATE bookings SET "customerLastName"=NULL WHERE id='${b.id}'`), /booking_customer_name_parts/);
  const old = await book({ customerName: "Old Style" });
  const oldRow = await db.booking.findUniqueOrThrow({ where: { id: old.id } });
  assert.deepEqual([oldRow.customerName, oldRow.customerFirstName, oldRow.customerLastName], ["Old Style", null, null]);
});

test("L10 the lookup writes only a grant and a session; nothing else about the booking changes", { skip }, async () => {
  const b = await book({ customerFirstName: "Ana", customerLastName: "Lim" });
  const before = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
  const grants = await db.bookingManagementGrant.count({ where: { bookingId: b.id } });
  assert.ok((await lookup(b.reference, "Lim")).result.ok);
  const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
  assert.deepEqual(after, before);
  assert.equal(await db.bookingManagementGrant.count({ where: { bookingId: b.id } }), grants + 1);
});

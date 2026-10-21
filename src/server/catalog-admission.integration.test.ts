// P1-10 M2: public catalog and quote reads take a QUOTE admission permit before any connection,
// so a flood of them cannot take the connections that staff reads and booking creates need.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, mapPublisher, publish, siblingDatabaseUrl } from "./catalog-db.fixture";
import { readManifest } from "./catalog.fixture";
import { catalogHttpStatus } from "./catalog-errors";
import { getBookingCatalog } from "./catalog";
import { getBookingQuote } from "./catalog-quote";
import { PUBLIC_CATALOG_READ_POLICY, publicCatalogAdmissionStats, readPublicCatalog } from "./catalog-read";
import { BOOKING_POOL_POLICY, withBookingDb } from "./bookings-admission";
import { parseBookingConfiguration } from "./bookings-credentials";
import { withStaffDb } from "./auth/db-admission";
import { setAuthEventSink } from "./auth/log";
import { CUSTOMER_DB_PERMITS } from "./auth/policy";
import { AdmissionRefused } from "./auth/semaphore";

const url = process.env.T007_TEST_DATABASE_URL, skip = !url;
const root = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused@localhost/zeus_t007_unused" } } });
let db: PrismaClient, small: PrismaClient, dbName = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(condition: () => boolean, what: string, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for " + what);
    await sleep(10);
  }
}
const key = () => randomBytes(32).toString("base64url");
const quoteRing = parseBookingConfiguration({
  BOOKING_QUOTE_KEYS: "q:" + key(), BOOKING_QUOTE_ACTIVE_KID: "q", MANAGEMENT_GRANT_KEYS: "g:" + key(), MANAGEMENT_GRANT_ACTIVE_KID: "g",
  MANAGEMENT_SESSION_KEYS: "s:" + key(), MANAGEMENT_SESSION_ACTIVE_KID: "s", ONLINE_BOOKING_MODE: "OPEN",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_ALLOWED_HOSTNAMES: "localhost", APP_ORIGIN: "http://localhost:3000", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1", NODE_ENV: "test",
}).quote;

before(async () => {
  if (skip) return;
  assert.equal(url, process.env.DATABASE_URL);
  const dbUrl = siblingDatabaseUrl(url!, "quote_permit");
  dbName = new URL(dbUrl).pathname.slice(1);
  await createAndMigrate(root, dbUrl);
  db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs"));
  await mapPublisher(db, "quote-permit@example.test");
  await publish(db, readManifest(), tooling.stableId);
  // A deliberately small pool, so taking more connections than the permits allow shows at once.
  const smallUrl = new URL(dbUrl);
  smallUrl.searchParams.set("connection_limit", "6");
  smallUrl.searchParams.set("pool_timeout", "2");
  small = new PrismaClient({ datasources: { db: { url: smallUrl.toString() } } });
});
after(async () => {
  await small?.$disconnect();
  await db?.$disconnect();
  await root.$disconnect();
});

test("customer permits, QUOTE included, stay inside the 27-connection customer budget", () => {
  const quote = PUBLIC_CATALOG_READ_POLICY.permit;
  assert.ok(quote.maxActive >= 2 && quote.maxActive <= 4, "QUOTE holds 2-4 active permits");
  assert.ok(quote.maxQueued > 0 && quote.maxWaitMs > 0 && quote.maxWaitMs <= 2000, "bounded queue and wait");
  const total = Object.values(BOOKING_POOL_POLICY).reduce((n, p) => n + p.maxActive, 0) + quote.maxActive;
  assert.deepEqual(Object.keys(BOOKING_POOL_POLICY).sort(), ["CREATE", "MANAGEMENT_EXCHANGE", "MANAGEMENT_MUTATION", "MANAGEMENT_READ", "NOTIFICATION", "PREFLIGHT", "READ", "RECOVERY_FENCE", "RECOVERY_LOOKUP"]);
  assert.equal(total, 20, "all nine booking pools plus QUOTE are counted");
  assert.ok(total <= CUSTOMER_DB_PERMITS, `${total} customer permits`);
});

test("a full QUOTE queue refuses catalog and quote reads at once with 503 RETRYABLE_ERROR and Retry-After", { skip }, async () => {
  const { maxActive, maxQueued, maxWaitMs } = PUBLIC_CATALOG_READ_POLICY.permit;
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  let ran = 0;
  // The permitted reads first, inside their transactions; then a full queue behind them.
  const active = Array.from({ length: maxActive }, () => readPublicCatalog(async () => { ran++; await gate; }, { db: small }));
  await waitFor(() => ran === maxActive, "permitted reads started");
  const queued = Array.from({ length: maxQueued }, () => readPublicCatalog(async () => { ran++; }, { db: small }));
  assert.deepEqual(publicCatalogAdmissionStats(), { active: maxActive, queued: maxQueued });

  const started = Date.now();
  const catalog = await getBookingCatalog({ db: small });
  const quote = await getBookingQuote({ vehicleCategoryId: randomUUID(), lines: [{ serviceId: randomUUID(), quantity: 1 }] }, { db: small, ring: quoteRing });
  assert.ok(Date.now() - started < 500, "refused without waiting for a permit or a connection");
  for (const r of [catalog, quote]) {
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.equal(r.error.code, "RETRYABLE_ERROR");
    assert.equal(catalogHttpStatus(r.error), 503);
    assert.equal(r.error.retryAfterSeconds, 10);
    assert.equal(r.error.commitState, "NOT_APPLICABLE");
  }
  assert.equal(ran, maxActive, "only permitted reads reached the database");

  open();
  for (const r of await Promise.allSettled(active)) assert.equal(r.status, "fulfilled");
  // Each queued read either got a freed permit or gave up after maxWaitMs; none waited longer.
  for (const r of await Promise.allSettled(queued)) {
    if (r.status === "rejected") assert.ok(r.reason instanceof AdmissionRefused && r.reason.reason === "TIMEOUT", String(r.reason));
  }

  // A queued read waits at most maxWaitMs for its permit.
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  const busy = Array.from({ length: maxActive }, () => readPublicCatalog(() => hold, { db: small }));
  await waitFor(() => publicCatalogAdmissionStats().active === maxActive, "permits busy");
  const queuedAt = Date.now();
  await assert.rejects(readPublicCatalog(() => null, { db: small }), (e: unknown) => e instanceof AdmissionRefused && e.reason === "TIMEOUT");
  const waited = Date.now() - queuedAt;
  assert.ok(waited >= maxWaitMs - 50 && waited < maxWaitMs + 3000, `waited ${waited} ms`);
  release();
  await Promise.all(busy);
  const ok = await getBookingCatalog({ db: small });
  assert.equal(ok.ok, true, "the catalog reads normally once the flood ends");
});

// Counts this database's sessions sleeping in pg_sleep, sampled from the owner connection.
async function sampleSleepers(stop: () => boolean): Promise<number> {
  let peak = 0;
  while (!stop()) {
    const [{ n }] = await root.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND state = 'active' AND query ILIKE '%pg_sleep(0.8)%' AND pid <> pg_backend_pid()`, dbName);
    peak = Math.max(peak, n);
    await sleep(25);
  }
  return peak;
}

async function staffAndCreateDuringFlood(flood: () => Promise<unknown>[]) {
  const events: string[] = [];
  setAuthEventSink((event) => { events.push(event); });
  let done = false;
  const reads = flood();
  const settled = Promise.allSettled(reads).finally(() => { done = true; });
  const peak = sampleSleepers(() => done);
  await sleep(300);
  const t0 = Date.now();
  const staff = await withStaffDb("STAFF_READ", (tx) => tx.$queryRaw`SELECT 1 AS one`, { db: small, access: "read" }).then(() => "ok", (e: Error) => e.constructor.name);
  const staffMs = Date.now() - t0;
  const t1 = Date.now();
  const create = await withBookingDb(small, "CREATE", (tx) => tx.$queryRaw`SELECT 1 AS one`).then(() => "ok", (e: Error) => e.constructor.name);
  const createMs = Date.now() - t1;
  const outcomes = await settled;
  setAuthEventSink(null);
  return { staff, staffMs, create, createMs, outcomes, events, peak: await peak };
}

test("saturation: with catalog and quote reads flooding, staff reads and creates keep their connections", { skip }, async () => {
  const flood = () => Array.from({ length: 60 }, () => readPublicCatalog(async (_release, tx) => { await tx.$executeRawUnsafe("SELECT pg_sleep(0.8)"); }, { db: small }));
  const r = await staffAndCreateDuringFlood(flood);
  assert.equal(r.staff, "ok");
  assert.equal(r.create, "ok");
  // A pool wait would take the full 2 s pool_timeout (then P2024); permitted work never waits that long.
  assert.ok(r.staffMs < 1800 && r.createMs < 1800, `staff ${r.staffMs} ms, create ${r.createMs} ms`);
  assert.ok(r.peak <= PUBLIC_CATALOG_READ_POLICY.permit.maxActive, `peak ${r.peak} catalog connections`);
  const refused = r.outcomes.filter((o) => o.status === "rejected");
  assert.ok(refused.length > 0, "the flood was refused, not queued without bound");
  for (const o of refused) assert.ok((o as PromiseRejectedResult).reason instanceof AdmissionRefused, String((o as PromiseRejectedResult).reason));
  assert.equal(r.events.includes("db.pool_wait_violation"), false);
});

test("negative control: the same flood without the permit takes the pool and the staff read fails", { skip }, async () => {
  const flood = () => Array.from({ length: 60 }, () => small.$transaction(async (tx) => { await tx.$executeRawUnsafe("SELECT pg_sleep(0.8)"); await tx.$executeRawUnsafe("SELECT pg_sleep(0.8)"); await tx.$executeRawUnsafe("SELECT pg_sleep(0.8)"); }, { maxWait: 10_000, timeout: 20_000 }));
  const r = await staffAndCreateDuringFlood(flood);
  assert.notEqual(r.staff, "ok", "without the permit the flood takes every connection");
  assert.ok(r.peak > PUBLIC_CATALOG_READ_POLICY.permit.maxActive, `peak ${r.peak}`);
});

// P1-02 catalog and quote against real PostgreSQL with published releases. The booking suite
// needs an empty T007 database, so this file creates its own sibling database
// (<T007 name>_catalog) on the same loopback server, migrates it and publishes the reviewed
// manifest through the real publish_catalog() path. Nothing is dropped; a rerun needs a fresh
// T007 database. Without T007_TEST_DATABASE_URL these tests skip.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import type { BookingQuote, CatalogSelection } from "@/types/catalog-contracts";
import { bySlug, readManifest, releaseFromManifest, sizeId, type Manifest } from "./catalog.fixture";
import { publish as publishRelease } from "./catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const enabled = Boolean(url);
const skip = !enabled;
let catalogUrl = "postgresql://unused@localhost/zeus_t007_unused";
if (url) {
  assert.equal(process.env.DATABASE_URL, url, "DATABASE_URL must equal the isolated T007_TEST_DATABASE_URL");
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname) && /^\/zeus_t007_[A-Za-z0-9_]+$/.test(parsed.pathname), "Use only an isolated local test database");
  parsed.pathname = parsed.pathname + "_catalog";
  catalogUrl = parsed.toString();
  // Application modules imported below (the route's prisma client) use the catalog database.
  process.env.DATABASE_URL = catalogUrl;
}
const admin = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: catalogUrl } } });

type Mods = {
  catalog: typeof import("./catalog"); quote: typeof import("./catalog-quote"); read: typeof import("./catalog-read");
  token: typeof import("./catalog-quote-token"); pricing: typeof import("./catalog-pricing");
  route: typeof import("@/app/api/catalog/route"); tooling: { stableId(key: string): string; rollbackManifest(m: Manifest, version: string): Manifest };
};
let m: Mods;
const manifest = readManifest();
const secret = (seed: number) => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + seed * 101 + 11) % 256)).toString("base64url");
let ring: import("./catalog-quote-token").QuoteKeyRing;
let releaseA = "";
const NOW = new Date("2026-10-18T02:00:00.000Z");
const at = (ms = 0) => () => new Date(NOW.getTime() + ms);

const publish = (target: Manifest, reason?: string) => publishRelease(db, target, m.tooling.stableId, reason);
const variant = (version: string, mutate: (target: Manifest) => void = () => {}) => {
  const target = m.tooling.rollbackManifest(manifest, version);
  mutate(target);
  return target;
};

before(async () => {
  if (!enabled) return;
  const name = new URL(catalogUrl).pathname.slice(1);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`).catch((error: unknown) => {
    throw new Error(`Could not create ${name} (use a fresh T007 database; the role needs CREATEDB): ${(error as Error).message}`);
  });
  const migrate = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: catalogUrl }, encoding: "utf8" });
  assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
  m = {
    catalog: await import("./catalog"), quote: await import("./catalog-quote"), read: await import("./catalog-read"),
    token: await import("./catalog-quote-token"), pricing: await import("./catalog-pricing"), route: await import("@/app/api/catalog/route"),
    tooling: await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as Mods["tooling"],
  };
  ring = m.token.parseQuoteKeyRing({ BOOKING_QUOTE_KEYS: `it-a:${secret(3)}`, BOOKING_QUOTE_ACTIVE_KID: "it-a" });
  // The publisher mapping: this test login as an active ADMIN (publish_catalog reads session_user).
  const [{ role }] = await db.$queryRaw<{ role: string }[]>`SELECT session_user::text AS role`;
  const staff = await db.staff.create({ data: { name: "Catalog Test Admin", phone: "", email: "catalog-admin@example.test", role: "ADMIN" } });
  await db.catalogPublisher.create({ data: { databaseRole: role, actorStaffId: staff.id } });
  releaseA = await publish(manifest);
});
after(async () => { await db.$disconnect(); await admin.$disconnect(); });

const r0 = releaseFromManifest();
const id = (slug: string) => bySlug(r0, slug).id;
// One size and the customer's ordered lines; [slug, n] sets a panel count.
const select = (size: string, ...lines: (string | [string, number])[]): CatalogSelection => ({
  vehicleCategoryId: sizeId(r0, size),
  lines: lines.map((l) => (typeof l === "string" ? { serviceId: id(l), quantity: 1 } : { serviceId: id(l[0]), quantity: l[1] })),
});
async function quoteOf(selection: CatalogSelection, now = at()): Promise<BookingQuote> {
  const result = await m.quote.getBookingQuote(selection, { db, ring, now });
  assert.ok(result.ok, JSON.stringify(result));
  return result.data.quote;
}
type Body = Omit<BookingQuote, "quoteToken" | "issuedAt" | "expiresAt">;
const bodyOf = (quote: BookingQuote): Body => {
  const draft: Partial<BookingQuote> = { ...quote };
  delete draft.quoteToken; delete draft.issuedAt; delete draft.expiresAt;
  return draft as Body;
};
const check = (candidate: unknown, now = at()) => db.$transaction((tx) => m.quote.checkAcceptedQuote(tx, candidate, { ring, now }));
const sortPairs = <T extends { baseServiceId: string; addOnServiceId: string }>(pairs: T[]) =>
  [...pairs].sort((a, b) => (a.baseServiceId + a.addOnServiceId).localeCompare(b.baseServiceId + b.addOnServiceId));
const offerAt = (t: Manifest, slug: string, size: string) =>
  t.services.find((x: { slug: string }) => x.slug === slug).offers.find((o: { sizeCode: string }) => o.sizeCode === size);

test("the published release loads exactly as the reviewed manifest, in one read-only REPEATABLE READ transaction", { skip }, async () => {
  const seen = await m.read.readPublicCatalog(async (release, tx) => ({
    release,
    settings: await tx.$queryRaw<{ s: string; ro: string; iso: string }[]>`SELECT current_setting('statement_timeout') AS s,
      current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS iso`,
  }), { db });
  assert.deepEqual(seen.settings[0], { s: "2s", ro: "on", iso: "repeatable read" });
  const expected = releaseFromManifest(manifest, releaseA);
  assert.ok(seen.release);
  assert.deepEqual({ ...seen.release, compatibility: sortPairs(seen.release.compatibility) }, { ...expected, compatibility: sortPairs(expected.compatibility) });
  // Every one of the 105 cells, priced from the database, matches pricing from the manifest.
  for (const service of manifest.services) {
    for (const offer of service.offers) {
      const selection = { vehicleCategoryId: offer.vehicleCategoryId, lines: [{ serviceId: service.id, quantity: 1 }] };
      assert.deepEqual(m.pricing.priceSelection(seen.release, selection), m.pricing.priceSelection(expected, selection), `${service.slug}/${offer.sizeCode}`);
    }
  }
  // The seam cannot write.
  await assert.rejects(m.read.readPublicCatalog((_r, tx) => tx.$executeRaw`UPDATE staff SET name = name`, { db }));
});

test("GET /api/catalog serves only the allowlisted DTO; legacy rows and private columns never appear", { skip }, async () => {
  // Legacy canaries: an active multiplier service and a multiplier size, as release 1 left them.
  await db.vehicleCategory.create({ data: { slug: "SEDAN", name: "CANARY legacy size", sizeMultiplier: "1.15", sortOrder: 9 } });
  await db.service.create({ data: { slug: "canary-legacy", name: "CANARY legacy service", category: "EXTERIOR_WASH_SEAL", durationMinutes: 60, price: "999.00", bayCapacityRequired: 1, isActive: true } });
  const response = await m.route.GET(new NextRequest("http://localhost:3000/api/catalog", { headers: { "x-forwarded-for": "198.51.100.20" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body.data), ["catalogReleaseId", "catalogVersion", "vehicleCategories", "services", "addOnCompatibility"]);
  assert.equal(body.data.catalogReleaseId, releaseA);
  assert.deepEqual(body.data.vehicleCategories.map((v: { code: string }) => v.code), ["MOTOR", "S", "M", "L", "XL"]);
  assert.equal(body.data.services.length, 21);
  for (const canary of ["CANARY", "bayCapacityRequired", "sizeMultiplier", "maxVehicleCapacity", "remainingCapacity", "bayHoldPolicy", "provenance",
    "sourceName", "sourceCompareAtCentavos", "compareAtVerified", "2883300", "manifestSha256", "filmThicknessMil"]) {
    assert.equal(text.includes(canary), false, canary);
  }
  assert.deepEqual(body, JSON.parse(JSON.stringify(await m.catalog.getBookingCatalog({ db }))));
});

test("quotes over the database: priced, for-quote and panel lines sign with their queue; not offered is 400; create accepts them", { skip }, async () => {
  const wash = await quoteOf(select("XL", "premium-wash"));
  assert.deepEqual([wash.catalogReleaseId, wash.primaryServiceId, wash.queueId, wash.totalPriceCentavos, wash.estimatedTotalCentavos, wash.lines[0].priceStatus],
    [releaseA, id("premium-wash"), "WASH", 75000, 75000, "PRICED"]);
  const accepted = await check(wash, at(60_000));
  assert.ok(accepted.ok && accepted.quote.catalogFingerprint === wash.catalogFingerprint && accepted.release.releaseId === releaseA && accepted.priced.queueId === "WASH");
  // One visit, several services: a for-quote coating first (the primary), a priced wash and a for-quote add-on.
  const visit = await quoteOf(select("S", "arcane-graphene", "bac-to-zero", "basic-wash"));
  assert.deepEqual(visit.lines.map((l) => [l.serviceId, l.priceStatus]), [[id("arcane-graphene"), "FOR_QUOTE"],
    [id("basic-wash"), "PRICED"], [id("bac-to-zero"), "FOR_QUOTE"]]);
  assert.deepEqual([visit.queueId, visit.totalPriceCentavos, visit.estimatedTotalCentavos], ["DETAILING_COATING", 18000, 1_310_000 + 18000 + 50000]);
  const acceptedVisit = await check(visit);
  assert.ok(acceptedVisit.ok);
  assert.deepEqual(acceptedVisit.ok && acceptedVisit.priced, bodyOf(visit));
  // Panel repaint on any size: for quote, count x the per-panel reference.
  const panel = await quoteOf(select("MOTOR", ["panel-repaint", 3]));
  assert.deepEqual([panel.queueId, panel.totalPriceCentavos, panel.estimatedTotalCentavos, panel.lines[0].referenceUnitPriceCentavos], ["REPAINT", 0, 1_050_000, 350_000]);
  assert.ok((await check(panel)).ok);
  const notOffered = await m.quote.getBookingQuote(select("MOTOR", "premium-wash"), { db, ring, now: at() });
  assert.ok(!notOffered.ok && notOffered.error.code === "SERVICE_NOT_OFFERED" && notOffered.error.commitState === "NOT_APPLICABLE");
  const unconfirmed = await m.quote.getBookingQuote(select("M", "basic-wash", "headlight-restoration"), { db, ring, now: at() });
  assert.ok(!unconfirmed.ok && unconfirmed.error.code === "SERVICE_NOT_OFFERED" && "lines.1.serviceId" in unconfirmed.error.fieldErrors);
  const malformed = await m.quote.getBookingQuote({ ...select("S", "basic-wash"), price: 1 }, { db, ring, now: at() });
  assert.equal(!malformed.ok && malformed.error.code, "VALIDATION_ERROR");
});

test("create-time checks: forgery 400; signed-but-wrong lines, totals, primary or queue are refused; expiry gets a fresh quote", { skip }, async () => {
  const quote = await quoteOf(select("M", "signature-wash", "interior-detailing"));
  const body = bodyOf(quote);
  const [wash, detailing] = body.lines;
  // Invalid MAC or binding: 400 with no fresh quote.
  for (const forged of [{ ...quote, quoteToken: quote.quoteToken.slice(0, -3) + "AAA" },
    { ...quote, totalPriceCentavos: 1, estimatedTotalCentavos: 1 + detailing.referenceSubtotalCentavos!, lines: [{ ...wash, unitPriceCentavos: 1, subtotalCentavos: 1 }, detailing] }]) {
    const r = await check(forged);
    assert.ok(!r.ok && r.error.code === "VALIDATION_ERROR" && r.error.currentQuote === null && r.error.commitState === "NOT_COMMITTED");
  }
  // A response envelope or a bare selection pasted as the accepted quote.
  for (const pasted of [{ quote }, select("M", "signature-wash")]) {
    const r = await check(pasted);
    assert.equal(!r.ok && r.error.code, "VALIDATION_ERROR");
  }
  // Correctly signed (only possible with a leaked key) but not what the server computes: never accepted,
  // even with consistent arithmetic and the honest fingerprint. Regression for the fingerprint-only check.
  const estimate = (lines: Body["lines"]) => lines.reduce((s, l) => s + (l.subtotalCentavos ?? l.referenceSubtotalCentavos!), 0);
  const cheapLines = [{ ...wash, unitPriceCentavos: 100, subtotalCentavos: 100 }, detailing];
  const promoted = [wash, { ...detailing, priceStatus: "PRICED" as const, unitPriceCentavos: 1, subtotalCentavos: 1, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null }];
  const tampered: [string, Body][] = [
    ["cheaper priced line", { ...body, lines: cheapLines, totalPriceCentavos: 100, estimatedTotalCentavos: estimate(cheapLines) }],
    ["for-quote line charged", { ...body, lines: promoted, totalPriceCentavos: wash.subtotalCentavos! + 1, estimatedTotalCentavos: estimate(promoted) }],
    ["lower reference", { ...body, lines: [wash, { ...detailing, referenceUnitPriceCentavos: 1, referenceSubtotalCentavos: 1 }], estimatedTotalCentavos: wash.subtotalCentavos! + 1 }],
    ["another queue", { ...body, queueId: "REPAINT" }],
  ];
  for (const [label, fields] of tampered) {
    const r = await check(m.token.signQuote(fields, ring, NOW));
    assert.ok(!r.ok && r.error.code === "CATALOG_UPDATED", label + JSON.stringify(r));
    assert.deepEqual(!r.ok && r.error.currentQuote && bodyOf(r.error.currentQuote), body, label);
  }
  // A changed primary is a different visit: the queue always follows the server's primary, never the client's queueId.
  const reprimaried = await check(m.token.signQuote({ ...body, primaryServiceId: detailing.serviceId, lines: [detailing, wash] }, ring, NOW));
  assert.ok(!reprimaried.ok && reprimaried.error.code === "CATALOG_UPDATED");
  assert.deepEqual(!reprimaried.ok && [reprimaried.error.currentQuote?.primaryServiceId, reprimaried.error.currentQuote?.queueId], [detailing.serviceId, "DETAILING_COATING"]);
  // The honest quote passes, and create receives the server's own computation to snapshot.
  const honest = await check(quote);
  assert.ok(honest.ok);
  assert.deepEqual(honest.ok && honest.priced, body);
  // A signed selection the current release refuses keeps that refusal, with no fresh quote.
  const premium = { ...wash, serviceId: id("premium-wash") };
  const notOffered = await check(m.token.signQuote({ ...body, vehicleCategoryId: sizeId(r0, "MOTOR"), primaryServiceId: premium.serviceId, lines: [premium],
    totalPriceCentavos: premium.subtotalCentavos!, estimatedTotalCentavos: premium.subtotalCentavos! }, ring, NOW));
  assert.ok(!notOffered.ok && notOffered.error.code === "SERVICE_NOT_OFFERED" && notOffered.error.currentQuote === null);
  // Exactly at expiry: QUOTE_EXPIRED with a fresh, current quote.
  const expired = await check(quote, at(15 * 60_000));
  assert.ok(!expired.ok && expired.error.code === "QUOTE_EXPIRED" && expired.error.currentQuote);
  assert.equal(!expired.ok && expired.error.currentQuote?.issuedAt, new Date(NOW.getTime() + 15 * 60_000).toISOString());
  assert.deepEqual(!expired.ok && expired.error.currentQuote && bodyOf(expired.error.currentQuote), body);
});

test("a quote read never mixes releases when a publication lands mid-read", { skip }, async () => {
  let paused!: () => void; const reached = new Promise<void>((r) => { paused = r; });
  let resume!: () => void; const resumed = new Promise<void>((r) => { resume = r; });
  // Pause each read right after it reads the head, inside its REPEATABLE READ transaction.
  const instrumented = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
      return (fn: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction((tx) => fn(new Proxy(tx, {
        get(t, p, r) {
          if (p !== "catalogHead") return Reflect.get(t, p, r);
          return { findUnique: async (args: never) => { const head = await t.catalogHead.findUnique(args); paused(); await resumed; return head; } };
        },
      })), options as never);
    },
  }) as PrismaClient;
  assert.ok((await m.catalog.getBookingCatalog({ db })).ok);
  const pendingQuote = m.quote.getBookingQuote(select("L", "basic-wash"), { db: instrumented, ring, now: at() });
  await reached;
  const releaseB = await publish(variant("p1-02-mid-read", (t) => { offerAt(t, "basic-wash", "L").unitPriceCentavos = 26000; }));
  resume();
  const result = await pendingQuote;
  assert.ok(result.ok);
  const quote = result.data.quote;
  const offer = await db.serviceSizeOffer.findUniqueOrThrow({ where: { id: quote.lines[0].offerId } });
  // Head, offer and price all from the release that was current when the read began.
  assert.deepEqual([quote.catalogReleaseId, offer.releaseId, quote.totalPriceCentavos], [releaseA, releaseA, 25000]);
  // The next read sees the new release and its price; the old quote is now stale.
  const after = await quoteOf(select("L", "basic-wash"));
  assert.deepEqual([after.catalogReleaseId, after.totalPriceCentavos], [releaseB, 26000]);
  const stale = await check(quote);
  assert.ok(!stale.ok && stale.error.code === "CATALOG_UPDATED" && stale.error.currentQuote?.totalPriceCentavos === 26000);
});

test("any new release invalidates old quotes: same prices, label-only, newly for-quote, newly unbookable, and a rollback as a new version", { skip }, async () => {
  const before = await quoteOf(select("M", "basic-wash"));
  // Same prices, new release identity.
  const same = await publish(variant("p1-02-same-prices"));
  const sameCheck = await check(before);
  assert.ok(!sameCheck.ok && sameCheck.error.code === "CATALOG_UPDATED");
  assert.equal(!sameCheck.ok && sameCheck.error.currentQuote?.catalogReleaseId, same);
  assert.equal(!sameCheck.ok && sameCheck.error.currentQuote?.totalPriceCentavos, before.totalPriceCentavos); // identical total, still a new acceptance
  // Label-only republish.
  const beforeLabel = await quoteOf(select("M", "basic-wash"));
  await publish(variant("p1-02-label", (t) => { t.services[0].name = "Basic Wash (Express)"; }));
  const labelCheck = await check(beforeLabel);
  assert.ok(!labelCheck.ok && labelCheck.error.code === "CATALOG_UPDATED" && labelCheck.error.currentQuote?.lines[0].name === "Basic Wash (Express)");
  // A priced cell that becomes quote-first stays bookable, now for quote with its price as the reference.
  const beforeMode = await quoteOf(select("M", "basic-wash"));
  await publish(variant("p1-02-quote-first", (t) => { offerAt(t, "basic-wash", "M").bookingMode = "QUOTE_REQUIRED"; }));
  const modeCheck = await check(beforeMode);
  assert.ok(!modeCheck.ok && modeCheck.error.code === "CATALOG_UPDATED");
  const modeQuote = !modeCheck.ok ? modeCheck.error.currentQuote : null;
  assert.deepEqual(modeQuote && [modeQuote.lines[0].priceStatus, modeQuote.totalPriceCentavos, modeQuote.estimatedTotalCentavos], ["FOR_QUOTE", 0, 20000]);
  // A cell that becomes unconfirmed: CATALOG_UPDATED with no fresh quote and a field error.
  const beforeUnconfirmed = await quoteOf(select("M", "signature-wash"));
  await publish(variant("p1-02-unconfirmed", (t) => {
    Object.assign(offerAt(t, "signature-wash", "M"), { state: "UNCONFIRMED", bookingMode: "QUOTE_REQUIRED", unitPriceCentavos: null, durationKind: "UNKNOWN", durationMinutes: null });
  }));
  const unconfirmedCheck = await check(beforeUnconfirmed);
  assert.ok(!unconfirmedCheck.ok && unconfirmedCheck.error.code === "CATALOG_UPDATED" && unconfirmedCheck.error.currentQuote === null
    && unconfirmedCheck.error.fieldErrors.lines, JSON.stringify(unconfirmedCheck));
  // Rolling back to the original content as a new version does not resurrect release-A quotes.
  const rollback = await publish(variant("p1-02-rollback"), "ROLLBACK: restore reviewed manifest");
  const original = m.token.signQuote({ ...bodyOf(await quoteOf(select("M", "basic-wash"))), catalogReleaseId: releaseA }, ring, NOW);
  const rollbackCheck = await check(original);
  assert.ok(!rollbackCheck.ok && rollbackCheck.error.code === "CATALOG_UPDATED" && rollbackCheck.error.currentQuote?.catalogReleaseId === rollback);
  const events = await db.catalogPublicationEvent.findMany({ where: { releaseId: rollback } });
  assert.deepEqual(events.map((e) => e.action), ["ROLLBACK"]);
});

test("C-02: each public catalog or quote read is exactly one REPEATABLE READ transaction through the seam, and nothing else", { skip }, async () => {
  const calls: string[] = [];
  const recording = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "$transaction") return (fn: never, options: never) => { calls.push(`tx:${(options as { isolationLevel?: string } | undefined)?.isolationLevel}`); return target.$transaction(fn, options); };
      if (typeof prop === "string" && (prop.startsWith("$query") || prop.startsWith("$execute") || prop in target && typeof value === "object" && value && "findMany" in value)) calls.push(`direct:${prop}`);
      return value;
    },
  }) as PrismaClient;
  assert.ok((await m.catalog.getBookingCatalog({ db: recording })).ok);
  assert.ok((await m.quote.getBookingQuote(select("S", "basic-wash"), { db: recording, ring, now: at() })).ok);
  assert.ok((await m.quote.getBookingQuote(select("S", ["panel-repaint", 3], "full-detailing"), { db: recording, ring, now: at() })).ok);
  assert.deepEqual(calls, ["tx:RepeatableRead", "tx:RepeatableRead", "tx:RepeatableRead"]);
  // Invalid input is refused before any database work.
  assert.equal((await m.quote.getBookingQuote({ serviceId: "x" }, { db: recording, ring })).ok, false);
  assert.equal(calls.length, 3);
});

test("fail closed: no published release or no key ring is 503, never an empty, default or unsigned quote", { skip }, async () => {
  // The T007 database has no catalog head.
  const none = await m.catalog.getBookingCatalog({ db: admin });
  assert.ok(!none.ok && none.error.code === "RETRYABLE_ERROR" && none.error.retryAfterSeconds === 10);
  const noneQuote = await m.quote.getBookingQuote(select("S", "basic-wash"), { db: admin, ring, now: at() });
  assert.equal(!noneQuote.ok && noneQuote.error.code, "RETRYABLE_ERROR");
  // No BOOKING_QUOTE_KEYS in this process: nothing is quoted, priced or for quote (every v3 quote is signed).
  assert.equal(process.env.BOOKING_QUOTE_KEYS, undefined);
  for (const selection of [select("S", "basic-wash"), select("S", "full-detailing")]) {
    const unsigned = await m.quote.getBookingQuote(selection, { db, now: at() });
    assert.ok(!unsigned.ok && unsigned.error.code === "RETRYABLE_ERROR");
  }
});

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

// Mirrors prisma/catalog/catalog.mjs seedCatalog (draft only), without its source-document
// check, so tests can also publish label or mode changes. publish_catalog still verifies every
// stored row against the manifest JSON and hash.
async function insertDraft(target: Manifest): Promise<{ releaseId: string; hash: string }> {
  const { canonicalManifest, manifestSha256 } = await import("./catalog.fixture");
  const releaseId = m.tooling.stableId("release." + target.version);
  const hash = manifestSha256(target);
  const groupToKind: Record<string, "EXTERIOR_WASH_SEAL" | "INTERIOR_DETAILING" | "CERAMIC_COATING" | "WINDOW_TINT_PPF" | "PAINT_CORRECTION"> =
    { WASH: "EXTERIOR_WASH_SEAL", DETAILING: "INTERIOR_DETAILING", GRAPHENE: "CERAMIC_COATING", TINT: "WINDOW_TINT_PPF", PPF: "WINDOW_TINT_PPF", REPAINT: "PAINT_CORRECTION" };
  await db.$transaction(async (tx) => {
    await tx.catalogRelease.create({ data: { id: releaseId, version: target.version, sourcePath: target.sourcePath,
      sourceReceivedDate: new Date(target.sourceReceivedDate + "T00:00:00Z"), sourceSha256: target.sourceSha256, manifestSha256: hash, manifestJson: canonicalManifest(target) } });
    for (const size of target.sizes) {
      if (!(await tx.vehicleCategory.findUnique({ where: { slug: size.code } }))) {
        await tx.vehicleCategory.create({ data: { id: size.id, slug: size.code, name: size.name, sortOrder: size.sortOrder, sizeMultiplier: null } });
      }
    }
    for (const service of target.services) {
      if (!(await tx.service.findUnique({ where: { slug: service.slug } }))) {
        await tx.service.create({ data: { id: service.id, slug: service.slug, name: service.name, category: groupToKind[service.group], price: null, durationMinutes: null, isActive: false } });
      }
      const { id, offers, ...metadata } = service;
      await tx.catalogServiceVersion.create({ data: { releaseId, serviceId: id, ...metadata } });
      for (const offer of offers) {
        const { durationKind, durationMinutes, elapsedDays, bayHoldPolicy, ...data } = offer;
        await tx.serviceSizeOffer.create({ data: { ...data, releaseId, serviceId: id, workPlan: { create: { kind: durationKind, durationMinutes, elapsedDays, bayHoldPolicy } } } });
      }
    }
    for (const pair of target.compatibility) await tx.addOnCompatibility.create({ data: { releaseId, ...pair } });
  }, { timeout: 60_000 });
  return { releaseId, hash };
}
async function publish(target: Manifest, reason = "P1-02 test publication"): Promise<string> {
  const { releaseId, hash } = await insertDraft(target);
  await db.$queryRaw`SELECT publish_catalog(${releaseId}, ${hash}, ${"P1-02 synthetic review"}, ${reason}) AS event_id`;
  return releaseId;
}
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

const select = (slug: string, size: string, extra: Partial<CatalogSelection> = {}): CatalogSelection => {
  const r = releaseFromManifest();
  return { serviceId: bySlug(r, slug).id, vehicleCategoryId: sizeId(r, size), quantity: 1, addOnServiceIds: [], ...extra };
};
async function bookableQuote(slug = "basic-wash", size = "S", now = at()): Promise<BookingQuote> {
  const result = await m.quote.getBookingQuote(select(slug, size), { db, ring, now });
  assert.ok(result.ok && result.data.kind === "BOOKABLE", JSON.stringify(result));
  return result.data.quote!;
}
const check = (candidate: unknown, now = at()) => db.$transaction((tx) => m.quote.checkAcceptedQuote(tx, candidate, { ring, now }));
const sortPairs = <T extends { baseServiceId: string; addOnServiceId: string }>(pairs: T[]) =>
  [...pairs].sort((a, b) => (a.baseServiceId + a.addOnServiceId).localeCompare(b.baseServiceId + b.addOnServiceId));

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
  // Every one of the 105 cells, priced from the database, matches the manifest.
  for (const service of manifest.services) {
    for (const offer of service.offers) {
      const priced = m.pricing.priceSelection(seen.release, { serviceId: service.id, vehicleCategoryId: offer.vehicleCategoryId, quantity: 1, addOnServiceIds: [] });
      if (priced.kind === "BOOKABLE") assert.equal(priced.quote.totalPriceCentavos, offer.unitPriceCentavos, `${service.slug}/${offer.sizeCode}`);
      if (priced.kind === "QUOTE_REQUIRED") assert.equal(priced.estimate.totalPriceCentavos, offer.state === "OFFERED" ? offer.unitPriceCentavos : null);
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

test("quotes over the database: a fixed wash signs, quote-first estimates, not-offered is 400, and create accepts it", { skip }, async () => {
  const quote = await bookableQuote("premium-wash", "XL");
  assert.equal(quote.catalogReleaseId, releaseA);
  assert.deepEqual([quote.totalPriceCentavos, quote.durationMinutes, quote.lines[0].name], [75000, 45, "Premium Wash"]);
  const accepted = await check(quote, at(60_000));
  assert.ok(accepted.ok && accepted.quote.catalogFingerprint === quote.catalogFingerprint && accepted.release.releaseId === releaseA);
  const estimate = await m.quote.getBookingQuote(select("arcane-graphene", "S"), { db, ring, now: at() });
  assert.ok(estimate.ok && estimate.data.kind === "QUOTE_REQUIRED" && estimate.data.quote === null);
  assert.equal(estimate.ok && estimate.data.kind === "QUOTE_REQUIRED" && estimate.data.estimate.totalPriceCentavos, 1_310_000);
  const notOffered = await m.quote.getBookingQuote(select("premium-wash", "MOTOR"), { db, ring, now: at() });
  assert.equal(!notOffered.ok && notOffered.error.code, "SERVICE_NOT_OFFERED");
  assert.equal(!notOffered.ok && notOffered.error.commitState, "NOT_APPLICABLE");
  const malformed = await m.quote.getBookingQuote({ ...select("basic-wash", "S"), price: 1 }, { db, ring, now: at() });
  assert.equal(!malformed.ok && malformed.error.code, "VALIDATION_ERROR");
});

test("create-time checks: forgery 400, signed-but-wrong prices and quote-first are refused, expiry gets a fresh quote", { skip }, async () => {
  const quote = await bookableQuote("signature-wash", "M");
  // Invalid MAC or binding: 400 with no fresh quote.
  for (const forged of [{ ...quote, quoteToken: quote.quoteToken.slice(0, -3) + "AAA" }, { ...quote, totalPriceCentavos: 1, lines: [{ ...quote.lines[0], unitPriceCentavos: 1, subtotalCentavos: 1 }] }]) {
    const r = await check(forged);
    assert.ok(!r.ok && r.error.code === "VALIDATION_ERROR" && r.error.currentQuote === null && r.error.commitState === "NOT_COMMITTED");
  }
  // A preview pasted as the accepted quote.
  const preview = await m.quote.getBookingQuote(select("basic-wash", "S", { addOnServiceIds: [bySlug(releaseFromManifest(), "bac-to-zero").id] }), { db, ring, now: at() });
  assert.ok(preview.ok && preview.data.kind === "QUOTE_REQUIRED");
  for (const pasted of [preview.ok ? preview.data : null, preview.ok && preview.data.kind === "QUOTE_REQUIRED" ? preview.data.estimate : null]) {
    const r = await check(pasted);
    assert.equal(!r.ok && r.error.code, "VALIDATION_ERROR");
  }
  // Correctly signed but not what the server computes (only possible with a leaked key): never accepted.
  const draft: Partial<BookingQuote> = { ...quote };
  delete draft.quoteToken; delete draft.issuedAt; delete draft.expiresAt;
  const body = draft as Omit<BookingQuote, "quoteToken" | "issuedAt" | "expiresAt">;
  // Regression: the fingerprint was the only field compared, so a signed lower price with the
  // honest fingerprint was accepted. Price and duration changes with consistent arithmetic:
  const cheap = m.token.signQuote({ ...body, totalPriceCentavos: 100, lines: [{ ...body.lines[0], unitPriceCentavos: 100, subtotalCentavos: 100 }] }, ring, NOW);
  const short = m.token.signQuote({ ...body, durationMinutes: 5, lines: [{ ...body.lines[0], addedMinutes: 5 }] }, ring, NOW);
  for (const tampered of [cheap, short]) {
    const tamperedCheck = await check(tampered);
    assert.ok(!tamperedCheck.ok && tamperedCheck.error.code === "CATALOG_UPDATED", JSON.stringify(tamperedCheck));
    assert.deepEqual(!tamperedCheck.ok && [tamperedCheck.error.currentQuote?.totalPriceCentavos, tamperedCheck.error.currentQuote?.durationMinutes], [45000, 35]);
  }
  // The honest quote passes, and create receives the server's own computation to snapshot.
  const honest = await check(quote);
  assert.ok(honest.ok);
  assert.deepEqual(honest.ok && honest.priced, body);
  const r = releaseFromManifest();
  const quoteFirst = m.token.signQuote({ ...body, serviceId: bySlug(r, "interior-detailing").id, lines: [{ ...body.lines[0], serviceId: bySlug(r, "interior-detailing").id }] }, ring, NOW);
  const quoteFirstCheck = await check(quoteFirst);
  assert.ok(!quoteFirstCheck.ok && quoteFirstCheck.error.code === "QUOTE_REQUIRED" && quoteFirstCheck.error.currentQuote === null);
  const motor = sizeId(r, "MOTOR");
  const notOffered = m.token.signQuote({ ...body, serviceId: bySlug(r, "premium-wash").id, vehicleCategoryId: motor, lines: [{ ...body.lines[0], serviceId: bySlug(r, "premium-wash").id }] }, ring, NOW);
  const notOfferedCheck = await check(notOffered);
  assert.equal(!notOfferedCheck.ok && notOfferedCheck.error.code, "SERVICE_NOT_OFFERED");
  // Exactly at expiry: QUOTE_EXPIRED with a fresh, current quote.
  const expired = await check(quote, at(15 * 60_000));
  assert.ok(!expired.ok && expired.error.code === "QUOTE_EXPIRED" && expired.error.currentQuote);
  assert.equal(!expired.ok && expired.error.currentQuote?.issuedAt, new Date(NOW.getTime() + 15 * 60_000).toISOString());
  assert.equal(!expired.ok && expired.error.currentQuote?.totalPriceCentavos, quote.totalPriceCentavos);
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
  const before = (await m.catalog.getBookingCatalog({ db })).ok;
  assert.ok(before);
  const pendingQuote = m.quote.getBookingQuote(select("basic-wash", "L"), { db: instrumented, ring, now: at() });
  await reached;
  const releaseB = await publish(variant("p1-02-mid-read", (t) => { t.services[0].offers.find((o: { sizeCode: string }) => o.sizeCode === "L").unitPriceCentavos = 26000; }));
  resume();
  const result = await pendingQuote;
  assert.ok(result.ok && result.data.kind === "BOOKABLE");
  const quote = result.ok && result.data.kind === "BOOKABLE" ? result.data.quote : null;
  const offer = await db.serviceSizeOffer.findUniqueOrThrow({ where: { id: quote!.lines[0].offerId } });
  // Head, offer and price all from the release that was current when the read began.
  assert.deepEqual([quote!.catalogReleaseId, offer.releaseId, quote!.totalPriceCentavos], [releaseA, releaseA, 25000]);
  // The next read sees the new release and its price; the old quote is now stale.
  const after = await bookableQuote("basic-wash", "L");
  assert.deepEqual([after.catalogReleaseId, after.totalPriceCentavos], [releaseB, 26000]);
  const stale = await check(quote);
  assert.ok(!stale.ok && stale.error.code === "CATALOG_UPDATED" && stale.error.currentQuote?.totalPriceCentavos === 26000);
});

test("any new release invalidates old quotes: same prices, label-only, newly unbookable, and a rollback as a new version", { skip }, async () => {
  const before = await bookableQuote("basic-wash", "M");
  // Same prices, new release identity.
  const same = await publish(variant("p1-02-same-prices"));
  const sameCheck = await check(before);
  assert.ok(!sameCheck.ok && sameCheck.error.code === "CATALOG_UPDATED");
  assert.equal(!sameCheck.ok && sameCheck.error.currentQuote?.catalogReleaseId, same);
  assert.equal(!sameCheck.ok && sameCheck.error.currentQuote?.totalPriceCentavos, before.totalPriceCentavos); // identical total, still a new acceptance
  // Label-only republish.
  const beforeLabel = await bookableQuote("basic-wash", "M");
  await publish(variant("p1-02-label", (t) => { t.services[0].name = "Basic Wash (Express)"; }));
  const labelCheck = await check(beforeLabel);
  assert.ok(!labelCheck.ok && labelCheck.error.code === "CATALOG_UPDATED" && labelCheck.error.currentQuote?.lines[0].name === "Basic Wash (Express)");
  // A pair that becomes quote-first: CATALOG_UPDATED with no fresh quote and a field error.
  const beforeMode = await bookableQuote("basic-wash", "M");
  await publish(variant("p1-02-quote-first", (t) => { Object.assign(t.services[0].offers.find((o: { sizeCode: string }) => o.sizeCode === "M"), { bookingMode: "QUOTE_REQUIRED" }); }));
  const modeCheck = await check(beforeMode);
  assert.ok(!modeCheck.ok && modeCheck.error.code === "CATALOG_UPDATED" && modeCheck.error.currentQuote === null && modeCheck.error.fieldErrors.serviceId);
  // Rolling back to the original content as a new version does not resurrect release-A quotes.
  const rollback = await publish(variant("p1-02-rollback"), "ROLLBACK: restore reviewed manifest");
  const original = m.token.signQuote({ ...(await bookableQuote("basic-wash", "M")), catalogReleaseId: releaseA }, ring, NOW);
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
  assert.ok((await m.quote.getBookingQuote(select("basic-wash", "S"), { db: recording, ring, now: at() })).ok);
  assert.ok((await m.quote.getBookingQuote(select("panel-repaint", "S", { quantity: 3 }), { db: recording, ring, now: at() })).ok);
  assert.deepEqual(calls, ["tx:RepeatableRead", "tx:RepeatableRead", "tx:RepeatableRead"]);
  // Invalid input is refused before any database work.
  assert.equal((await m.quote.getBookingQuote({ serviceId: "x" }, { db: recording, ring })).ok, false);
  assert.equal(calls.length, 3);
});

test("fail closed: no published release or no key ring is 503, never an empty, default or unsigned quote", { skip }, async () => {
  // The T007 database has no catalog head.
  const none = await m.catalog.getBookingCatalog({ db: admin });
  assert.ok(!none.ok && none.error.code === "RETRYABLE_ERROR" && none.error.retryAfterSeconds === 10);
  const noneQuote = await m.quote.getBookingQuote(select("basic-wash", "S"), { db: admin, ring, now: at() });
  assert.equal(!noneQuote.ok && noneQuote.error.code, "RETRYABLE_ERROR");
  // No BOOKING_QUOTE_KEYS in this process: a bookable selection cannot be signed.
  assert.equal(process.env.BOOKING_QUOTE_KEYS, undefined);
  const unsigned = await m.quote.getBookingQuote(select("basic-wash", "S"), { db, now: at() });
  assert.ok(!unsigned.ok && unsigned.error.code === "RETRYABLE_ERROR");
  // Quote-first estimates need no key.
  const estimate = await m.quote.getBookingQuote(select("full-detailing", "S"), { db, now: at() });
  assert.ok(estimate.ok && estimate.data.kind === "QUOTE_REQUIRED");
});

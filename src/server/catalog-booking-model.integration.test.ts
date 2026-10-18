// P1-02 booking-model migration (ADR-005, Amendment 1, PM decisions on Revision 3) against real
// PostgreSQL. Every guard is driven with raw SQL, as any writer would reach it; V3 rows come from
// the real quote-v3 pricing, so the database accepts exactly what the server prices. Uses its own
// sibling database (<T007 name>_model); nothing is dropped. Without T007_TEST_DATABASE_URL these
// tests skip.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { CatalogSelection } from "@/types/catalog-contracts";
import type { UnsignedQuote } from "./catalog-pricing";
import { bySlug, readManifest, releaseFromManifest, sizeId, type Manifest } from "./catalog.fixture";
import { createAndMigrate, insertDraft, mapPublisher, publish, siblingDatabaseUrl } from "./catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const modelUrl = url ? siblingDatabaseUrl(url, "model") : "postgresql://unused@localhost/zeus_t007_unused_model";
const admin = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: modelUrl } } });
type Tx = Prisma.TransactionClient | PrismaClient;

let pricing: typeof import("./catalog-pricing");
let tooling: { stableId(key: string): string; rollbackManifest(m: Manifest, version: string): Manifest };
const manifest = readManifest();
let releaseA = ""; // the head release
let headManifest: Manifest = manifest;
let releaseB = "";
let draftRelease = ""; // inserted, never published
let draftManifest: Manifest = manifest;
let adminId = "";
let detailerId = "";
let runtimeRole = false;
let seq = 0;

// SQL literals for synthetic test values only.
const lit = (v: unknown): string => v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "bigint" ? String(v)
  : typeof v === "boolean" ? (v ? "true" : "false") : `'${String(v).replace(/'/g, "''")}'`;
async function insert(tx: Tx, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(row[c])).join(",")})`);
}
async function one<T = Record<string, unknown>>(tx: Tx, sql: string): Promise<T> { return ((await tx.$queryRawUnsafe(sql)) as T[])[0]; }
const lock = (tx: Tx) => tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001, 1)");
function inTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => { await lock(tx); return fn(tx); }, { timeout: 20_000 });
}
const rejects = (p: Promise<unknown>, pattern: RegExp, label: string) => assert.rejects(p, (e: unknown) => {
  assert.match(String((e as Error).message), pattern, label);
  return true;
}, label);

// Manila day window for a business date.
const dayStart = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00")).toISOString();
const dayEnd = (day: string) => new Date(Date.parse(day + "T00:00:00+08:00") + 86_400_000).toISOString();
const r0 = () => releaseFromManifest(headManifest, releaseA);
const select = (size: string, ...lines: (string | [string, number])[]): CatalogSelection => ({
  vehicleCategoryId: sizeId(r0(), size),
  lines: lines.map((l) => (typeof l === "string" ? { serviceId: bySlug(r0(), l).id, quantity: 1 } : { serviceId: bySlug(r0(), l[0]).id, quantity: l[1] })),
});
function quote(selection: CatalogSelection, release = r0()): UnsignedQuote {
  const priced = pricing.priceSelection(release, selection);
  assert.equal(priced.kind, "QUOTED", JSON.stringify(priced));
  return priced.kind === "QUOTED" ? priced.quote : (null as never);
}

interface V3 { booking: Record<string, unknown>; lines: Record<string, unknown>[] }
function v3Rows(q: UnsignedQuote, day: string, position: number, release = r0()): V3 {
  const id = randomUUID();
  const n = ++seq;
  const size = release.sizes.find((s) => s.id === q.vehicleCategoryId)!;
  return {
    booking: {
      id, referenceCode: `ZEUS-M${String(n).padStart(5, "0")}`, customerName: "Synthetic model", customerPhone: "+639170000001", vehicleModel: "Synthetic",
      vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: day, startsAt: dayStart(day), endsAt: dayEnd(day),
      status: "PENDING", priceSnapshot: q.totalPriceCentavos / 100, serviceNameSnapshot: q.lines[0].name, vehicleCategoryNameSnapshot: size.name,
      idempotencyKey: randomUUID(), requestHash: "synthetic-v3-" + n, updatedAt: new Date().toISOString(), snapshotVersion: "QUEUE_V3",
      catalogReleaseId: q.catalogReleaseId, vehicleSizeCodeSnapshot: size.code, catalogFingerprint: q.catalogFingerprint, pricingAlgorithm: q.pricingAlgorithm,
      queueCode: q.queueId, queuePosition: position, receiptTotalCentavos: q.totalPriceCentavos, receiptEstimatedCentavos: q.estimatedTotalCentavos,
    },
    lines: q.lines.map((l, i) => ({
      id: randomUUID(), bookingId: id, order: i, releaseId: q.catalogReleaseId, serviceId: l.serviceId, vehicleCategoryId: q.vehicleCategoryId,
      offerId: l.offerId, type: l.kind, nameSnapshot: l.name, unit: l.unit, quantity: l.quantity, unitPriceCentavos: l.unitPriceCentavos,
      subtotalCentavos: l.subtotalCentavos, addedMinutes: null, lineVersion: "QUEUE_V3", priceStatus: l.priceStatus,
      referenceUnitPriceCentavos: l.referenceUnitPriceCentavos, referenceSubtotalCentavos: l.referenceSubtotalCentavos,
    })),
  };
}
async function createV3(rows: V3): Promise<string> {
  await inTx(async (tx) => {
    await insert(tx, "bookings", rows.booking);
    for (const line of rows.lines) await insert(tx, "booking_line_items", line);
  });
  return rows.booking.id as string;
}
const mutate = (rows: V3, booking: Record<string, unknown> = {}, line?: (lines: Record<string, unknown>[]) => void): V3 => {
  const copy = structuredClone(rows);
  Object.assign(copy.booking, booking);
  line?.(copy.lines);
  return copy;
};
const fresh = (q: UnsignedQuote, day: string, position: number) => v3Rows(q, day, position);
async function audit(tx: Tx, row: Record<string, unknown>) { await insert(tx, "booking_audit_events", { id: randomUUID(), actorStaffId: adminId, ...row }); }
// One staff edit: bump the booking revision, apply the change, write its audit row (A4, ADR-003).
async function staffEdit(bookingId: string, change: (tx: Prisma.TransactionClient, revision: number) => Promise<unknown>) {
  await inTx(async (tx) => {
    const { revision } = await one<{ revision: number }>(tx, `SELECT revision FROM bookings WHERE id=${lit(bookingId)}`);
    await tx.$executeRawUnsafe(`UPDATE bookings SET revision=revision+1 WHERE id=${lit(bookingId)}`);
    await change(tx, revision);
  });
}
const lineOf = (bookingId: string, order: number) => one<Record<string, unknown>>(db, `SELECT * FROM booking_line_items WHERE "bookingId"=${lit(bookingId)} AND "order"=${order}`);

before(async () => {
  if (skip) return;
  const roles = await admin.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_roles WHERE rolname='zeus_app'`);
  if (!roles.length) await admin.$executeRawUnsafe("CREATE ROLE zeus_app NOLOGIN").catch(() => undefined);
  runtimeRole = ((await admin.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_roles WHERE rolname='zeus_app'`)).length) > 0;
  await createAndMigrate(admin, modelUrl);
  pricing = await import("./catalog-pricing");
  tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs")) as typeof tooling;
  adminId = await mapPublisher(db, "model-admin@example.test");
  detailerId = (await db.staff.create({ data: { name: "Model Detailer", phone: "", email: "model-detailer@example.test", role: "DETAILER" } })).id;
  releaseA = await publish(db, manifest, tooling.stableId);
  draftManifest = tooling.rollbackManifest(manifest, "p1-02-model-draft");
  draftRelease = (await insertDraft(db, draftManifest, tooling.stableId)).releaseId;
  // Synthetic caps for the tests (no launch value is hardcoded anywhere).
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now(), "updatedByStaffId"=${lit(adminId)}`);
});
after(async () => { await db.$disconnect(); await admin.$disconnect(); });

test("migration shape: four queues with no cap value, enums, indexes and the deferrable position constraint", { skip }, async () => {
  const queues = await db.$queryRawUnsafe<{ code: string; name: string }[]>(`SELECT code, name FROM booking_queues ORDER BY "sortOrder"`);
  assert.deepEqual(queues.map((q) => q.code), ["WASH", "DETAILING_COATING", "TINT_PPF", "REPAINT"]);
  const seeded = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM booking_queues WHERE "dailyCap" IS NOT NULL AND revision=1`);
  assert.equal(Number(seeded[0].n), 0, "the migration seeds no cap value");
  const enumValues = await db.$queryRawUnsafe<{ v: string }[]>(`SELECT unnest(enum_range(NULL::"SnapshotVersion"))::text AS v`);
  assert.deepEqual(enumValues.map((e) => e.v), ["LEGACY_V1", "CATALOG_V2", "QUEUE_V3"]);
  const phoneIndex = await db.$queryRawUnsafe<{ indexdef: string }[]>(`SELECT indexdef FROM pg_indexes WHERE tablename='bookings' AND indexdef LIKE '%"customerPhone"%'`);
  assert.equal(phoneIndex.length, 1);
  assert.match(phoneIndex[0].indexdef, /\("customerPhone", "bookingDate" DESC\)/);
  const plan = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN SELECT id FROM bookings WHERE "customerPhone"='+639170000001' ORDER BY "bookingDate" DESC`);
  });
  assert.match(plan.map((p) => p["QUERY PLAN"]).join("\n"), /bookings_customerPhone_bookingDate_idx/);
  const position = await one<{ condeferrable: boolean }>(db, `SELECT condeferrable FROM pg_constraint WHERE conname='bookings_bookingDate_queueCode_queuePosition_key'`);
  assert.equal(position.condeferrable, true);
  // The published release carries the §7 queue mapping as release data.
  const mapped = await db.$queryRawUnsafe<{ slug: string; queueCode: string }[]>(`SELECT slug, "queueCode" FROM catalog_service_versions WHERE "releaseId"=${lit(releaseA)}`);
  assert.equal(mapped.length, 21);
  for (const row of mapped) assert.equal(row.queueCode, manifest.services.find((s: { slug: string }) => s.slug === row.slug).queueCode, row.slug);
});

test("valid day-queue creates: a priced wash, a for-quote primary with a wash and an add-on, and panel repaint x3 on MOTOR", { skip }, async () => {
  for (const [selection, day] of [[select("S", "basic-wash"), "2027-03-01"], [select("S", "arcane-graphene", "bac-to-zero", "basic-wash"), "2027-03-01"],
    [select("MOTOR", ["panel-repaint", 3]), "2027-03-01"]] as const) {
    const q = quote(selection);
    const id = await createV3(fresh(q, day, 1));
    const row = await one<Record<string, unknown>>(db, `SELECT "queueCode", "queuePosition", revision, "receiptTotalCentavos", "receiptEstimatedCentavos", "startTime", "durationMinutes", "terminalAt" FROM bookings WHERE id=${lit(id)}`);
    assert.deepEqual([row.queueCode, row.queuePosition, row.revision, row.receiptTotalCentavos, row.receiptEstimatedCentavos, row.startTime, row.durationMinutes, row.terminalAt],
      [q.queueId, 1, 1, q.totalPriceCentavos, q.estimatedTotalCentavos, null, null, null]);
    const lines = await db.$queryRawUnsafe<{ workStatus: string; addedByStaffId: string | null }[]>(`SELECT "workStatus", "addedByStaffId" FROM booking_line_items WHERE "bookingId"=${lit(id)}`);
    assert.equal(lines.length, q.lines.length);
    assert.ok(lines.every((l) => l.workStatus === "WAITING" && l.addedByStaffId === null));
  }
});

test("invalid day-queue creates are refused at commit: prices, references, offer states, primary, counts, receipts and shape", { skip }, async () => {
  const visit = quote(select("S", "arcane-graphene", "bac-to-zero", "basic-wash"));
  const base = fresh(visit, "2027-03-02", 1);
  const washLine = (lines: Record<string, unknown>[]) => lines.find((l) => l.priceStatus === "PRICED")!;
  const coating = (lines: Record<string, unknown>[]) => lines[0];
  const r = r0();
  const offerOf = (slug: string, size: string) => bySlug(r, slug).offers.find((o) => o.sizeCode === size)!;
  const cases: [string, V3, RegExp][] = [
    ["wrong priced amount", mutate(base, { receiptTotalCentavos: 100, priceSnapshot: 1, receiptEstimatedCentavos: visit.estimatedTotalCentavos! - 17_900 },
      (ls) => Object.assign(washLine(ls), { unitPriceCentavos: 100, subtotalCentavos: 100 })), /snapshot offer mismatch/],
    ["a charged for-quote line", mutate(base, {}, (ls) => Object.assign(coating(ls), { unitPriceCentavos: 1, subtotalCentavos: 1 })), /catalog_line_bounds/],
    ["a for-quote line marked priced", mutate(base, { receiptTotalCentavos: 18_000 + 1_310_000, priceSnapshot: 13_280 }, (ls) => Object.assign(coating(ls),
      { priceStatus: "PRICED", unitPriceCentavos: 1_310_000, subtotalCentavos: 1_310_000, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null })), /snapshot offer mismatch/],
    ["a reference other than the source price", mutate(base, { receiptEstimatedCentavos: visit.estimatedTotalCentavos! - 1_309_999 },
      (ls) => Object.assign(coating(ls), { referenceUnitPriceCentavos: 1, referenceSubtotalCentavos: 1 })), /snapshot offer mismatch/],
    ["receipt total mismatch", mutate(base, { receiptTotalCentavos: 18_001, priceSnapshot: 180.01 }), /receipt/],
    ["receipt estimate mismatch", mutate(base, { receiptEstimatedCentavos: visit.estimatedTotalCentavos! + 1 }), /receipt/],
    ["primary not at order 0", mutate(base, { serviceId: bySlug(r, "basic-wash").id }), /primary/],
    ["queue not the primary's", mutate(base, { queueCode: "WASH" }), /queue/],
    ["a duplicate service", mutate(base, {}, (ls) => { ls.push({ ...structuredClone(ls[1]), id: randomUUID(), order: 3 }); }), /once per visit/],
    ["a create line from another release", mutate(base, {}, (ls) => {
      const offer = bySlug(releaseFromManifest(draftManifest, draftRelease), "basic-wash").offers.find((o) => o.sizeCode === "S")!;
      Object.assign(washLine(ls), { releaseId: draftRelease, offerId: offer.id });
    }), /release/],
    ["no lines", { booking: base.booking, lines: [] }, /Incomplete catalog snapshot|lines/],
    ["phone not normalized", mutate(base, { customerPhone: "09170000001" }), /booking_model_shape/],
    ["a clock time on a day booking", mutate(base, { startTime: "08:00" }), /booking_model_shape/],
    ["start not Manila midnight", mutate(base, { startsAt: new Date(Date.parse(dayStart("2027-03-02")) + 1).toISOString() }), /booking_model_shape/],
    ["end not the next midnight", mutate(base, { endsAt: new Date(Date.parse(dayEnd("2027-03-02")) - 1).toISOString() }), /booking_model_shape/],
    ["no queue position", mutate(base, { queuePosition: null }), /booking_model_shape/],
    ["terminalAt on a pending booking", mutate(base, { terminalAt: new Date().toISOString() }), /booking_model_shape/],
    ["cancellationKind on a pending booking", mutate(base, { cancellationKind: "CUSTOMER" }), /booking_model_shape/],
    ["algorithm v2 on a day booking", mutate(base, { pricingAlgorithm: "php-service-size-v2" }), /catalog_snapshot_shape/],
  ];
  // A NOT_OFFERED cell (interior detailing on MOTOR), booked for quote next to a wash.
  const motor = quote(select("MOTOR", "basic-wash"));
  const interior = bySlug(r, "interior-detailing");
  cases.push(["not offered", mutate(fresh(motor, "2027-03-02", 4), {}, (ls) => {
    ls.push({ ...structuredClone(ls[0]), id: randomUUID(), order: 1, serviceId: interior.id, offerId: offerOf("interior-detailing", "MOTOR").id, nameSnapshot: interior.name,
      priceStatus: "FOR_QUOTE", unitPriceCentavos: null, subtotalCentavos: null, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null });
  }), /snapshot offer mismatch/]);
  // An UNCONFIRMED cell other than panel repaint.
  const unconfirmed = quote(select("M", "basic-wash"));
  const headlight = offerOf("headlight-restoration", "M");
  cases.push(["unconfirmed non-panel", mutate(fresh(unconfirmed, "2027-03-02", 2), {}, (ls) => {
    ls.push({ ...structuredClone(ls[0]), id: randomUUID(), order: 1, serviceId: bySlug(r, "headlight-restoration").id, offerId: headlight.id, nameSnapshot: "Headlight Restoration",
      priceStatus: "FOR_QUOTE", unitPriceCentavos: null, subtotalCentavos: null, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null });
  }), /snapshot offer mismatch/]);
  // Eleven lines are never a valid visit.
  const ten = quote(select("S", "basic-wash", "signature-wash", "premium-wash", "glass-acid-rain-removal", "bac-to-zero", "interior-detailing", "exterior-detailing",
    "engine-detailing", "full-detailing", "headlight-restoration"));
  const eleven = mutate(fresh(ten, "2027-03-02", 3), {}, (ls) => {
    const tint = bySlug(r, "regular-tint"), offer = tint.offers.find((o) => o.sizeCode === "S")!;
    ls.push({ ...structuredClone(ls[1]), id: randomUUID(), order: 10, serviceId: tint.id, offerId: offer.id, nameSnapshot: tint.name, type: "BASE",
      priceStatus: "FOR_QUOTE", unitPriceCentavos: null, subtotalCentavos: null, referenceUnitPriceCentavos: offer.unitPriceCentavos, referenceSubtotalCentavos: offer.unitPriceCentavos });
  });
  eleven.booking.receiptEstimatedCentavos = (eleven.booking.receiptEstimatedCentavos as number) + bySlug(r, "regular-tint").offers.find((o) => o.sizeCode === "S")!.unitPriceCentavos!;
  cases.push(["eleven lines", eleven, /1 to 10|lines/]);
  for (const [label, rows, pattern] of cases) await rejects(createV3(rows), pattern, label);
  // Control: the unmodified rows are accepted.
  await createV3(base);
  // A legacy-shaped row cannot borrow day-queue columns.
  await rejects(inTx((tx) => insert(tx, "bookings", { ...legacyRow(), queueCode: "WASH", queuePosition: 9 })), /booking_model_shape/, "legacy with a queue");
  await rejects(inTx((tx) => insert(tx, "bookings", { ...legacyRow(), startTime: null })), /booking_model_shape/, "legacy without a clock time");
});

function legacyRow(): Record<string, unknown> {
  const n = ++seq;
  const size = r0().sizes[1];
  return { id: randomUUID(), referenceCode: `ZEUS-L${String(n).padStart(5, "0")}`, customerName: "Synthetic legacy", customerPhone: "+639000000001", vehicleModel: "Synthetic",
    vehicleCategoryId: size.id, serviceId: bySlug(r0(), "basic-wash").id, bookingDate: "2027-04-01", startTime: "08:00", endTime: "08:30",
    startsAt: "2027-04-01T00:00:00Z", endsAt: "2027-04-01T00:30:00Z", durationMinutes: 30, priceSnapshot: 180, serviceNameSnapshot: "Legacy wash",
    vehicleCategoryNameSnapshot: size.name, idempotencyKey: randomUUID(), requestHash: "synthetic-legacy-" + n, updatedAt: new Date().toISOString() };
}

test("legacy and catalog-v2 rows keep every P1-01 rule; legacy rows take no lines, bays or queue", { skip }, async () => {
  const legacy = legacyRow();
  await inTx((tx) => insert(tx, "bookings", legacy));
  const row = await one<Record<string, unknown>>(db, `SELECT "snapshotVersion", revision, "queueCode", "terminalAt", "createdTxId" FROM bookings WHERE id=${lit(legacy.id)}`);
  assert.deepEqual([row.snapshotVersion, row.revision, row.queueCode, row.terminalAt], ["LEGACY_V1", 1, null, null]);
  // LEGACY_V1 cannot acquire inferred lines (G5).
  const q = quote(select("S", "basic-wash"));
  const line = { ...v3Rows(q, "2027-04-01", 1).lines[0], bookingId: legacy.id, lineVersion: "CATALOG_V2", priceStatus: null, referenceUnitPriceCentavos: null,
    referenceSubtotalCentavos: null, addedMinutes: 30 };
  await rejects(inTx((tx) => insert(tx, "booking_line_items", line)), /Legacy snapshot cannot acquire inferred lines|line version/, "legacy line");
  // Legacy snapshot fields stay immutable.
  await rejects(db.$executeRawUnsafe(`UPDATE bookings SET "priceSnapshot"=1 WHERE id=${lit(legacy.id)}`), /immutable/, "legacy reprice");
  // A catalog-v2 booking with its exact line still commits, and its line stays append-only (G1, G4, G6, G7).
  const service = bySlug(r0(), "basic-wash"), offer = service.offers.find((o) => o.sizeCode === "MOTOR")!;
  const v2: Record<string, unknown> = { ...legacyRow(), vehicleCategoryId: offer.vehicleCategoryId, serviceId: service.id, priceSnapshot: 100, snapshotVersion: "CATALOG_V2", catalogReleaseId: releaseA,
    vehicleSizeCodeSnapshot: "MOTOR", catalogFingerprint: "a".repeat(64), pricingAlgorithm: "php-service-size-v2" };
  const v2Line = { id: randomUUID(), bookingId: v2.id, order: 0, releaseId: releaseA, serviceId: service.id, vehicleCategoryId: offer.vehicleCategoryId, offerId: offer.id, type: "BASE",
    nameSnapshot: service.name, unit: "VEHICLE", quantity: 1, unitPriceCentavos: 10000, subtotalCentavos: 10000, addedMinutes: 30 };
  await rejects(inTx(async (tx) => { await insert(tx, "bookings", v2); await insert(tx, "booking_line_items", { ...v2Line, unitPriceCentavos: 9000, subtotalCentavos: 9000 }); }),
    /Incomplete catalog snapshot totals|snapshot offer mismatch/, "v2 repriced");
  await inTx(async (tx) => { await insert(tx, "bookings", v2); await insert(tx, "booking_line_items", v2Line); });
  await rejects(db.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='DONE' WHERE id=${lit(v2Line.id)}`), /append-only/, "v2 line update");
  await rejects(db.$executeRawUnsafe(`DELETE FROM booking_line_items WHERE id=${lit(v2Line.id)}`), /append-only/, "v2 line delete");
  // No bay for a legacy booking.
  const bay = await newBay("Legacy Bay Check");
  await rejects(inTx((tx) => insert(tx, "booking_bay_assignments", { bookingId: legacy.id, date: "2027-04-01", bayId: bay, assignedAt: new Date().toISOString(), assignedByStaffId: detailerId })),
    /day-queue/, "legacy bay");
});

async function newBay(name: string, active = true): Promise<string> {
  const id = randomUUID();
  await insert(db, "bays", { id, name, nameKey: name.trim().toLowerCase(), sortOrder: ++seq, isActive: active, updatedAt: new Date().toISOString() });
  return id;
}

test("A4 line edits: staff add, status, price and soft removal need the revision and their audit row; snapshots never change", { skip }, async () => {
  const q = quote(select("M", "signature-wash", "interior-detailing"));
  const id = await createV3(fresh(q, "2027-03-03", 1));
  const r = r0();
  // A create-time line cannot be inserted after the booking's own transaction.
  const late = { ...v3Rows(quote(select("M", "basic-wash")), "2027-03-03", 1).lines[0], bookingId: id, order: 2 };
  await rejects(inTx((tx) => insert(tx, "booking_line_items", late)), /created with its booking/, "late create line");
  // Staff add from the head release, with the revision and the LINE_ADDED audit row.
  const wash = bySlug(r, "basic-wash"), washOffer = wash.offers.find((o) => o.sizeCode === "M")!;
  const added = { id: randomUUID(), bookingId: id, order: 2, releaseId: releaseA, serviceId: wash.id, vehicleCategoryId: washOffer.vehicleCategoryId, offerId: washOffer.id,
    type: "BASE", nameSnapshot: wash.name, unit: "VEHICLE", quantity: 1, unitPriceCentavos: washOffer.unitPriceCentavos, subtotalCentavos: washOffer.unitPriceCentavos,
    lineVersion: "QUEUE_V3", priceStatus: "PRICED", addedByStaffId: adminId };
  await rejects(staffEdit(id, (tx) => insert(tx, "booking_line_items", added)), /audit/, "add without audit");
  await rejects(staffEdit(id, async (tx, rev) => { await insert(tx, "booking_line_items", added); await audit(tx, { action: "LINE_ADDED", bookingId: id, lineId: added.id, fromRevision: rev - 1, toRevision: rev }); }),
    /audit/, "add with a stale revision");
  await staffEdit(id, async (tx, rev) => { await insert(tx, "booking_line_items", added); await audit(tx, { action: "LINE_ADDED", bookingId: id, lineId: added.id, fromRevision: rev, toRevision: rev + 1 }); });
  // Staff lines come from the head release only, and never carry edits at insert.
  const draftWash = bySlug(releaseFromManifest(draftManifest, draftRelease), "basic-wash").offers.find((o) => o.sizeCode === "M")!;
  await rejects(staffEdit(id, (tx) => insert(tx, "booking_line_items", { ...added, id: randomUUID(), order: 3, releaseId: draftRelease, offerId: draftWash.id })), /head release/, "non-head release");
  await rejects(staffEdit(id, (tx) => insert(tx, "booking_line_items", { ...added, id: randomUUID(), order: 3, serviceId: bySlug(r, "premium-wash").id,
    offerId: bySlug(r, "premium-wash").offers.find((o) => o.sizeCode === "M")!.id, nameSnapshot: "Premium Wash", unitPriceCentavos: 1, subtotalCentavos: 1, workStatus: "DONE" })), /staff-added/, "a staff line inserted with edits");
  // Work status, with and without its audit row.
  const detail = (await lineOf(id, 1)).id as string;
  await rejects(staffEdit(id, (tx) => tx.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='IN_PROGRESS', "workStatusChangedAt"=now() WHERE id=${lit(detail)}`)), /audit/, "status without audit");
  await staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='IN_PROGRESS', "workStatusChangedAt"=now() WHERE id=${lit(detail)}`);
    await audit(tx, { action: "LINE_STATUS_CHANGED", bookingId: id, lineId: detail, fromLineStatus: "WAITING", toLineStatus: "IN_PROGRESS", fromRevision: rev, toRevision: rev + 1 });
  });
  // ADMIN price for the for-quote line: the audit must carry the previous and new value and a reason.
  const setPrice = (price: number, previous: number | null, reason: string | null) => staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "staffPriceCentavos"=${price}, "staffPriceSetAt"=now(), "staffPriceSetByStaffId"=${lit(adminId)} WHERE id=${lit(detail)}`);
    await audit(tx, { action: "PRICE_SET", bookingId: id, lineId: detail, previousPriceCentavos: previous, newPriceCentavos: price, reason, fromRevision: rev, toRevision: rev + 1 });
  });
  await rejects(setPrice(380_000, null, null), /booking_audit_shape/, "price without a reason");
  await rejects(staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "staffPriceCentavos"=380000, "staffPriceSetAt"=now(), "staffPriceSetByStaffId"=${lit(adminId)} WHERE id=${lit(detail)}`);
    await audit(tx, { action: "PRICE_SET", bookingId: id, lineId: detail, newPriceCentavos: 1, reason: "Wrong new value", fromRevision: rev, toRevision: rev + 1 });
  }), /audit/, "price audit with the wrong new value");
  // Pricing stays ADMIN (owner or MANAGER) even at the database (ADR-005 §15).
  await rejects(staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "staffPriceCentavos"=380000, "staffPriceSetAt"=now(), "staffPriceSetByStaffId"=${lit(detailerId)} WHERE id=${lit(detail)}`);
    await audit(tx, { action: "PRICE_SET", actorStaffId: detailerId, bookingId: id, lineId: detail, newPriceCentavos: 380000, reason: "Detailer", fromRevision: rev, toRevision: rev + 1 });
  }), /ADMIN/, "detailer sets a price");
  await setPrice(380_000, null, "Inspected at the shop");
  await rejects(setPrice(390_000, null, "Wrong previous"), /audit/, "price audit with the wrong previous value");
  await setPrice(390_000, 380_000, "Extra stains");
  // Snapshot columns, clearing a price, DELETE and TRUNCATE are refused.
  for (const [label, sql] of [["reprice snapshot", `"referenceUnitPriceCentavos"=1, "referenceSubtotalCentavos"=1`], ["rename", `"nameSnapshot"='tamper'`], ["release", `"order"=9`],
    ["clear staff price", `"staffPriceCentavos"=NULL, "staffPriceSetAt"=NULL, "staffPriceSetByStaffId"=NULL`]] as const) {
    await rejects(staffEdit(id, (tx) => tx.$executeRawUnsafe(`UPDATE booking_line_items SET ${sql} WHERE id=${lit(detail)}`)), /immutable|catalog_line_bounds/, label);
  }
  await rejects(db.$executeRawUnsafe(`DELETE FROM booking_line_items WHERE id=${lit(detail)}`), /append-only/, "delete");
  await rejects(db.$executeRawUnsafe(`TRUNCATE booking_line_items CASCADE`), /append-only/, "truncate");
  // Soft removal, then un-removal is refused; removing the last base is refused.
  const remove = (lineId: string) => staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "removedAt"=now(), "removedByStaffId"=${lit(adminId)} WHERE id=${lit(lineId)}`);
    await audit(tx, { action: "LINE_REMOVED", bookingId: id, lineId, fromRevision: rev, toRevision: rev + 1 });
  });
  await remove(added.id);
  await rejects(staffEdit(id, (tx) => tx.$executeRawUnsafe(`UPDATE booking_line_items SET "removedAt"=NULL, "removedByStaffId"=NULL WHERE id=${lit(added.id)}`)), /immutable/, "un-remove");
  await remove(detail);
  const primary = (await lineOf(id, 0)).id as string;
  await rejects(remove(primary), /base service/, "remove the last base");
  // The receipt, release and primary never change, whatever the lines did.
  const receipt = await one<Record<string, unknown>>(db, `SELECT "receiptTotalCentavos", "receiptEstimatedCentavos", "serviceId", "catalogReleaseId" FROM bookings WHERE id=${lit(id)}`);
  assert.deepEqual([receipt.receiptTotalCentavos, receipt.receiptEstimatedCentavos, receipt.serviceId, receipt.catalogReleaseId],
    [q.totalPriceCentavos, q.estimatedTotalCentavos, q.primaryServiceId, releaseA]);
  await rejects(db.$executeRawUnsafe(`UPDATE bookings SET "receiptTotalCentavos"=0 WHERE id=${lit(id)}`), /immutable/, "receipt");
  await rejects(db.$executeRawUnsafe(`UPDATE bookings SET revision=1 WHERE id=${lit(id)}`), /revision/, "revision decrease");
  await rejects(db.$executeRawUnsafe(`UPDATE bookings SET status='CONFIRMED' WHERE id=${lit(id)}`), /revision/, "status change without a revision");
  // A cancelled booking takes no line change.
  await inTx((tx) => tx.$executeRawUnsafe(`UPDATE bookings SET status='CANCELLED', "cancellationKind"='SHOP_DECLINED', "terminalAt"=now(), revision=revision+1 WHERE id=${lit(id)}`));
  await rejects(staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='DONE', "workStatusChangedAt"=now() WHERE id=${lit(primary)}`);
    await audit(tx, { action: "LINE_STATUS_CHANGED", bookingId: id, lineId: primary, fromLineStatus: "WAITING", toLineStatus: "DONE", fromRevision: rev, toRevision: rev + 1 });
  }), /cancelled/, "edit after cancel");
});

test("caps (Q3): no configured cap refuses, the last unit is taken once, cancel frees it, and caps cannot drop below future bookings", { skip }, async () => {
  const q = quote(select("L", "regular-tint"));
  const day = "2027-05-10";
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=NULL, revision=revision+1, "updatedAt"=now() WHERE code='TINT_PPF'`);
  await rejects(createV3(fresh(q, day, 1)), /cap/, "no configured cap");
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=1, revision=revision+1, "updatedAt"=now() WHERE code='TINT_PPF'`);
  // Two customers race for the last unit: both take the shop lock, exactly one commits.
  const results = await Promise.allSettled([createV3(fresh(q, day, 1)), createV3(fresh(q, day, 2))]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const winner = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<string>).value;
  assert.match(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason), /cap/);
  // Lowering the cap below a committed future booking is refused (default and override).
  await rejects(db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=0, revision=revision+1, "updatedAt"=now() WHERE code='TINT_PPF'`), /cap/, "default below committed");
  await rejects(db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=NULL, revision=revision+1, "updatedAt"=now() WHERE code='TINT_PPF'`), /cap/, "unset below committed");
  await rejects(insert(db, "queue_cap_overrides", { id: randomUUID(), queueCode: "TINT_PPF", date: day, dailyCap: 0, updatedAt: new Date().toISOString(), updatedByStaffId: adminId }), /cap/, "override below committed");
  // An override raises the day; cancelling frees a unit; un-cancelling into a full day is refused.
  const override = randomUUID();
  await insert(db, "queue_cap_overrides", { id: override, queueCode: "TINT_PPF", date: day, dailyCap: 2, updatedAt: new Date().toISOString(), updatedByStaffId: adminId });
  const second = await createV3(fresh(q, day, 3));
  await rejects(createV3(fresh(q, day, 4)), /cap/, "override full");
  await inTx((tx) => tx.$executeRawUnsafe(`UPDATE bookings SET status='CANCELLED', "cancellationKind"='CUSTOMER', "terminalAt"=now(), revision=revision+1 WHERE id=${lit(winner)}`));
  const third = await createV3(fresh(q, day, 5));
  await rejects(inTx((tx) => tx.$executeRawUnsafe(`UPDATE bookings SET status='PENDING', "cancellationKind"=NULL, "terminalAt"=NULL, revision=revision+1 WHERE id=${lit(winner)}`)), /cap/, "un-cancel into a full day");
  await rejects(db.$executeRawUnsafe(`DELETE FROM queue_cap_overrides WHERE id=${lit(override)}`), /cap/, "dropping the override below committed");
  // COMPLETED keeps its unit (it still occupies the day).
  await inTx(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='DONE', "workStatusChangedAt"=now() WHERE "bookingId"=${lit(second)}`);
    await tx.$executeRawUnsafe(`UPDATE bookings SET revision=revision+1 WHERE id=${lit(second)}`);
    const line = (await lineOf(second, 0)).id;
    const { revision } = await one<{ revision: number }>(tx, `SELECT revision FROM bookings WHERE id=${lit(second)}`);
    await audit(tx, { action: "LINE_STATUS_CHANGED", bookingId: second, lineId: line, fromLineStatus: "WAITING", toLineStatus: "DONE", fromRevision: revision - 1, toRevision: revision });
    await tx.$executeRawUnsafe(`UPDATE bookings SET status='COMPLETED', "terminalAt"=now(), revision=revision+1 WHERE id=${lit(second)}`);
  });
  await rejects(createV3(fresh(q, day, 6)), /cap/, "completed still occupies");
  assert.ok(third);
  // A past day over the new cap does not block lowering it: only today and later are checked.
  const past = "2026-01-05";
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=5, revision=revision+1, "updatedAt"=now() WHERE code='REPAINT'`);
  const panel = quote(select("M", ["panel-repaint", 2]));
  for (const pos of [1, 2]) await createV3(fresh(panel, past, pos));
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=1, revision=revision+1, "updatedAt"=now() WHERE code='REPAINT'`);
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "dailyCap"=50, revision=revision+1, "updatedAt"=now() WHERE code IN ('REPAINT','TINT_PPF')`);
});

test("completion (Q3) needs every active line done; positions are unique per day and queue but can be swapped in one transaction", { skip }, async () => {
  const q = quote(select("S", "basic-wash", "bac-to-zero"));
  const day = "2027-05-11";
  const a = await createV3(fresh(q, day, 1));
  const b = await createV3(fresh(q, day, 2));
  await rejects(inTx((tx) => tx.$executeRawUnsafe(`UPDATE bookings SET status='COMPLETED', "terminalAt"=now(), revision=revision+1 WHERE id=${lit(a)}`)), /every service/, "complete with waiting lines");
  await rejects(createV3(fresh(q, day, 2)), /"queuePosition"\)=\(2027-05-11, WASH, 2\) already exists/, "duplicate position");
  await inTx(async (tx) => {
    await tx.$executeRawUnsafe(`SET CONSTRAINTS "bookings_bookingDate_queueCode_queuePosition_key" DEFERRED`);
    await tx.$executeRawUnsafe(`UPDATE bookings SET "queuePosition"=2, revision=revision+1 WHERE id=${lit(a)}`);
    await tx.$executeRawUnsafe(`UPDATE bookings SET "queuePosition"=1, revision=revision+1 WHERE id=${lit(b)}`);
  });
  await inTx((tx) => tx.$executeRawUnsafe(`UPDATE bookings SET "queuePosition"=CASE id WHEN ${lit(a)} THEN 1 ELSE 2 END, revision=revision+1 WHERE id IN (${lit(a)}, ${lit(b)})`));
  const positions = await db.$queryRawUnsafe<{ id: string; queuePosition: number }[]>(`SELECT id, "queuePosition" FROM bookings WHERE id IN (${lit(a)}, ${lit(b)}) ORDER BY "queuePosition"`);
  assert.deepEqual(positions.map((p) => p.id), [a, b]);
});

test("bays: STAFF-side assignments for day bookings only, on or after the booked day, to an active bay; names are unique ignoring case", { skip }, async () => {
  const q = quote(select("S", "basic-wash"));
  const id = await createV3(fresh(q, "2027-05-12", 1));
  const bay = await newBay("Bay 1");
  const inactive = await newBay("Bay Closed", false);
  const assign = (bayId: string, date: string) => inTx((tx) => insert(tx, "booking_bay_assignments", { bookingId: id, date, bayId, assignedAt: new Date().toISOString(), assignedByStaffId: detailerId }));
  await rejects(assign(bay, "2027-05-11"), /booked day/, "before the booked day");
  await rejects(assign(inactive, "2027-05-12"), /active bay/, "inactive bay");
  await assign(bay, "2027-05-12");
  await assign(bay, "2027-05-13"); // a later day of a multi-day job
  await rejects(newBay("bay 1"), /"nameKey"\)=\(bay 1\) already exists/, "case-insensitive duplicate");
  await rejects(insert(db, "bays", { id: randomUUID(), name: "Bay 2", nameKey: "BAY 2", sortOrder: 99, updatedAt: new Date().toISOString() }), /bay_name_key/, "nameKey not canonical");
});

test("publication: every service needs an active queue; the mapping is release data that a new release changes", { skip }, async () => {
  const noQueue = tooling.rollbackManifest(manifest, "p1-02-model-no-queue");
  for (const s of noQueue.services) delete s.queueCode;
  await rejects(publish(db, noQueue, tooling.stableId), /active queue/, "release without queues");
  const remapped = tooling.rollbackManifest(manifest, "p1-02-model-b");
  remapped.services.find((s: { slug: string }) => s.slug === "headlight-restoration").queueCode = "REPAINT";
  const draftB = await insertDraft(db, remapped, tooling.stableId);
  const publishB = () => db.$queryRawUnsafe(`SELECT publish_catalog(${lit(draftB.releaseId)}, ${lit(draftB.hash)}, 'P1-02 synthetic review', 'P1-02 test publication')`);
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "isActive"=false WHERE code='REPAINT'`);
  await rejects(publishB(), /active queue/, "inactive queue");
  await db.$executeRawUnsafe(`UPDATE booking_queues SET "isActive"=true WHERE code='REPAINT'`);
  await publishB();
  releaseB = draftB.releaseId;
  const loaded = await db.$transaction((tx) => import("./catalog-read").then((m) => m.loadCurrentRelease(tx)));
  assert.equal(loaded?.releaseId, releaseB);
  assert.equal(bySlug(loaded!, "headlight-restoration").queueCode, "REPAINT");
  assert.equal(quote(select("S", "headlight-restoration"), loaded!).queueId, "REPAINT");
  // Published mapping rows stay immutable, and queue identities cannot be renamed or removed.
  await rejects(db.$executeRawUnsafe(`UPDATE catalog_service_versions SET "queueCode"='WASH' WHERE "releaseId"=${lit(releaseB)}`), /immutable/, "remap in place");
  await rejects(db.$executeRawUnsafe(`UPDATE booking_queues SET code='WASHES' WHERE code='WASH'`), /queue identity/, "rename queue");
  await rejects(db.$executeRawUnsafe(`DELETE FROM booking_queues WHERE code='WASH'`), /queue identity/, "delete queue");
  // Restore the reviewed mapping as the head for later tests.
  headManifest = tooling.rollbackManifest(manifest, "p1-02-model-c");
  releaseA = await publish(db, headManifest, tooling.stableId);
});

test("the audit trail (Q1) is append-only, shape-checked per action, and stores only an HMAC digest for history lookups", { skip }, async () => {
  const lookup = { action: "HISTORY_LOOKUP", phoneDigest: "ab".repeat(32), resultCount: 2 };
  const eventId = randomUUID();
  await insert(db, "booking_audit_events", { id: eventId, actorStaffId: adminId, ...lookup });
  for (const [label, row] of [
    ["plain phone", { ...lookup, phoneDigest: "+639170000001" }], ["short digest", { ...lookup, phoneDigest: "ab".repeat(16) }],
    ["lookup tied to a booking", { ...lookup, bookingId: (await one<{ id: string }>(db, `SELECT id FROM bookings LIMIT 1`)).id }],
    ["status without revisions", { action: "STATUS_CHANGED", bookingId: (await one<{ id: string }>(db, `SELECT id FROM bookings LIMIT 1`)).id, fromStatus: "PENDING", toStatus: "CONFIRMED" }],
    ["revision not +1", { action: "CUSTOMER_NOTIFIED", bookingId: (await one<{ id: string }>(db, `SELECT id FROM bookings LIMIT 1`)).id, fromRevision: 1, toRevision: 3 }],
    ["cap change without a queue", { action: "CAP_CHANGED", newCap: 3 }], ["long reason", { action: "BAY_LIST_CHANGED", bayId: await newBay("Audit Bay"), reason: "x".repeat(501) }],
  ] as [string, Record<string, unknown>][]) await rejects(audit(db, row), /booking_audit_shape|violates/, label);
  await rejects(db.$executeRawUnsafe(`UPDATE booking_audit_events SET "resultCount"=0 WHERE id=${lit(eventId)}`), /append-only/, "update");
  await rejects(db.$executeRawUnsafe(`DELETE FROM booking_audit_events WHERE id=${lit(eventId)}`), /append-only/, "delete");
  await rejects(db.$executeRawUnsafe(`TRUNCATE booking_audit_events CASCADE`), /append-only/, "truncate");
});

// Codex review 922c175 F1/F2 regressions, run as the runtime role. Fixture-only grants: production
// zeus_app reads every table and updates bookings through the owner's default privileges (tables
// owned by P1-03/P1-06); the P1-02 grants under test are not changed.
async function runtimeFixtureGrants() {
  await db.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO zeus_app`);
  await db.$executeRawUnsafe(`GRANT UPDATE (revision) ON bookings TO zeus_app`);
}
// One transaction: the shop lock as the owner, then everything else as zeus_app.
const asApp = <T,>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => inTx(async (tx) => { await tx.$executeRawUnsafe("SET LOCAL ROLE zeus_app"); return fn(tx); });
const bump = (tx: Tx, bookingId: string, from: number) => tx.$executeRawUnsafe(`UPDATE bookings SET revision=${from + 1} WHERE id=${lit(bookingId)} AND revision=${from}`);
async function lineState(bookingId: string) {
  const line = await one<Record<string, unknown>>(db, `SELECT "staffPriceCentavos", "staffPriceSetAt", "staffPriceSetByStaffId", "workStatus", "workStatusChangedAt"
    FROM booking_line_items WHERE "bookingId"=${lit(bookingId)} AND "order"=0`);
  const { revision } = await one<{ revision: number }>(db, `SELECT revision FROM bookings WHERE id=${lit(bookingId)}`);
  const { n } = await one<{ n: bigint }>(db, `SELECT count(*) AS n FROM booking_audit_events WHERE "bookingId"=${lit(bookingId)}`);
  return { line, revision, audits: Number(n) };
}

test("F1: as zeus_app, a price actor or time, or a status time, never changes without its value (rolled back, nothing changed)", { skip }, async (t) => {
  if (!runtimeRole) { t.skip("zeus_app role could not be created on this test cluster"); return; }
  await runtimeFixtureGrants();
  const id = await createV3(fresh(quote(select("S", "basic-wash")), "2027-06-01", 1));
  const line = (await lineOf(id, 0)).id as string;
  // Correct ADMIN price set, then a correct status change: each with its revision and audit row.
  await staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "staffPriceCentavos"=20000, "staffPriceSetAt"=now(), "staffPriceSetByStaffId"=${lit(adminId)} WHERE id=${lit(line)}`);
    await audit(tx, { action: "PRICE_SET", bookingId: id, lineId: line, newPriceCentavos: 20000, reason: "Confirmed", fromRevision: rev, toRevision: rev + 1 });
  });
  await staffEdit(id, async (tx, rev) => {
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='IN_PROGRESS', "workStatusChangedAt"=now() WHERE id=${lit(line)}`);
    await audit(tx, { action: "LINE_STATUS_CHANGED", bookingId: id, lineId: line, fromLineStatus: "WAITING", toLineStatus: "IN_PROGRESS", fromRevision: rev, toRevision: rev + 1 });
  });
  const before = await lineState(id);
  assert.deepEqual([before.line.staffPriceCentavos, before.line.staffPriceSetByStaffId, before.revision, before.audits], [20000, adminId, 3, 2]);
  for (const [label, set] of [["price actor to a DETAILER", `"staffPriceSetByStaffId"=${lit(detailerId)}`], ["backdated price time", `"staffPriceSetAt"='2000-01-01T00:00:00Z'`],
    ["backdated status time", `"workStatusChangedAt"='2000-01-01T00:00:00Z'`]] as const) {
    await rejects(asApp((tx) => tx.$executeRawUnsafe(`UPDATE booking_line_items SET ${set} WHERE id=${lit(line)}`)), /changes only with/, label);
    // A revision bump does not make a metadata-only change acceptable either.
    await rejects(asApp(async (tx) => { await bump(tx, id, 3); await tx.$executeRawUnsafe(`UPDATE booking_line_items SET ${set} WHERE id=${lit(line)}`); }), /changes only with/, label + " with a revision");
    assert.deepEqual(await lineState(id), before, label + ": rolled back, nothing changed");
  }
  // A real price change, as zeus_app with its revision and audit, keeps the database's time, not the caller's.
  await asApp(async (tx) => {
    await bump(tx, id, 3);
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "staffPriceCentavos"=21000, "staffPriceSetAt"='2000-01-01T00:00:00Z', "staffPriceSetByStaffId"=${lit(adminId)} WHERE id=${lit(line)}`);
    await audit(tx, { action: "PRICE_SET", bookingId: id, lineId: line, previousPriceCentavos: 20000, newPriceCentavos: 21000, reason: "Corrected", fromRevision: 3, toRevision: 4 });
  });
  const repriced = await lineState(id);
  assert.deepEqual([repriced.line.staffPriceCentavos, repriced.revision, repriced.audits], [21000, 4, 3]);
  assert.ok((repriced.line.staffPriceSetAt as Date).getTime() > Date.parse("2026-01-01"), "the caller's backdated time is not kept");
  // The price actor is still checked when the price changes.
  await rejects(asApp(async (tx) => {
    await bump(tx, id, 4);
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "staffPriceCentavos"=22000, "staffPriceSetByStaffId"=${lit(detailerId)} WHERE id=${lit(line)}`);
  }), /Only ADMIN/, "a DETAILER price");
});

test("F2: an audit row from another transaction never satisfies an edit, whatever txId it claims; the default txId binds the atomic edit", { skip }, async (t) => {
  if (!runtimeRole) { t.skip("zeus_app role could not be created on this test cluster"); return; }
  await runtimeFixtureGrants();
  const id = await createV3(fresh(quote(select("S", "basic-wash")), "2027-06-02", 1));
  const line = (await lineOf(id, 0)).id as string;
  const statusAudit = { action: "LINE_STATUS_CHANGED", bookingId: id, lineId: line, fromLineStatus: "WAITING", toLineStatus: "IN_PROGRESS", fromRevision: 1, toRevision: 2 };
  // Transaction T learns its own txid before taking the shop lock; connection U writes first.
  let tTxid = 0;
  let ready!: () => void; const reached = new Promise<void>((r) => { ready = r; });
  let release!: () => void; const uDone = new Promise<void>((r) => { release = r; });
  const editT = db.$transaction(async (tx) => {
    tTxid = Number((await one<{ x: bigint }>(tx, "SELECT txid_current() AS x")).x);
    ready();
    await uDone;
    await lock(tx);
    await tx.$executeRawUnsafe("SET LOCAL ROLE zeus_app");
    await bump(tx, id, 1);
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='IN_PROGRESS', "workStatusChangedAt"=now() WHERE id=${lit(line)}`);
    // No audit row of its own.
  }, { timeout: 20_000 });
  await reached;
  // U pre-writes the row T needs and claims T's txId: refused at insert.
  await rejects(asApp((tx) => audit(tx, { ...statusAudit, txId: tTxid })), /inserting transaction/, "explicit foreign txId");
  // U pre-writes it with its own default txId: stored, but it is U's row.
  await asApp((tx) => audit(tx, statusAudit));
  release();
  await rejects(editT, /audit row/, "T reuses U's committed audit row");
  const refused = await lineState(id);
  assert.deepEqual([refused.line.workStatus, refused.revision, refused.audits], ["WAITING", 1, 1], "T rolled back");
  // Positive: one atomic edit as zeus_app with the default txId commits, and its audit row carries that transaction.
  const txid = await asApp(async (tx) => {
    const own = (await one<{ x: bigint }>(tx, "SELECT txid_current() AS x")).x;
    await bump(tx, id, 1);
    await tx.$executeRawUnsafe(`UPDATE booking_line_items SET "workStatus"='IN_PROGRESS', "workStatusChangedAt"=now() WHERE id=${lit(line)}`);
    await audit(tx, statusAudit);
    return own;
  });
  const edited = await lineState(id);
  assert.deepEqual([edited.line.workStatus, edited.revision, edited.audits], ["IN_PROGRESS", 2, 2]);
  const stamped = await db.$queryRawUnsafe<{ txId: bigint }[]>(`SELECT "txId" FROM booking_audit_events WHERE "bookingId"=${lit(id)} ORDER BY "createdAt", "txId"`);
  assert.equal(stamped.filter((e) => e.txId === txid).length, 1, "the edit's audit row carries its own transaction");
  // Related: a booking's createdTxId is the inserting transaction too, so create lines cannot be borrowed later.
  const rows = fresh(quote(select("S", "basic-wash")), "2027-06-03", 1);
  await rejects(createV3({ ...rows, booking: { ...rows.booking, createdTxId: Number(txid) } }), /inserting transaction/, "a borrowed createdTxId");
});

test("runtime role zeus_app: audit is SELECT/INSERT only, line updates are column-limited, catalog stays read-only", { skip }, async (t) => {
  if (!runtimeRole) { t.skip("zeus_app role could not be created on this test cluster"); return; }
  const priv = async (table: string, p: string) => (await one<{ ok: boolean }>(db, `SELECT has_table_privilege('zeus_app', ${lit("public." + table)}, ${lit(p)}) AS ok`)).ok;
  const col = async (table: string, column: string, p: string) => (await one<{ ok: boolean }>(db, `SELECT has_column_privilege('zeus_app', ${lit("public." + table)}, ${lit(column)}, ${lit(p)}) AS ok`)).ok;
  const expect: [string, string, boolean][] = [
    ["booking_audit_events", "SELECT", true], ["booking_audit_events", "INSERT", true], ["booking_audit_events", "UPDATE", false], ["booking_audit_events", "DELETE", false],
    ["booking_audit_events", "TRUNCATE", false], ["booking_line_items", "INSERT", true], ["booking_line_items", "DELETE", false], ["booking_line_items", "TRUNCATE", false],
    ["booking_queues", "INSERT", false], ["booking_queues", "DELETE", false], ["queue_cap_overrides", "INSERT", true], ["bays", "DELETE", false],
    ["booking_bay_assignments", "DELETE", true], ["catalog_service_versions", "UPDATE", false], ["catalog_service_versions", "SELECT", true],
  ];
  for (const [table, p, ok] of expect) assert.equal(await priv(table, p), ok, `${table} ${p}`);
  assert.equal(await col("booking_line_items", "workStatus", "UPDATE"), true);
  assert.equal(await col("booking_line_items", "staffPriceCentavos", "UPDATE"), true);
  for (const frozen of ["unitPriceCentavos", "subtotalCentavos", "referenceSubtotalCentavos", "nameSnapshot", "releaseId", "priceStatus"]) {
    assert.equal(await col("booking_line_items", frozen, "UPDATE"), false, frozen);
  }
  assert.equal(await col("booking_queues", "dailyCap", "UPDATE"), true);
  assert.equal(await col("booking_queues", "code", "UPDATE"), false);
});

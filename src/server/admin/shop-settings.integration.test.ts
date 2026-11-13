// P1-42 Settings: the real function as the runtime role (zeus_app) against real PostgreSQL with the real migrations. Own sibling database
// (<T007 name>_settings); synthetic data only; nothing is dropped. Without T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { AdminServiceError } from "./errors";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const settingsUrl = url ? siblingDatabaseUrl(url, "settings") : "postgresql://unused@localhost/zeus_t007_unused_settings";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: settingsUrl } } }); // owner
let app: PrismaClient; // zeus_app
let s: typeof import("./index");
let ADMIN: StaffActor;
const opts = () => ({ db: app });
const body = (revision: number, extra: Record<string, unknown> = {}) => ({ expectedRevision: revision, maintenance: false, maintenanceMessage: null, bookingPaused: false, ...extra });
const audits = () => db.shopSettingsAuditEvent.findMany({ orderBy: { createdAt: "asc" } });
const count = async () => db.shopSettingsAuditEvent.count();
async function refused(p: Promise<unknown>, code: string, label: string) {
  await assert.rejects(p, (e: unknown) => { assert.equal((e as AdminServiceError).code, code, `${label}: ${String((e as Error).message)}`); return true; }, label);
}

before(async () => {
  if (skip) return;
  await createAndMigrate(root, settingsUrl);
  provisionRuntimeRole(settingsUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(settingsUrl) } } });
  s = await import("./index");
  ADMIN = { staffId: await mapPublisher(db, "p142-admin@example.test"), role: "ADMIN", sessionId: randomUUID() };
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

test("S1 the row starts live and open, and reads as zeus_app", { skip }, async () => {
  const v = await s.getShopSettings(ADMIN, opts());
  assert.deepEqual([v.revision, v.maintenance, v.maintenanceMessage, v.bookingPaused], [1, false, null, false]);
});

test("S2 turning maintenance on writes the row and one audit row, with who and the words before and after", { skip }, async () => {
  const before = await count();
  const v = await s.setShopSettings(ADMIN, body((await s.getShopSettings(ADMIN, opts())).revision, { maintenance: true }), opts());
  assert.equal(v.maintenance, true);
  const rows = await audits();
  assert.equal(rows.length, before + 1);
  const row = rows.at(-1)!;
  assert.deepEqual([row.action, row.actorStaffId, row.setting, row.previousValue, row.newValue], ["SETTING_CHANGED", ADMIN.staffId, "maintenance", "live", "maintenance"]);
});

test("S3 a change to all three writes three audit rows in one transaction", { skip }, async () => {
  const before = await count();
  const v0 = await s.getShopSettings(ADMIN, opts());
  await s.setShopSettings(ADMIN, body(v0.revision, { maintenance: !v0.maintenance, maintenanceMessage: "Back at noon.", bookingPaused: !v0.bookingPaused }), opts());
  const rows = (await audits()).slice(before);
  assert.deepEqual(rows.map((r) => r.setting).sort(), ["booking_paused", "maintenance", "maintenance_message"]);
  assert.equal(new Set(rows.map((r) => r.txId)).size, 1);
  assert.equal(rows.find((r) => r.setting === "maintenance_message")!.newValue, "Back at noon.");
});

test("S4 a retry after a lost response changes nothing and is not refused, even with the old revision", { skip }, async () => {
  const v0 = await s.getShopSettings(ADMIN, opts());
  const same = body(v0.revision, { maintenance: !v0.maintenance, maintenanceMessage: v0.maintenanceMessage, bookingPaused: v0.bookingPaused });
  const first = await s.setShopSettings(ADMIN, same, opts());
  const before = await count();
  const retry = await s.setShopSettings(ADMIN, same, opts());
  assert.equal(retry.revision, first.revision);
  assert.equal(await count(), before);
});

test("S5 a real stale edit is refused and changes nothing", { skip }, async () => {
  const v0 = await s.getShopSettings(ADMIN, opts());
  await refused(s.setShopSettings(ADMIN, body(v0.revision + 5, { maintenance: !v0.maintenance, maintenanceMessage: v0.maintenanceMessage, bookingPaused: v0.bookingPaused }), opts()), "VERSION_CONFLICT", "stale");
  assert.equal((await s.getShopSettings(ADMIN, opts())).revision, v0.revision);
});

test("S6 only an admin: the service refuses staff, and the database function refuses a non-admin actor when called directly", { skip }, async () => {
  const staff: StaffActor = { ...ADMIN, role: "STAFF" };
  await refused(s.getShopSettings(staff, opts()), "FORBIDDEN", "read");
  await refused(s.setShopSettings(staff, body(1), opts()), "FORBIDDEN", "write");
  const detailer = await db.staff.create({ data: { name: "P1-42 Detailer", phone: "", email: "p142-detailer@example.test", role: "DETAILER" } });
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_shop_settings_set('${detailer.id}', 1, true, NULL, false)`), /ZT004|Only an admin/);
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_shop_settings_set('${randomUUID()}', 1, true, NULL, false)`), /ZT004|Only an admin/);
});

test("S7 bad input is refused by the service and by the function", { skip }, async () => {
  const r = (await s.getShopSettings(ADMIN, opts())).revision;
  for (const [label, bad] of [["long", { maintenanceMessage: "x".repeat(201) }], ["two lines", { maintenanceMessage: "a\nb" }], ["not a boolean", { maintenance: "true" }], ["extra", { extra: 1 }]] as const) {
    await refused(s.setShopSettings(ADMIN, body(r, bad), opts()), "VALIDATION_ERROR", label);
  }
  for (const bad of [`'${"x".repeat(201)}'`, `E'a\\nb'`, `' padded '`, `''`]) {
    await assert.rejects(app.$queryRawUnsafe(`SELECT admin_shop_settings_set('${ADMIN.staffId}', ${r}, true, ${bad}, false)`), /ZT006|invalid input/, bad);
  }
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_shop_settings_set('${ADMIN.staffId}', ${r}, NULL, NULL, false)`), /ZT006|invalid input/);
});

test("S8 an empty message means none, and spaces are trimmed", { skip }, async () => {
  const v0 = await s.getShopSettings(ADMIN, opts());
  const v1 = await s.setShopSettings(ADMIN, body(v0.revision, { maintenance: v0.maintenance, bookingPaused: v0.bookingPaused, maintenanceMessage: "  Soon.  " }), opts());
  assert.equal(v1.maintenanceMessage, "Soon.");
  const v2 = await s.setShopSettings(ADMIN, body(v1.revision, { maintenance: v1.maintenance, bookingPaused: v1.bookingPaused, maintenanceMessage: "   " }), opts());
  assert.equal(v2.maintenanceMessage, null);
});

test("S9 zeus_app cannot write the row or read the audit directly; the row cannot multiply; the audit is append-only even for the owner", { skip }, async () => {
  await assert.rejects(app.$executeRawUnsafe(`UPDATE shop_settings SET maintenance = true`), /permission denied/);
  await assert.rejects(app.$executeRawUnsafe(`DELETE FROM shop_settings`), /permission denied/);
  await assert.rejects(app.$queryRawUnsafe(`SELECT * FROM shop_settings_audit_events`), /permission denied/);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO shop_settings (id) VALUES (2)`), /shop_settings_one_row/);
  // P1-71 (CEO D-2): Prisma 6 reports a unique violation as "Code: `23505`. Message: `Key (id)=(1) already exists.`", without
  // PostgreSQL's "duplicate key" sentence, so the 23505 form is accepted too. It is still the primary-key rejection.
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO shop_settings (id) VALUES (1)`), /duplicate key|shop_settings_pkey|23505[\s\S]*Key \(id\)=\(1\) already exists/);
  for (const sql of [`UPDATE shop_settings_audit_events SET "newValue" = 'x'`, `DELETE FROM shop_settings_audit_events`, `TRUNCATE shop_settings_audit_events`]) {
    await assert.rejects(db.$executeRawUnsafe(sql), /append-only/, sql);
  }
});

test("S10 a temporary table named like the real one does not reach the function (pg_temp last)", { skip }, async () => {
  const r = (await s.getShopSettings(ADMIN, opts())).revision;
  await app.$transaction(async (tx) => {
    // P1-71 (CEO D-2): the columns are written out because "LIKE public.shop_settings_audit_events" needs a privilege on the real
    // table, which zeus_app rightly does not have ("permission denied"); the decoy is the same shape.
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE shop_settings_audit_events (id text DEFAULT gen_random_uuid()::text, action text DEFAULT 'SETTING_CHANGED', "actorStaffId" text, setting text, "previousValue" text, "newValue" text, "txId" bigint DEFAULT txid_current(), "createdAt" timestamptz(3) DEFAULT CURRENT_TIMESTAMP) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE shop_settings (id smallint, maintenance boolean, "maintenanceMessage" text, "bookingPaused" boolean, revision integer) ON COMMIT DROP`);
    await tx.$queryRawUnsafe(`SELECT admin_shop_settings_set('${ADMIN.staffId}', ${r}, false, 'real row', false)`);
    assert.equal((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_temp.shop_settings_audit_events`))[0].n, BigInt(0));
    throw new Error("rollback");
  }).catch((e: Error) => assert.equal(e.message, "rollback"));
});

test("S11 the email state is a yes or no and two counts, with no address or secret; counts cover the last 7 days only", { skip }, async () => {
  const keep = { ...process.env };
  process.env.SMTP_APP_PASSWORD = "canary-secret-password";
  process.env.SMTP_USER = "canary-user@example.test";
  try {
    const v = await s.getShopSettings(ADMIN, { db: app, now: () => new Date("2031-01-01T00:00:00Z") });
    assert.deepEqual(v.email.failedLast7Days, 0);
    const text = JSON.stringify(v);
    assert.doesNotMatch(text, /canary|example\.test/);
    assert.equal(typeof v.email.configured, "boolean");
  } finally { process.env = keep; }
});

// P1-10 M1 (ADR-003 S-06, ARCHITECTURE "Audit immutability and database principals"): the
// zeus_app runtime role from prisma/sql/runtime-role.sql, its deny list, the S-06 enforcement
// check, and the service suites rerun with every service call as zeus_app. Synthetic data only,
// sibling databases of the T007 test database; nothing is dropped.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import { checkAuditPrivileges } from "./audit-privilege";
import type { StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import { setAdminEventSink } from "./log";

const parent = process.env.T007_TEST_DATABASE_URL, skip = !parent;
const root = new PrismaClient({ datasources: { db: { url: parent ?? "postgresql://unused@localhost/zeus_t007_unused" } } });
const ownerUrl = parent ? siblingDatabaseUrl(parent, "runtime_role") : "postgresql://unused@localhost/zeus_t007_unused_runtime_role";
let owner: PrismaClient, app: PrismaClient;
const NO_ACCESS = ["_prisma_migrations", "catalog_publishers", "catalog_publication_events", "catalog_hold_segments", "booking_assignments",
  "commission_payouts", "inventory_items", "inventory_transactions", "service_recipes"];

before(async () => {
  if (skip) return;
  await createAndMigrate(root, ownerUrl);
  provisionRuntimeRole(ownerUrl);
  owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(ownerUrl) } } });
});
after(async () => {
  await app?.$disconnect();
  await owner?.$disconnect();
  await root.$disconnect();
});

// Everything zeus_app holds in this database, plus its role attributes and memberships.
async function snapshot() {
  function q<T>(sql: string) { return owner.$queryRawUnsafe<T[]>(sql); }
  return {
    tables: await q<{ t: string; p: string }>(`SELECT table_name AS t, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants WHERE grantee='zeus_app' AND table_schema='public' GROUP BY 1 ORDER BY 1`),
    columns: await q<{ t: string; c: string; p: string }>(`SELECT table_name AS t, column_name AS c, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.column_privileges WHERE grantee='zeus_app' AND table_schema='public' AND (table_name, privilege_type) NOT IN (SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='zeus_app') GROUP BY 1, 2 ORDER BY 1, 2`),
    defaults: await q<{ acl: string }>(`SELECT defaclacl::text AS acl FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' ORDER BY 1`),
    role: await q<Record<string, boolean>>(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname='zeus_app'`),
    memberOf: await q<{ r: string }>(`SELECT g.rolname AS r FROM pg_auth_members a JOIN pg_roles g ON g.oid=a.roleid JOIN pg_roles u ON u.oid=a.member WHERE u.rolname='zeus_app'`),
    schema: await q<Record<string, boolean>>(`SELECT has_schema_privilege('zeus_app','public','USAGE') AS usage, has_schema_privilege('zeus_app','public','CREATE') AS create`),
  };
}

test("runtime-role.sql is idempotent and repairs drift: the same privileges whichever order provisioning ran in", { skip }, async () => {
  const first = await snapshot();
  provisionRuntimeRole(ownerUrl);
  assert.deepEqual(await snapshot(), first, "running it again changes nothing");
  // As if the role was created after migrate deploy (no migration grants), then widened by mistake.
  await owner.$executeRawUnsafe("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM zeus_app");
  await owner.$executeRawUnsafe("GRANT ALL ON booking_audit_events, booking_operations, _prisma_migrations, staff TO zeus_app");
  await owner.$executeRawUnsafe("GRANT CREATE ON SCHEMA public TO zeus_app");
  await owner.$executeRawUnsafe("GRANT pg_read_all_data TO zeus_app");
  await root.$executeRawUnsafe("ALTER ROLE zeus_app CREATEDB");
  provisionRuntimeRole(ownerUrl);
  assert.deepEqual(await snapshot(), first, "the script restores exactly its own list");
});

test("zeus_app has the ADR-003 attributes, owns nothing and has no access outside its list", { skip }, async () => {
  const s = await snapshot();
  assert.deepEqual(s.role, [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true, rolinherit: false }]);
  assert.deepEqual(s.memberOf, []);
  assert.deepEqual(s.schema, [{ usage: true, create: false }]);
  const [{ owned }] = await owner.$queryRawUnsafe<{ owned: number }[]>(`SELECT count(*)::int AS owned FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='zeus_app'`);
  assert.equal(owned, 0);
  for (const table of NO_ACCESS) {
    const [row] = await owner.$queryRawUnsafe<{ any: boolean }[]>(
      `SELECT has_table_privilege('zeus_app', $1, 'SELECT') OR has_table_privilege('zeus_app', $1, 'INSERT') OR has_any_column_privilege('zeus_app', $1, 'UPDATE')
        OR has_table_privilege('zeus_app', $1, 'DELETE') OR has_table_privilege('zeus_app', $1, 'TRUNCATE') AS any`, "public." + table);
    assert.equal(row.any, false, table);
  }
  const [staff] = await owner.$queryRawUnsafe<Record<string, boolean>[]>(
    `SELECT has_column_privilege('zeus_app','staff','phone','SELECT') AS phone, has_column_privilege('zeus_app','staff','email','SELECT') AS email,
      has_any_column_privilege('zeus_app','staff','UPDATE') AS update, has_table_privilege('zeus_app','staff','INSERT') AS insert`);
  assert.deepEqual(staff, { phone: false, email: true, update: false, insert: false });
  const [bookings] = await owner.$queryRawUnsafe<Record<string, boolean>[]>(
    `SELECT has_table_privilege('zeus_app','bookings','UPDATE') AS "tableUpdate", has_column_privilege('zeus_app','bookings','receiptTotalCentavos','UPDATE') AS receipt,
      has_column_privilege('zeus_app','bookings','customerPhone','UPDATE') AS phone, has_column_privilege('zeus_app','bookings','status','UPDATE') AS status,
      has_table_privilege('zeus_app','bookings','DELETE') AS delete`);
  assert.deepEqual(bookings, { tableUpdate: false, receipt: false, phone: false, status: true, delete: false });
  const [fn] = await owner.$queryRawUnsafe<{ execute: boolean }[]>(`SELECT has_function_privilege('zeus_app','publish_catalog(text,text,text,text)','EXECUTE') AS execute`);
  assert.equal(fn.execute, false);
  assert.ok(s.defaults.some((d) => /zeus_app=arwd\//.test(d.acl)), "owner default privileges for future tables (S-06)");
});

test("ADR-003 deny list: zeus_app cannot change, remove or unprotect the audit trail or the ledger", { skip }, async () => {
  const attempts = [
    `UPDATE booking_audit_events SET reason='x'`, `DELETE FROM booking_audit_events`, `TRUNCATE booking_audit_events`,
    `ALTER TABLE booking_audit_events ADD COLUMN p110 int`, `DROP TRIGGER booking_audit_immutable ON booking_audit_events`,
    `ALTER TABLE booking_audit_events DISABLE TRIGGER booking_audit_immutable`, `ALTER TABLE booking_audit_events DISABLE TRIGGER ALL`,
    `UPDATE booking_operations SET outcome=outcome`, `DELETE FROM booking_operations`, `TRUNCATE booking_operations`,
    `SELECT 1 FROM _prisma_migrations`, `CREATE TABLE p110_probe (id int)`, `SET session_replication_role = replica`,
    `SELECT phone FROM staff`, `UPDATE bookings SET "receiptTotalCentavos"=0`, `DELETE FROM bookings`,
  ];
  for (const sql of attempts) {
    await assert.rejects(app.$executeRawUnsafe(sql), /permission denied|must be owner|must be the owner|insufficient privilege/i, sql);
  }
  const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='public.booking_audit_events'::regclass AND tgname IN ('booking_audit_immutable','booking_audit_no_truncate') AND tgenabled IN ('O','A')`);
  assert.equal(n, 2, "both immutability triggers stay enabled");
});

test("S-06 check: passes for zeus_app; names every problem for the owner, a widened grant or a disabled trigger", { skip }, async () => {
  const check = (db: PrismaClient) => db.$transaction((tx) => checkAuditPrivileges(tx));
  assert.deepEqual(await check(app), []);
  const asOwner = await check(owner);
  assert.ok(asOwner.includes("superuser") && asOwner.includes("owner"), asOwner.join());
  await owner.$executeRawUnsafe("GRANT UPDATE (reason) ON booking_audit_events TO zeus_app");
  await owner.$executeRawUnsafe("GRANT TRUNCATE ON booking_audit_events TO zeus_app");
  assert.deepEqual((await check(app)).sort(), ["truncate", "update"]);
  provisionRuntimeRole(ownerUrl);
  await owner.$executeRawUnsafe("ALTER TABLE booking_audit_events DISABLE TRIGGER booking_audit_no_truncate");
  try { assert.deepEqual(await check(app), ["triggers"]); }
  finally { await owner.$executeRawUnsafe("ALTER TABLE booking_audit_events ENABLE TRIGGER booking_audit_no_truncate"); }
  assert.deepEqual(await check(app), []);
});

test("in production a failed check refuses staff mutations before any write (503, NOT_COMMITTED, logged); reads and zeus_app writes work", { skip }, async () => {
  const s = await import("./index");
  const admin = await owner.staff.create({ data: { name: "Runtime Role Admin", phone: "", email: `rr-${randomUUID()}@example.test`, role: "ADMIN" } });
  const ADMIN: StaffActor = { staffId: admin.id, role: "ADMIN", sessionId: randomUUID() };
  const events: { event: string; fields: Record<string, unknown> }[] = [];
  setAdminEventSink((event, fields) => events.push({ event, fields }));
  try {
    const queue = await owner.bookingQueue.findUniqueOrThrow({ where: { code: "REPAINT" } });
    await assert.rejects(s.setDefaultCap(ADMIN, "REPAINT", { expectedRevision: queue.revision, dailyCap: 7 }, { db: owner, enforceAuditPrivileges: true }), (e: unknown) => {
      assert.ok(e instanceof AdminServiceError);
      assert.equal(e.adminCode, "RETRYABLE_ERROR");
      assert.equal(e.status, 503);
      assert.equal(e.toEnvelope().commitState, "NOT_COMMITTED");
      return true;
    });
    const violation = events.find((e) => e.event === "admin.audit_privilege_violation");
    assert.ok(violation && violation.fields.enforced === true && String(violation.fields.problems).includes("superuser"), JSON.stringify(events));
    assert.equal((await owner.bookingQueue.findUniqueOrThrow({ where: { code: "REPAINT" } })).revision, queue.revision, "nothing was written");
    assert.equal(await owner.bookingAuditEvent.count({ where: { action: "CAP_CHANGED" } }), 0);
    // The failure is cached: a second mutation inside 60 s is refused without another check.
    const checks = events.length;
    await assert.rejects(s.setDefaultCap(ADMIN, "REPAINT", { expectedRevision: queue.revision, dailyCap: 7 }, { db: owner, enforceAuditPrivileges: true }), /temporarily unavailable/);
    assert.equal(events.length, checks);
    // Reads keep working for the misconfigured role; the correct role passes and writes.
    assert.ok(await s.getCaps(ADMIN, { from: "2027-01-01", to: "2027-01-01" }, { db: owner }));
    const changed = await s.setDefaultCap(ADMIN, "REPAINT", { expectedRevision: queue.revision, dailyCap: 7 }, { db: app, enforceAuditPrivileges: true });
    assert.equal(changed.dailyCap, 7);
    assert.equal(await owner.bookingAuditEvent.count({ where: { action: "CAP_CHANGED", actorStaffId: admin.id } }), 1);
    assert.equal(events.filter((e) => e.event === "admin.audit_privilege_violation").length, 1);
  } finally {
    setAdminEventSink((event, fields) => console.info(JSON.stringify({ event, ...fields })));
  }
});

// The admin, customer-create and staff-auth suites run again with every service call as zeus_app
// in src/server/runtime-role-suites.integration.test.ts.

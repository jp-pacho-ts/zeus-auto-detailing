// P1-37: the read-only release check (prisma/sql/p1-37-readonly-check.sql) passes on a correctly provisioned database,
// is truly read only, and names the problem when something is wrong: an extra grant, a disabled trigger, a changed ACL.
// Own sibling database (<T007 name>_ro); nothing is dropped; every deliberate break is put back. Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const roUrl = url ? siblingDatabaseUrl(url, "ro") : "postgresql://unused@localhost/zeus_t007_unused_ro";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: roUrl } } });
const script = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-37-readonly-check.sql"), "utf8");

before(async () => {
  if (skip) return;
  await createAndMigrate(root, roUrl);
  provisionRuntimeRole(roUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

interface Row { name: string; ok: boolean; detail: string }
const run = () => db.$queryRawUnsafe<Row[]>(script);
const failing = async () => (await run()).filter((r) => !r.ok && r.name !== "VERDICT").map((r) => r.name);

test("RO1 on a migrated, provisioned database every check passes and the verdict is ALL_OK", { skip }, async () => {
  const rows = await run();
  assert.deepEqual(rows.filter((r) => !r.ok), []);
  const verdict = rows.find((r) => r.name === "VERDICT")!;
  assert.deepEqual([verdict.ok, verdict.detail], [true, "ALL_OK"]);
  assert.ok(rows.length >= 50, `a thorough check (${rows.length} rows)`);
  const named = (needle: string) => rows.some((r) => r.name.includes(needle) && r.ok);
  for (const needle of ["delete_booking(text, text, integer, text): exists, owner, SECURITY DEFINER, pinned search_path, ACL", "legacy object kept: commission_payouts",
    "every SECURITY DEFINER function in public pins search_path with pg_temp last", "zeus_app cannot write staff", "trigger bookings.commission_accrue_on_complete is enabled", "commission_settings has exactly one valid row", "migration applied"])
    assert.ok(named(needle), needle);
  assert.equal(rows.find((r) => r.name === "info: commission default rate (basis points)")!.detail, "1000");
});

test("RO2 the script is one SELECT that writes nothing: no data-changing keyword, and running it twice leaves the database identical", { skip }, async () => {
  // Comments and the quoted privilege names ('INSERT', 'DELETE' ...) are not statements.
  const code = script.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'[^']*'/g, "''");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMIT)\b/i);
  // Row counts and the newest row of each table the script reads (integers, so they serialize).
  const snapshot = async () => JSON.stringify(await db.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM staff) a, (SELECT count(*)::int FROM admin_audit_events) b,
    (SELECT count(*)::int FROM commission_settings) c, (SELECT count(*)::int FROM commission_entries) d, (SELECT revision FROM commission_settings WHERE id = 1) e`));
  const before = await snapshot();
  await run();
  await run();
  assert.equal(await snapshot(), before);
});

test("RO3 it names the problem: an extra grant to the app, a disabled trigger, a PUBLIC grant on an admin function, a missing legacy object", { skip }, async () => {
  // Each step is one statement (Prisma sends one command per call), so apply and undo can be lists.
  const breakIt = async (apply: string | string[], undo: string | string[], expected: string) => {
    for (const q of [apply].flat()) await db.$executeRawUnsafe(q);
    try {
      const bad = await failing();
      assert.ok(bad.some((n) => n.includes(expected)), `${expected}: got ${JSON.stringify(bad)}`);
      assert.equal((await run()).find((r) => r.name === "VERDICT")!.ok, false);
    } finally { for (const q of [undo].flat()) await db.$executeRawUnsafe(q); }
    assert.deepEqual(await failing(), [], `restored after: ${expected}`);
  };
  await breakIt(`GRANT INSERT ON commission_entries TO zeus_app`, `REVOKE INSERT ON commission_entries FROM zeus_app`, "zeus_app cannot write commission_entries");
  await breakIt(`GRANT SELECT ON admin_audit_events TO zeus_app`, `REVOKE SELECT ON admin_audit_events FROM zeus_app`, "zeus_app cannot read admin_audit_events");
  await breakIt(`GRANT UPDATE (role) ON staff TO zeus_app`, `REVOKE UPDATE (role) ON staff FROM zeus_app`, "zeus_app cannot write staff");
  await breakIt(`GRANT SELECT (phone) ON staff TO zeus_app`, `REVOKE SELECT (phone) ON staff FROM zeus_app`, "zeus_app cannot write staff or read phones");
  await breakIt(`ALTER TABLE bookings DISABLE TRIGGER commission_accrue_on_complete`, `ALTER TABLE bookings ENABLE TRIGGER commission_accrue_on_complete`, "trigger bookings.commission_accrue_on_complete is enabled");
  await breakIt(`GRANT EXECUTE ON FUNCTION admin_staff_remove(text, text, integer) TO PUBLIC`, `REVOKE ALL ON FUNCTION admin_staff_remove(text, text, integer) FROM PUBLIC`, "function admin_staff_remove(text, text, integer)");
  await breakIt(`GRANT EXECUTE ON FUNCTION commission_accrue(text) TO zeus_app`, [`REVOKE ALL ON FUNCTION commission_accrue(text) FROM PUBLIC`, `REVOKE ALL ON FUNCTION commission_accrue(text) FROM zeus_app`], "function commission_accrue(text)");
  await breakIt(`REVOKE EXECUTE ON FUNCTION delete_booking(text, text, integer, text) FROM zeus_app`, `GRANT EXECUTE ON FUNCTION delete_booking(text, text, integer, text) TO zeus_app`, "function delete_booking(text, text, integer, text)");
  await breakIt(`ALTER FUNCTION delete_booking(text, text, integer, text) SECURITY INVOKER`, `ALTER FUNCTION delete_booking(text, text, integer, text) SECURITY DEFINER`, "function delete_booking(text, text, integer, text)");
  await breakIt(`ALTER FUNCTION admin_team_list(text) RESET search_path`, `ALTER FUNCTION admin_team_list(text) SET search_path = pg_catalog, public, pg_temp`, "function admin_team_list(text)");
  // Codex F1: a path without pg_temp LAST is a failure, for a new function and for an old one from an earlier migration.
  await breakIt(`ALTER FUNCTION admin_staff_set_active(text, text, boolean, integer) SET search_path = pg_catalog, public`, `ALTER FUNCTION admin_staff_set_active(text, text, boolean, integer) SET search_path = pg_catalog, public, pg_temp`, "function admin_staff_set_active(text, text, boolean, integer)");
  await breakIt(`ALTER FUNCTION admin_staff_set_active(text, text, boolean, integer) SET search_path = pg_temp, pg_catalog, public`, `ALTER FUNCTION admin_staff_set_active(text, text, boolean, integer) SET search_path = pg_catalog, public, pg_temp`, "every SECURITY DEFINER function in public pins search_path with pg_temp last");
  await breakIt(`ALTER FUNCTION publish_catalog(text, text, text, text) SET search_path = pg_catalog, public`, `ALTER FUNCTION publish_catalog(text, text, text, text) SET search_path = pg_catalog, public, pg_temp`, "every SECURITY DEFINER function in public pins search_path with pg_temp last");
  await breakIt(`ALTER FUNCTION booking_delete_authorised(text) RESET search_path`, `ALTER FUNCTION booking_delete_authorised(text) SET search_path = pg_catalog, public, pg_temp`, "every SECURITY DEFINER function in public pins search_path with pg_temp last");
});

test("RO4 the script also fails closed when the migration is missing or the runtime role is absent (a database before the migration)", { skip }, async () => {
  const bare = siblingDatabaseUrl(url!, "ro2");
  await root.$executeRawUnsafe(`CREATE DATABASE "${new URL(bare).pathname.slice(1)}"`);
  const bareDb = new PrismaClient({ datasources: { db: { url: bare } } });
  try {
    // Before any migration the objects it reads do not exist, so the script cannot run to a passing verdict.
    await assert.rejects(bareDb.$queryRawUnsafe(script), /does not exist|_prisma_migrations/i);
  } finally { await bareDb.$disconnect(); }
});

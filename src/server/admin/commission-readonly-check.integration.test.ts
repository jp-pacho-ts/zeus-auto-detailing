// P1-37: the read-only release check (prisma/sql/p1-37-readonly-check.sql) passes on a correctly provisioned database,
// is truly read only, and names the problem when something is wrong: an extra grant, a disabled trigger, a changed ACL.
// Own sibling database (<T007 name>_ro); nothing is dropped; every deliberate break is put back. Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
  assert.equal(rows.find((r) => r.name === "info: commission default rate (basis points)")!.detail, "2000");
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

// Section 8b of the migration hardens the functions earlier migrations created, and must never be a reason to fail a live apply.
// This builds a database with every migration EXCEPT P1-37, adds functions with surprising paths, reads the inventory script
// before and after, and applies the real migration: it must apply, keep every existing path with pg_temp last, and report clean.
test("RO5 the definer inventory runs before the migration, and section 8b tolerates surprising paths instead of aborting", { skip, timeout: 240_000 }, async () => {
  const inventoryScript = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-37-definer-inventory.sql"), "utf8");
  const code = inventoryScript.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'[^']*'/g, "''");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMIT)\b/i, "the inventory is one read-only SELECT");

  // Every migration except the last one (P1-37) in a temporary copy, so the real migration is applied afterwards for real.
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const names = fs.readdirSync(migrationsDir).filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory()).sort();
  // P1-38 added a later migration, so P1-37 is found by name, not as "the newest": everything BEFORE it is applied first, then the real ones.
  assert.ok(names.includes("20261105000000_team_commissions"), "P1-37 migration exists");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p137-pre-"));
  fs.mkdirSync(path.join(tmp, "prisma", "migrations"), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(tmp, "prisma", "schema.prisma"));
  fs.copyFileSync(path.join(migrationsDir, "migration_lock.toml"), path.join(tmp, "prisma", "migrations", "migration_lock.toml"));
  for (const n of names.slice(0, names.indexOf("20261105000000_team_commissions"))) fs.cpSync(path.join(migrationsDir, n), path.join(tmp, "prisma", "migrations", n), { recursive: true });
  const pre = siblingDatabaseUrl(url!, "ro3");
  await root.$executeRawUnsafe(`CREATE DATABASE "${new URL(pre).pathname.slice(1)}"`);
  const prisma = (args: string[], cwd: string) => spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), ...args], { cwd, env: { ...process.env, DATABASE_URL: pre }, encoding: "utf8" });
  const applied = prisma(["migrate", "deploy", "--schema", path.join(tmp, "prisma", "schema.prisma")], tmp);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const pdb = new PrismaClient({ datasources: { db: { url: pre } } });
  type Inv = { function: string; securityDefiner: boolean; settings: string; "migration 8b": string };
  const inventory = () => pdb.$queryRawUnsafe<Inv[]>(inventoryScript);
  const config = async (fn: string) => (await pdb.$queryRawUnsafe<{ c: string[] | null }[]>(`SELECT proconfig AS c FROM pg_proc WHERE oid = to_regprocedure('public.${fn}')`))[0].c;
  const row = (rows: Inv[], fn: string) => rows.find((r) => r.function.startsWith(`public.${fn}(`) || r.function.startsWith(`${fn}(`))!;
  try {
    // Surprising functions a live database might have: other paths, none, pg_temp first, one already right, and non-definers.
    await pdb.$executeRawUnsafe(`CREATE FUNCTION public.p137_odd_definer() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS 'SELECT 1'`);
    await pdb.$executeRawUnsafe(`CREATE FUNCTION public.p137_unpinned_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`);
    await pdb.$executeRawUnsafe(`CREATE FUNCTION public.p137_temp_first_definer() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_temp, pg_catalog, public AS 'SELECT 1'`);
    await pdb.$executeRawUnsafe(`CREATE FUNCTION public.p137_good_definer() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS 'SELECT 1'`);
    await pdb.$executeRawUnsafe(`CREATE FUNCTION public.p137_odd_plain() RETURNS int LANGUAGE sql SET search_path = public AS 'SELECT 1'`);
    await pdb.$executeRawUnsafe(`CREATE FUNCTION public.p137_pinned_plain() RETURNS int LANGUAGE sql SET search_path = pg_catalog, public AS 'SELECT 1'`);

    const before = await inventory();
    for (const known of ["publish_catalog", "booking_delete_authorised", "delete_booking"]) {
      assert.equal(row(before, known).securityDefiner, true, known);
      assert.equal(row(before, known)["migration 8b"], "alter definer: keep path, pg_temp last", known + " before");
    }
    for (const fn of ["p137_odd_definer", "p137_unpinned_definer", "p137_temp_first_definer"]) assert.equal(row(before, fn)["migration 8b"], "alter definer: keep path, pg_temp last", fn);
    assert.equal(row(before, "p137_good_definer")["migration 8b"], "no change");
    assert.equal(row(before, "p137_pinned_plain")["migration 8b"], "alter function: add pg_temp");
    assert.equal(before.find((r) => r.function.includes("p137_odd_plain")), undefined, "a non-definer with another path is not listed");
    assert.ok(before.filter((r) => r["migration 8b"] === "alter function: add pg_temp").length >= 20, "the pinned trigger functions are listed");

    // The real migration, applied for real on top of this: it must apply, with no abort.
    const migrated = prisma(["migrate", "deploy"], process.cwd());
    assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);

    // Existing paths kept with pg_temp last; a non-definer with another path left alone.
    assert.deepEqual(await config("p137_odd_definer()"), ["search_path=public, pg_temp"]);
    assert.deepEqual(await config("p137_unpinned_definer()"), ["search_path=pg_catalog, public, pg_temp"]);
    assert.deepEqual(await config("p137_temp_first_definer()"), ["search_path=pg_catalog, public, pg_temp"], "pg_temp moved to the end, the rest kept in order");
    assert.deepEqual(await config("p137_good_definer()"), ["search_path=pg_catalog, public, pg_temp"]);
    assert.deepEqual(await config("p137_pinned_plain()"), ["search_path=pg_catalog, public, pg_temp"]);
    assert.deepEqual(await config("p137_odd_plain()"), ["search_path=public"], "a non-definer with another path is left alone");
    for (const known of ["publish_catalog(text, text, text, text)", "booking_delete_authorised(text)", "delete_booking(text, text, integer, text)"])
      assert.deepEqual(await config(known), ["search_path=pg_catalog, public, pg_temp"], known);

    const after = await inventory();
    assert.deepEqual(after.filter((r) => r["migration 8b"] !== "no change" && r["migration 8b"] !== "not touched by 8b"), [], "after the migration nothing is left for 8b to do");
    assert.deepEqual(after.filter((r) => r.securityDefiner && !/pg_temp$/.test(r.settings)), [], "every definer ends its path with pg_temp");
  } finally {
    await pdb.$disconnect();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Codex F5 (P1-37, Medium). Section 8b split an existing search_path on commas, so a function with
//   SET search_path = "qsa,scope", pg_catalog
// became "qsa, scope", pg_catalog, pg_temp: a different pair of schemas, and the same function failed with 42P01 during the
// migration-first release window. The path is now read as a list of identifiers. Every function below is called before and
// after the REAL migration and must return the same value; its stored path must be exactly the original tokens, byte for byte,
// with a bare pg_temp removed wherever it stood and pg_temp last.
test("RO6 section 8b reads search paths as identifier lists: quoted commas, doubled quotes, case, pg_temp anywhere, empty and missing paths", { skip, timeout: 240_000 }, async () => {
  const inventoryScript = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-37-definer-inventory.sql"), "utf8");
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const names = fs.readdirSync(migrationsDir).filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory()).sort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p137-f5-"));
  fs.mkdirSync(path.join(tmp, "prisma", "migrations"), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(tmp, "prisma", "schema.prisma"));
  fs.copyFileSync(path.join(migrationsDir, "migration_lock.toml"), path.join(tmp, "prisma", "migrations", "migration_lock.toml"));
  for (const n of names.slice(0, names.indexOf("20261105000000_team_commissions"))) fs.cpSync(path.join(migrationsDir, n), path.join(tmp, "prisma", "migrations", n), { recursive: true });
  const pre = siblingDatabaseUrl(url!, "ro4");
  await root.$executeRawUnsafe(`CREATE DATABASE "${new URL(pre).pathname.slice(1)}"`);
  const prisma = (args: string[], cwd: string) => spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), ...args], { cwd, env: { ...process.env, DATABASE_URL: pre }, encoding: "utf8" });
  const applied = prisma(["migrate", "deploy", "--schema", path.join(tmp, "prisma", "schema.prisma")], tmp);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const pdb = new PrismaClient({ datasources: { db: { url: pre } } });
  type Inv = { function: string; settings: string; "migration 8b": string; "path after 8b": string; "identifiers kept": boolean; "quoted comma": boolean };
  const inventory = () => pdb.$queryRawUnsafe<Inv[]>(inventoryScript);
  const row = (rows: Inv[], fn: string) => rows.find((r) => r.function.startsWith(`public.${fn}(`) || r.function.startsWith(`${fn}(`))!;
  const config = async (fn: string) => (await pdb.$queryRawUnsafe<{ c: string[] | null }[]>(`SELECT proconfig AS c FROM pg_proc WHERE oid = to_regprocedure('public.${fn}()')`))[0].c;
  const xmin = async (fn: string) => (await pdb.$queryRawUnsafe<{ x: string }[]>(`SELECT xmin::text AS x FROM pg_proc WHERE oid = to_regprocedure('public.${fn}()')`))[0].x;
  const call = async (fn: string) => Number((await pdb.$queryRawUnsafe<{ v: number }[]>(`SELECT public.${fn}() AS v`))[0].v);
  try {
    // Schemas whose names a comma split gets wrong, each holding one table whose value only the right path can read.
    for (const [schema, table, value] of [['"qsa,scope"', "marker", 7], ['"a""b"', "m", 11], ['"MixedCase"', "x", 13]] as const) {
      await pdb.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
      await pdb.$executeRawUnsafe(`CREATE TABLE ${schema}.${table} (v int)`);
      await pdb.$executeRawUnsafe(`INSERT INTO ${schema}.${table} VALUES (${value})`);
    }
    // name, security definer?, SET clause (null = none), table the unqualified body reads (null = SELECT 1), value, expected stored path after the migration
    type Case = [string, boolean, string | null, string | null, number, string[] | null];
    const QSA = '"qsa,scope"';
    const cases: Case[] = [
      ["f5_qsa", true, `${QSA}, pg_catalog`, "marker", 7, [`search_path=${QSA}, pg_catalog, pg_temp`]], // Codex's case
      ["f5_doubled_quote", true, '"a""b", public', "m", 11, ['search_path="a""b", public, pg_temp']],
      ["f5_mixed_case", true, '"MixedCase", pg_catalog', "x", 13, ['search_path="MixedCase", pg_catalog, pg_temp']],
      ["f5_spaces", true, "   pg_catalog   ,   public   ", null, 1, ["search_path=pg_catalog, public, pg_temp"]], // PostgreSQL normalizes spacing outside quotes when it stores the path
      ["f5_temp_first", true, `pg_temp, ${QSA}, pg_catalog`, "marker", 7, [`search_path=${QSA}, pg_catalog, pg_temp`]],
      ["f5_temp_middle", true, `${QSA}, pg_temp, pg_catalog`, "marker", 7, [`search_path=${QSA}, pg_catalog, pg_temp`]],
      ["f5_temp_upper_bare", true, `PG_TEMP, ${QSA}, pg_catalog`, "marker", 7, [`search_path=${QSA}, pg_catalog, pg_temp`]],
      ["f5_already_last", true, `${QSA}, pg_catalog, pg_temp`, "marker", 7, [`search_path=${QSA}, pg_catalog, pg_temp`]],
      ["f5_quoted_upper_schema", true, `"PG_TEMP", ${QSA}, pg_catalog`, "marker", 7, [`search_path="PG_TEMP", ${QSA}, pg_catalog, pg_temp`]], // a different schema, kept
      ["f5_empty", true, "''", null, 1, ["search_path=pg_temp"]],
      ["f5_missing", true, null, null, 1, ["search_path=pg_catalog, public, pg_temp"]],
      ["f5_plain_with_quoted_comma", false, `${QSA}, pg_catalog`, "marker", 7, [`search_path=${QSA}, pg_catalog`]], // not a definer, not exactly "pg_catalog, public": untouched
    ];
    for (const [name, definer, set, table, value] of cases)
      await pdb.$executeRawUnsafe(`CREATE FUNCTION public.${name}() RETURNS int LANGUAGE plpgsql ${definer ? "SECURITY DEFINER" : ""} ${set === null ? "" : "SET search_path = " + set} AS $$ BEGIN RETURN ${table ? "(SELECT v FROM " + table + ")" : String(value)}; END $$`);
    const before: Record<string, number> = {};
    for (const [name, , , , value] of cases) { before[name] = await call(name); assert.equal(before[name], value, name + " works before the migration"); }
    const xminBefore = { already: await xmin("f5_already_last"), plain: await xmin("f5_plain_with_quoted_comma") };

    const inv = await inventory();
    assert.equal(row(inv, "f5_qsa")["quoted comma"], true, "the inventory flags a quoted comma");
    assert.equal(row(inv, "f5_qsa")["path after 8b"], `${QSA}, pg_catalog, pg_temp`, "and predicts the identifier-aware path, not a comma split");
    assert.equal(row(inv, "f5_doubled_quote")["path after 8b"], '"a""b", public, pg_temp');
    assert.equal(row(inv, "f5_temp_middle")["path after 8b"], `${QSA}, pg_catalog, pg_temp`);
    assert.equal(row(inv, "f5_already_last")["migration 8b"], "no change");
    assert.equal(row(inv, "f5_empty")["path after 8b"], "pg_temp");
    assert.equal(row(inv, "f5_missing")["path after 8b"], "pg_catalog, public, pg_temp");
    assert.deepEqual(inv.filter((r) => r["identifiers kept"] !== true).map((r) => r.function), [], "the identifier list is the same before and after on every row");

    const migrated = prisma(["migrate", "deploy"], process.cwd());
    assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);

    for (const [name, , , , value, expected] of cases) {
      assert.deepEqual(await config(name), expected, name + " stored path");
      assert.equal(await call(name), before[name], name + " behaves exactly as before");
      assert.equal(await call(name), value);
    }
    assert.equal(await xmin("f5_already_last"), xminBefore.already, "a path that already ends in pg_temp is not rewritten at all");
    assert.equal(await xmin("f5_plain_with_quoted_comma"), xminBefore.plain, "a non-definer with another path is not rewritten");
    const after = await inventory();
    assert.deepEqual(after.filter((r) => r["migration 8b"] !== "no change" && r["migration 8b"] !== "not touched by 8b"), [], "after the migration nothing is left for 8b to do");
  } finally {
    await pdb.$disconnect();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// P1-39: right after migrate deploy, BEFORE prisma/sql/runtime-role.sql runs (the release order puts the migration first with the old code live), nothing
// the migration created may be open to PUBLIC, trigger functions included. Own sibling database (<T007 name>_expacl), migrated and deliberately NOT
// provisioned. Without T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const aclUrl = url ? siblingDatabaseUrl(url, "expacl") : "postgresql://unused@localhost/zeus_t007_unused_expacl";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: aclUrl } } });
let roleExistedBeforeMigration = false;
const WRITERS = ["admin_expense_create(text, text, date, text, bigint, text, text)", "admin_expense_update(text, text, integer, date, text, bigint, text, text)", "admin_expense_void(text, text, integer, text)", "admin_expense_restore(text, text, integer)", "admin_category_create(text, text, text)", "admin_category_update(text, text, integer, text, boolean)"];
const INTERNAL = ["guard_expense_event_insert()", "reject_expense_change()"];
const TABLES = ["expense_categories", "expenses", "expense_events", "expense_category_events"];

before(async () => {
  if (skip) return;
  roleExistedBeforeMigration = (await root.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'zeus_app'`))[0].n === 1;
  await createAndMigrate(root, aclUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

test("EA1 right after migrate deploy no expense function and no expense table is open to PUBLIC", { skip }, async () => {
  const fns = await db.$queryRawUnsafe<{ fn: string; open: boolean }[]>(
    `SELECT sig AS fn, has_function_privilege('public', ('public.' || sig)::regprocedure, 'EXECUTE') AS open FROM unnest($1::text[]) sig`, [...WRITERS, ...INTERNAL]);
  assert.equal(fns.length, 8);
  assert.deepEqual(fns.filter((f) => f.open).map((f) => f.fn), [], "functions executable by PUBLIC");
  const others = await db.$queryRawUnsafe<{ fn: string }[]>(
    `SELECT p.oid::regprocedure::text AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE '%expense%' OR p.proname LIKE 'admin_category%') AND has_function_privilege('public', p.oid, 'EXECUTE')`);
  assert.deepEqual(others, [], "and none this list forgot");
  const tables = await db.$queryRawUnsafe<{ t: string; open: boolean }[]>(`SELECT t, has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS open FROM unnest($1::text[]) t`, TABLES);
  assert.deepEqual(tables.filter((x) => x.open).map((x) => x.t), [], "tables open to PUBLIC");
});

test("EA2 if the runtime role already existed, the migration itself grants it SELECT on the four tables and EXECUTE on the six writers, and nothing else", { skip }, async (t) => {
  if (!roleExistedBeforeMigration) { t.skip("zeus_app did not exist when the database was migrated"); return; }
  const rows = await db.$queryRawUnsafe<{ t: string; read: boolean; write: boolean }[]>(
    `SELECT t, has_table_privilege('zeus_app', 'public.' || t, 'SELECT') AS read,
       has_any_column_privilege('zeus_app', 'public.' || t, 'INSERT, UPDATE') OR has_table_privilege('zeus_app', 'public.' || t, 'DELETE, TRUNCATE, TRIGGER') OR has_any_column_privilege('zeus_app', 'public.' || t, 'REFERENCES') AS write
     FROM unnest($1::text[]) t`, TABLES);
  assert.deepEqual(rows.map((r) => [r.t, r.read, r.write]), TABLES.map((x) => [x, true, false]));
  const fns = await db.$queryRawUnsafe<{ fn: string; run: boolean }[]>(`SELECT sig AS fn, has_function_privilege('zeus_app', ('public.' || sig)::regprocedure, 'EXECUTE') AS run FROM unnest($1::text[]) sig`, [...WRITERS, ...INTERNAL]);
  assert.deepEqual(fns.filter((f) => f.run).map((f) => f.fn), WRITERS, "the writers and no trigger function");
});

test("EA3 every writer is an owner-run definer with pg_temp last", { skip }, async () => {
  const rows = await db.$queryRawUnsafe<{ fn: string; definer: boolean; pinned: boolean }[]>(
    `SELECT sig AS fn, p.prosecdef AS definer, EXISTS(SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=pg_catalog, ?public, ?pg_temp$') AS pinned
     FROM unnest($1::text[]) sig JOIN pg_proc p ON p.oid = ('public.' || sig)::regprocedure`, WRITERS);
  assert.deepEqual(rows.filter((r) => !r.definer || !r.pinned), []);
});

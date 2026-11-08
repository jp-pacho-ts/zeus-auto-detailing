// P1-42: right after migrate deploy, BEFORE prisma/sql/runtime-role.sql runs (the release order puts the migration first with the old code live),
// nothing the migration created may be open to PUBLIC. Own sibling database (<T007 name>_setacl), migrated and deliberately NOT provisioned.
// Without T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const aclUrl = url ? siblingDatabaseUrl(url, "setacl") : "postgresql://unused@localhost/zeus_t007_unused_setacl";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: aclUrl } } });
let roleExistedBeforeMigration = false;

before(async () => {
  if (skip) return;
  roleExistedBeforeMigration = (await root.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'zeus_app'`))[0].n === 1;
  await createAndMigrate(root, aclUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

test("SA1 right after migrate deploy no settings function and no settings table is open to PUBLIC", { skip }, async () => {
  const fns = await db.$queryRawUnsafe<{ fn: string; open: boolean }[]>(
    `SELECT p.oid::regprocedure::text AS fn, has_function_privilege('public', p.oid, 'EXECUTE') AS open
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE '%shop_settings%' ORDER BY 1`);
  assert.equal(fns.length, 3, "the writer and the two trigger functions: " + fns.map((f) => f.fn).join(", "));
  assert.deepEqual(fns.filter((f) => f.open).map((f) => f.fn), [], "functions executable by PUBLIC");
  const tables = await db.$queryRawUnsafe<{ t: string; open: boolean }[]>(
    `SELECT t, has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS open
     FROM unnest(ARRAY['shop_settings', 'shop_settings_audit_events']) t`);
  assert.deepEqual(tables.filter((x) => x.open).map((x) => x.t), [], "tables open to PUBLIC");
});

test("SA2 the writer is a pinned definer with pg_temp last", { skip }, async () => {
  const [p] = await db.$queryRawUnsafe<{ definer: boolean; config: string[] }[]>(
    `SELECT prosecdef AS definer, proconfig AS config FROM pg_proc WHERE oid = 'public.admin_shop_settings_set(text, integer, boolean, text, boolean)'::regprocedure`);
  assert.equal(p.definer, true);
  assert.deepEqual(p.config.map((c) => c.replace(/\s/g, "")), ["search_path=pg_catalog,public,pg_temp"]);
});

test("SA3 if the runtime role already existed, the migration itself grants it read on the row, execute on the writer, and nothing else", { skip }, async (t) => {
  if (!roleExistedBeforeMigration) { t.skip("zeus_app did not exist when the database was migrated"); return; }
  const [r] = await db.$queryRawUnsafe<{ read: boolean; run: boolean; write: boolean; audit: boolean; internal: boolean }[]>(
    `SELECT has_table_privilege('zeus_app', 'public.shop_settings', 'SELECT') AS read,
            has_function_privilege('zeus_app', 'public.admin_shop_settings_set(text, integer, boolean, text, boolean)', 'EXECUTE') AS run,
            has_any_column_privilege('zeus_app', 'public.shop_settings', 'INSERT, UPDATE') OR has_table_privilege('zeus_app', 'public.shop_settings', 'DELETE, TRUNCATE') AS write,
            has_any_column_privilege('zeus_app', 'public.shop_settings_audit_events', 'SELECT, INSERT, UPDATE') AS audit,
            has_function_privilege('zeus_app', 'public.reject_shop_settings_audit_change()', 'EXECUTE') OR has_function_privilege('zeus_app', 'public.guard_shop_settings_audit_insert()', 'EXECUTE') AS internal`);
  assert.deepEqual(r, { read: true, run: true, write: false, audit: false, internal: false });
});

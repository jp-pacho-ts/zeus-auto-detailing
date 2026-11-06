// P1-37 (review R2-1): the migration alone must leave every new function and table closed to PUBLIC, BEFORE
// prisma/sql/runtime-role.sql runs (the documented release order puts the migration first). This suite migrates a fresh
// sibling database (<T007 name>_acl) and deliberately does NOT provision the runtime role. Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const aclUrl = url ? siblingDatabaseUrl(url, "acl") : "postgresql://unused@localhost/zeus_t007_unused_acl";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: aclUrl } } });
let roleExistedBeforeMigration = false;

before(async () => {
  if (skip) return;
  roleExistedBeforeMigration = (await root.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'zeus_app'`))[0].n === 1;
  await createAndMigrate(root, aclUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

test("ACL1 right after migrate deploy no admin_* function and no commission or audit table is open to PUBLIC", { skip }, async () => {
  const fns = await db.$queryRawUnsafe<{ fn: string; open: boolean }[]>(
    `SELECT p.oid::regprocedure::text AS fn, has_function_privilege('public', p.oid, 'EXECUTE') AS open
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'admin\\_%' ORDER BY 1`);
  assert.ok(fns.some((f) => f.fn.startsWith("admin_commission_adjust(")), "the adjust function exists");
  assert.deepEqual(fns.filter((f) => f.open).map((f) => f.fn), [], "functions executable by PUBLIC");
  const tables = await db.$queryRawUnsafe<{ t: string; open: boolean }[]>(
    `SELECT t, has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS open
     FROM unnest(ARRAY['commission_settings', 'commission_accruals', 'commission_entries', 'commission_adjustments', 'admin_audit_events']) t`);
  assert.deepEqual(tables.filter((x) => x.open).map((x) => x.t), [], "tables open to PUBLIC");
});

test("ACL2 if the runtime role already existed, the migration itself grants it exactly the new read and execute rights", { skip }, async (t) => {
  if (!roleExistedBeforeMigration) { t.skip("zeus_app did not exist when the database was migrated"); return; }
  const [r] = await db.$queryRawUnsafe<{ read: boolean; run: boolean; write: boolean; audit: boolean }[]>(
    `SELECT has_table_privilege('zeus_app', 'public.commission_adjustments', 'SELECT') AS read,
            has_function_privilege('zeus_app', 'public.admin_commission_adjust(text, text, text, bigint, text)', 'EXECUTE') AS run,
            has_any_column_privilege('zeus_app', 'public.commission_adjustments', 'INSERT') OR has_any_column_privilege('zeus_app', 'public.commission_adjustments', 'UPDATE') AS write,
            has_any_column_privilege('zeus_app', 'public.admin_audit_events', 'SELECT') AS audit`);
  assert.deepEqual(r, { read: true, run: true, write: false, audit: false });
});

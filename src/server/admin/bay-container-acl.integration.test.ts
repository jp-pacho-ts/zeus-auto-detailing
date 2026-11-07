// P1-62 A1: right after migrate deploy, BEFORE prisma/sql/runtime-role.sql runs (the release order puts the migration first with the old
// code live), nothing the migration created may be open to PUBLIC, and an existing runtime role gets exactly the intended rights.
// Own sibling database (<T007 name>_ctracl), migrated and deliberately NOT provisioned. Without T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const aclUrl = url ? siblingDatabaseUrl(url, "ctracl") : "postgresql://unused@localhost/zeus_t007_unused_ctracl";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: aclUrl } } });
let roleExistedBeforeMigration = false;

before(async () => {
  if (skip) return;
  roleExistedBeforeMigration = (await root.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'zeus_app'`))[0].n === 1;
  await createAndMigrate(root, aclUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

test("CA1 right after migrate deploy no container function and no container table is open to PUBLIC", { skip }, async () => {
  const fns = await db.$queryRawUnsafe<{ fn: string; open: boolean }[]>(
    `SELECT p.oid::regprocedure::text AS fn, has_function_privilege('public', p.oid, 'EXECUTE') AS open
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE '%container%' OR p.proname = 'admin_bay_move' OR p.proname = 'default_bay_container') ORDER BY 1`);
  assert.ok(fns.length >= 8, "the four writers, the helper and the trigger functions exist: " + fns.map((f) => f.fn).join(", "));
  assert.deepEqual(fns.filter((f) => f.open).map((f) => f.fn), [], "functions executable by PUBLIC");
  const tables = await db.$queryRawUnsafe<{ t: string; open: boolean }[]>(
    `SELECT t, has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS open
     FROM unnest(ARRAY['bay_containers', 'bay_container_audit_events']) t`);
  assert.deepEqual(tables.filter((x) => x.open).map((x) => x.t), [], "tables open to PUBLIC");
});

test("CA2 if the runtime role already existed, the migration itself grants it read on containers, execute on the four writers, and nothing else new", { skip }, async (t) => {
  if (!roleExistedBeforeMigration) { t.skip("zeus_app did not exist when the database was migrated"); return; }
  const [r] = await db.$queryRawUnsafe<{ read: boolean; run: boolean; write: boolean; audit: boolean; internal: boolean; moveColumn: boolean }[]>(
    `SELECT has_table_privilege('zeus_app', 'public.bay_containers', 'SELECT') AS read,
            has_function_privilege('zeus_app', 'public.admin_container_create(text, text, text, text[])', 'EXECUTE')
              AND has_function_privilege('zeus_app', 'public.admin_bay_move(text, text, text, timestamptz)', 'EXECUTE') AS run,
            has_any_column_privilege('zeus_app', 'public.bay_containers', 'INSERT, UPDATE') AS write,
            has_any_column_privilege('zeus_app', 'public.bay_container_audit_events', 'SELECT, INSERT, UPDATE') AS audit,
            has_function_privilege('zeus_app', 'public.check_bay_containers()', 'EXECUTE') AS internal,
            has_column_privilege('zeus_app', 'public.bays', 'containerId', 'UPDATE') AS "moveColumn"`);
  assert.deepEqual(r, { read: true, run: true, write: false, audit: false, internal: false, moveColumn: false });
});

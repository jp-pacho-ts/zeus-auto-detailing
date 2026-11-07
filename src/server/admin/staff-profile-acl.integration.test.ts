// P1-64: right after migrate deploy, BEFORE prisma/sql/runtime-role.sql runs (the release order puts the migration first with the old code live), nothing
// the migration created may be open to PUBLIC. Own sibling database (<T007 name>_spacl), migrated and deliberately NOT provisioned. Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const aclUrl = url ? siblingDatabaseUrl(url, "spacl") : "postgresql://unused@localhost/zeus_t007_unused_spacl";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: aclUrl } } });
let roleExistedBeforeMigration = false;
const WRITERS = ["admin_team_list_v2(text)", "admin_staff_create_v2(text, text, text, text, text, integer)", "admin_staff_profile_get(text, text)",
  "admin_staff_profile_set(text, text, integer, text, text, text, text, date, date, text, text, text)", "admin_staff_remove_v2(text, text, integer)"];

before(async () => {
  if (skip) return;
  roleExistedBeforeMigration = (await root.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'zeus_app'`))[0].n === 1;
  await createAndMigrate(root, aclUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

test("SPA1 right after migrate deploy no new function and no new table is open to PUBLIC, the guard included; definers pin pg_temp last", { skip }, async () => {
  const fns = await db.$queryRawUnsafe<{ fn: string; open: boolean; definer: boolean; config: string[] | null }[]>(
    `SELECT p.oid::regprocedure::text AS fn, has_function_privilege('public', p.oid, 'EXECUTE') AS open, p.prosecdef AS definer, p.proconfig AS config
     FROM pg_proc p WHERE p.oid = ANY(ARRAY[${[...WRITERS, "guard_removed_staff()"].map((f) => `'public.${f}'::regprocedure`).join(",")}])`);
  assert.equal(fns.length, 6);
  assert.deepEqual(fns.filter((f) => f.open).map((f) => f.fn), [], "functions executable by PUBLIC");
  for (const f of fns) {
    assert.ok((f.config ?? []).some((c) => /^search_path=pg_catalog, ?public, ?pg_temp$/.test(c)), f.fn + " pins its search_path with pg_temp last");
    assert.equal(f.definer, f.fn.startsWith("admin_"), f.fn + " SECURITY DEFINER");
  }
  const [t] = await db.$queryRawUnsafe<{ open: boolean }[]>(`SELECT has_table_privilege('public', 'public.staff_profiles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS open`);
  assert.equal(t.open, false);
});

test("SPA2 if the runtime role already existed, the migration grants it EXECUTE on the five functions and nothing on the table, the guard or the new column", { skip }, async (t) => {
  if (!roleExistedBeforeMigration) { t.skip("zeus_app did not exist when the database was migrated"); return; }
  const [r] = await db.$queryRawUnsafe<{ run: boolean; table: boolean; guard: boolean; column: boolean }[]>(
    `SELECT ${WRITERS.map((f) => `has_function_privilege('zeus_app', 'public.${f}', 'EXECUTE')`).join(" AND ")} AS run,
       has_any_column_privilege('zeus_app', 'public.staff_profiles', 'SELECT, INSERT, UPDATE, REFERENCES') OR has_table_privilege('zeus_app', 'public.staff_profiles', 'DELETE, TRUNCATE, TRIGGER') AS table,
       has_function_privilege('zeus_app', 'public.guard_removed_staff()', 'EXECUTE') AS guard,
       has_column_privilege('zeus_app', 'public.staff', 'removedAt', 'SELECT, UPDATE') AS column`);
  assert.deepEqual(r, { run: true, table: false, guard: false, column: false });
});

// P1-74: every database function the server code calls by name in SQL must be executable by the runtime role after
// prisma/sql/runtime-role.sql, because that script replaces all of zeus_app's privileges with its own list. P1-71's version left out
// commission_accrue(text), which workers-write.ts calls when a worker is added to a completed booking; earlier migrations had granted
// it, so only a fresh provisioning (or the live run) would have shown the break. Own sibling database (<T007 name>_p174), migrated
// first and then provisioned. Without T007_TEST_DATABASE_URL the database test skips; the scan itself always runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const dbUrl = url ? siblingDatabaseUrl(url, "p174") : "postgresql://unused@localhost/zeus_t007_unused_p174";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// Names called as `SELECT name(`, `FROM name(` or `PERFORM name(` (optionally public.) in the app's server code, tests and fixtures excluded.
function calledNames(): string[] {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); continue; }
      if (!/\.ts$/.test(e.name) || /\.test\.ts$|fixture|\.check\.ts$/.test(e.name)) continue;
      for (const m of fs.readFileSync(p, "utf8").matchAll(/\b(?:SELECT|FROM|PERFORM)\s+(?:public\.)?([a-z_][a-z0-9_]*)\(/gi)) names.add(m[1].toLowerCase());
    }
  };
  walk(path.join(process.cwd(), "src", "server"));
  return [...names].sort();
}

before(async () => {
  if (skip) return;
  await createAndMigrate(root, dbUrl);
  provisionRuntimeRole(dbUrl);
});
after(async () => { await Promise.all([db.$disconnect(), root.$disconnect()]); });

test("RC0 the scan finds the app's database functions (so RC1 is not vacuous), and none of the owner-only commission internals", { skip: false }, () => {
  const names = calledNames();
  for (const n of ["delete_booking", "admin_payroll_save_adjustment", "admin_team_list_v2", "admin_commission_recalculate"]) assert.ok(names.includes(n), n);
  // P1-37 / P1-74 (CEO option B): the accrual runs only from owner-run triggers and admin functions, never as a direct app call.
  for (const n of ["commission_accrue", "commission_consistency_check", "commission_split", "admin_assert_actor"]) assert.ok(!names.includes(n), n + " is owner-only");
});

test("RC1 after migrate then runtime-role.sql, zeus_app can EXECUTE every public function the server code calls", { skip }, async () => {
  const names = calledNames();
  // Only functions that live in schema public (built-ins such as count or set_config are pg_catalog), every overload.
  const rows = await db.$queryRawUnsafe<{ fn: string; ok: boolean }[]>(
    `SELECT p.oid::regprocedure::text AS fn, has_function_privilege('zeus_app', p.oid, 'EXECUTE') AS ok
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[]) ORDER BY 1`, names);
  assert.ok(rows.length >= 40, "a real list of app functions: " + rows.length);
  assert.deepEqual(rows.filter((r) => !r.ok).map((r) => r.fn), [], "functions the app calls but the runtime role cannot execute");
});

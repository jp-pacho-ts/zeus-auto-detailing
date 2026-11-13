// P1-71: the repair migrations (20261119000000 definer and delete repair, 20261119010000 staff column revoke) on a database that
// already holds data, in the live order: every migration up to 20261118000000 is applied, the runtime role is provisioned and holds
// the grants live holds today, rows are written, and only then do the two repair migrations run. Own sibling databases (<T007 name>_p171, _p171b). Without
// T007_TEST_DATABASE_URL the tests skip. The source checks at the end need no database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, createDatabase, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const LAST_BEFORE_REPAIR = "20261118000000_commission_by_size";
const dataUrl = url ? siblingDatabaseUrl(url, "p171") : "postgresql://unused@localhost/zeus_t007_unused_p171";
const freshUrl = url ? siblingDatabaseUrl(url, "p171b") : "postgresql://unused@localhost/zeus_t007_unused_p171b";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: dataUrl } } });
const fresh = new PrismaClient({ datasources: { db: { url: freshUrl } } });
let detailerId = "";
let rowsBefore: unknown;
const rows = () => db.$queryRawUnsafe(
  `SELECT (SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM staff t) AS staff,
          (SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM staff_payroll_adjustments t) AS payroll`);

function deploy(target: string, upTo?: string): void {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  let cwd = process.cwd(), schema: string[] = [], tmp: string | null = null;
  if (upTo) {
    const names = fs.readdirSync(migrationsDir).filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory()).sort();
    assert.ok(names.includes(upTo), upTo + " exists");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p171-pre-"));
    fs.mkdirSync(path.join(tmp, "prisma", "migrations"), { recursive: true });
    fs.copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(tmp, "prisma", "schema.prisma"));
    fs.copyFileSync(path.join(migrationsDir, "migration_lock.toml"), path.join(tmp, "prisma", "migrations", "migration_lock.toml"));
    for (const n of names.slice(0, names.indexOf(upTo) + 1)) fs.cpSync(path.join(migrationsDir, n), path.join(tmp, "prisma", "migrations", n), { recursive: true });
    cwd = tmp;
    schema = ["--schema", path.join(tmp, "prisma", "schema.prisma")];
  }
  try {
    const run = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "deploy", ...schema],
      { cwd, env: { ...process.env, DATABASE_URL: target }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally {
    // Windows may still hold a handle on the copied folder for a moment after prisma exits; the copy is disposable.
    if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* left in the OS temp folder */ }
  }
}

before(async () => {
  if (skip) return;
  // Live state before the repair: every migration up to 20261118000000 applied, the role provisioned at that release, and the grants
  // that 20261112030000 (staff columns) and 20261112080000 (payroll DML) gave the existing role. (Provisioning on the EMPTY database
  // would instead leave the script's owner default privileges on every later table, which live never had: its tables predate the role.)
  await createDatabase(root, dataUrl);
  deploy(dataUrl, LAST_BEFORE_REPAIR);
  provisionRuntimeRole(dataUrl);
  await db.$executeRawUnsafe(`GRANT SELECT (phone, revision, "createdAt", "removedAt") ON public.staff TO zeus_app`);
  await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE ON public.staff_payroll_adjustments TO zeus_app`);
  const detailer = await db.staff.create({ data: { name: "P171 Detailer", email: "p171-detailer@example.test", phone: "+639170000171", role: "DETAILER" } });
  detailerId = detailer.id;
  await db.staffPayrollAdjustment.create({ data: { staffId: detailer.id, weekStart: new Date("2026-11-09T00:00:00.000Z"), daysAbsent: 1, cashAdvanceCentavos: BigInt(50_000), advanceNotes: "synthetic" } });
  // Tokens that delete_booking left behind between 20261112020000 and the repair: committed transactions, never valid again.
  await db.$executeRawUnsafe(`INSERT INTO booking_delete_tokens ("txId", "bookingId") VALUES (1, 'p171-stale-1'), (2, 'p171-stale-2')`);
  rowsBefore = await rows();
  deploy(dataUrl);
  // The other order: migrate first, then provision from prisma/sql/runtime-role.sql.
  await createAndMigrate(root, freshUrl);
  provisionRuntimeRole(freshUrl);
});
after(async () => { await Promise.all([db.$disconnect(), fresh.$disconnect(), root.$disconnect()]); });

test("R1 the repair keeps every existing row and clears only the stale delete tokens", { skip }, async () => {
  assert.deepEqual(await rows(), rowsBefore, "staff and payroll rows unchanged");
  const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM booking_delete_tokens`);
  assert.equal(n, 0, "no stale delete token is left");
});

const privileges = (client: PrismaClient) => client.$queryRawUnsafe<Record<string, boolean>[]>(
  `SELECT has_table_privilege('zeus_app', 'public.staff_payroll_adjustments', 'SELECT') AS "payrollRead",
          has_table_privilege('zeus_app', 'public.staff_payroll_adjustments', 'INSERT') AS "payrollInsert",
          has_table_privilege('zeus_app', 'public.staff_payroll_adjustments', 'UPDATE') AS "payrollUpdate",
          has_table_privilege('zeus_app', 'public.staff_payroll_adjustments', 'DELETE') AS "payrollDelete",
          has_function_privilege('zeus_app', 'public.admin_payroll_save_adjustment(text, text, date, integer, bigint, text)', 'EXECUTE') AS "saveAdjustment",
          has_function_privilege('zeus_app', 'public.admin_payroll_set_paid(text, text, date, boolean)', 'EXECUTE') AS "setPaid",
          has_column_privilege('zeus_app', 'public.staff', 'phone', 'SELECT') AS phone,
          has_column_privilege('zeus_app', 'public.staff', 'revision', 'SELECT') AS revision,
          has_column_privilege('zeus_app', 'public.staff', 'createdAt', 'SELECT') AS "createdAt",
          has_column_privilege('zeus_app', 'public.staff', 'removedAt', 'SELECT') AS "removedAt",
          has_column_privilege('zeus_app', 'public.staff', 'name', 'SELECT') AND has_column_privilege('zeus_app', 'public.staff', 'isActive', 'SELECT') AS "staffBasics"`);
const EXPECTED = {
  payrollRead: true, payrollInsert: false, payrollUpdate: false, payrollDelete: false, saveAdjustment: true, setPaid: true,
  phone: false, revision: false, createdAt: false, removedAt: false, staffBasics: true,
};

test("R2 the repair migrations alone (live order, before the role script runs again) close payroll writes and staff phones", { skip }, async () => {
  assert.deepEqual((await privileges(db))[0], EXPECTED);
});

test("R3 migrations first, then prisma/sql/runtime-role.sql: the same privileges, so provisioning order does not matter", { skip }, async () => {
  assert.deepEqual((await privileges(fresh))[0], EXPECTED);
  // Re-running the script after the repair keeps them (it is idempotent).
  provisionRuntimeRole(dataUrl);
  assert.deepEqual((await privileges(db))[0], EXPECTED);
});

test("R4 every definer, and every trigger function pinned to pg_catalog, public, ends its search_path with pg_temp", { skip }, async () => {
  const loose = await db.$queryRawUnsafe<{ fn: string; config: string }[]>(
    `SELECT p.oid::regprocedure::text AS fn, COALESCE(array_to_string(p.proconfig, ';'), '(none)') AS config
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=.*pg_temp$')
       AND (p.prosecdef OR EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=pg_catalog, ?public$'))
     ORDER BY 1`);
  assert.deepEqual(loose, []);
});

test("R5 the bigint admin_booking_update_details is a pinned definer that calls the integer form by its schema", { skip }, async () => {
  const [f] = await db.$queryRawUnsafe<{ definer: boolean; config: string[] | null; src: string }[]>(
    `SELECT p.prosecdef AS definer, p.proconfig AS config, p.prosrc AS src FROM pg_proc p
     WHERE p.oid = 'public.admin_booking_update_details(text, text, text, text, text, text, text, text, bigint)'::regprocedure`);
  assert.equal(f.definer, true);
  assert.ok((f.config ?? []).some((c) => /^search_path=pg_catalog, ?public, ?pg_temp$/.test(c)), String(f.config));
  assert.match(f.src, /public\.admin_booking_update_details\(/);
});

test("R6 the payroll alert is for those who may read payroll: STAFF sees none, ADMIN sees it (a Sunday, one unpaid detailer)", { skip }, async () => {
  const { getAdminNotifications } = await import("./notifications");
  const sunday = () => new Date("2026-11-15T04:00:00.000Z"); // Sunday 12:00 in Manila
  const staff: StaffActor = { staffId: detailerId, role: "STAFF", sessionId: randomUUID() };
  const admin: StaffActor = { staffId: randomUUID(), role: "ADMIN", sessionId: randomUUID() };
  const payroll = (s: { items: { type: string }[] }) => s.items.filter((n) => n.type === "PAYROLL_ALERT").length;
  assert.equal(payroll(await getAdminNotifications(staff, { db, now: sunday })), 0, "STAFF gets no payroll alert");
  assert.equal(payroll(await getAdminNotifications(admin, { db, now: sunday })), 1, "ADMIN gets the payroll alert");
});

test("R7 payroll.ts never swallows a database error or reads staff and profiles directly", { skip: false }, () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src", "server", "admin", "payroll.ts"), "utf8");
  assert.doesNotMatch(src, /catch\s*(\(\s*\w*\s*\))?\s*\{/, "no catch around a payroll read: inside one transaction a failed statement aborts it, and an empty list hides the failure");
  // (SP13 in staff-profiles.integration.test.ts already keeps the profile table out of this file.)
  assert.doesNotMatch(src, /\bFROM\s+staff\b/i, "staff come only from admin_team_list_v2");
});

test("R8 the car-ready actor lookup and the password change read no closed staff column", { skip: false }, () => {
  const notice = fs.readFileSync(path.join(process.cwd(), "src", "server", "notifications", "bookings.ts"), "utf8");
  const pw = fs.readFileSync(path.join(process.cwd(), "src", "server", "auth", "change-password.ts"), "utf8");
  // The staff lookups only: tx.staff.find… / count blocks, and SQL that reads FROM public.staff.
  const staffReads = (src: string) => [...src.matchAll(/tx\.staff\.\w+\(\{[\s\S]*?\}\);|FROM\s+(?:public\.)?staff\s+s[\s\S]*?`/g)].map((m) => m[0]);
  for (const [name, src] of [["notifications/bookings.ts", notice], ["auth/change-password.ts", pw]] as const) {
    const reads = staffReads(src);
    assert.ok(reads.length > 0, name + ": the staff lookup is found");
    for (const r of reads) assert.doesNotMatch(r, /removedAt|createdAt|\bphone\b|\brevision\b/, name + " reads a staff column zeus_app may not read");
  }
});

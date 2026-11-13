// P1-39: the migration is expand only. On a database with every earlier migration and existing supply rows, applying it changes no existing row and no existing
// function (compared by md5 of pg_proc before and after). Own sibling database (<T007 name>_expbf). Without T007_TEST_DATABASE_URL the test skips.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
after(async () => { await root.$disconnect(); });
const MIGRATION = "20261109000000_expenses";

test("EC0 the migration text writes only its own tables and replaces no function", { skip: false }, () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "prisma", "migrations", MIGRATION, "migration.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(sql, /CREATE OR REPLACE/i, "no live function is replaced");
  assert.doesNotMatch(sql, /ALTER TABLE\s+"?(?!expense)[a-z]/i, "no live table is altered");
  assert.doesNotMatch(sql, /\bDROP\b/i, "nothing is dropped");
  // A data change starts a statement. "ON UPDATE CASCADE", "BEFORE UPDATE" and "FOR UPDATE" in DDL or a lock are not data changes.
  const targets = [...sql.matchAll(/(?:^|;|\bTHEN)[ \t]*(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:public\.)?"?([a-z_]+)"?/gim)].map((m) => m[1].toLowerCase());
  assert.ok(targets.length > 0);
  assert.deepEqual([...new Set(targets)].filter((t) => !t.startsWith("expense")), [], "writes outside its own tables");
});

test("EC1 existing rows and functions are unchanged by the migration", { skip, timeout: 240_000 }, async () => {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const names = fs.readdirSync(migrationsDir).filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory()).sort();
  assert.ok(names.includes(MIGRATION), "the migration exists");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p139-pre-"));
  fs.mkdirSync(path.join(tmp, "prisma", "migrations"), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(tmp, "prisma", "schema.prisma"));
  fs.copyFileSync(path.join(migrationsDir, "migration_lock.toml"), path.join(tmp, "prisma", "migrations", "migration_lock.toml"));
  for (const n of names.slice(0, names.indexOf(MIGRATION))) fs.cpSync(path.join(migrationsDir, n), path.join(tmp, "prisma", "migrations", n), { recursive: true });
  const dbUrl = siblingDatabaseUrl(url!, "expbf");
  await root.$executeRawUnsafe(`CREATE DATABASE "${new URL(dbUrl).pathname.slice(1)}"`);
  const prisma = (args: string[], cwd: string) => spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), ...args], { cwd, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" });
  const first = prisma(["migrate", "deploy", "--schema", path.join(tmp, "prisma", "schema.prisma")], tmp);
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const staff = await db.staff.create({ data: { name: "Compat Admin", phone: "", email: "compat-admin@example.test", role: "ADMIN" } });
    const itemId = randomUUID();
    await db.$queryRawUnsafe(`SELECT admin_supply_create($1, $2, 'Compat Wax', NULL, 'bottle', 2, 1000, 5::bigint)`, staff.id, itemId);
    await db.$queryRawUnsafe(`SELECT admin_supply_stock($1, $2, $3, 1, 'RECEIVE', 3::bigint, 700, NULL)`, staff.id, randomUUID(), itemId);
    const snapshot = async () => ({
      items: await db.$queryRawUnsafe(`SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS h FROM supply_items t`),
      moves: await db.$queryRawUnsafe(`SELECT md5(string_agg(t::text, '|' ORDER BY t.seq)) AS h FROM supply_movements t`),
      staff: await db.$queryRawUnsafe(`SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS h FROM staff t`),
      bookings: await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM bookings`),
      entries: await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM commission_entries`),
      // Every function that exists now, by name and body. New functions are added later, so this list is taken first and compared on the same names.
      fns: await db.$queryRawUnsafe<{ fn: string; h: string }[]>(`SELECT p.oid::regprocedure::text AS fn, md5(p.prosrc || COALESCE(array_to_string(p.proconfig, ','), '') || p.prosecdef::text || COALESCE(p.proacl::text, '')) AS h FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`),
    });
    const was = await snapshot();
    assert.ok(was.fns.length > 20, "a real function list");
    // P1-71 (CEO D-2): apply THIS migration only. Deploying from the repository applied every later migration as well, and later
    // migrations replace functions on purpose, so the comparison measured them instead of 20261109000000.
    fs.cpSync(path.join(migrationsDir, MIGRATION), path.join(tmp, "prisma", "migrations", MIGRATION), { recursive: true });
    const second = prisma(["migrate", "deploy", "--schema", path.join(tmp, "prisma", "schema.prisma")], tmp);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const now = await snapshot();
    assert.deepEqual([now.items, now.moves, now.staff, now.bookings, now.entries], [was.items, was.moves, was.staff, was.bookings, was.entries], "no existing row changed");
    const later = new Map(now.fns.map((f) => [f.fn, f.h]));
    assert.deepEqual(was.fns.filter((f) => later.get(f.fn) !== f.h).map((f) => f.fn), [], "no existing function changed");
    assert.equal(now.fns.length - was.fns.length, 8, "the six writers and two trigger functions are the only additions");
    assert.equal((await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM expense_categories`))[0].n, 7, "seeded");
  } finally {
    await db.$disconnect();
    // P1-71: prisma now runs with this folder as its working directory, and Windows may hold it for a moment after it exits.
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a disposable copy in the OS temp folder */ }
  }
});

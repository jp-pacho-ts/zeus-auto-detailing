// P1-62 A1: the migration on a database that already has bays: every bay lands in the container of its old type, nothing about the bays
// changes except the new column (their version tokens, names and active flags stay), the three starting containers carry their usual
// services, and a bay already named like a starting container does not stop the migration. Builds a database with every migration
// EXCEPT this one, adds synthetic bays, then applies the real migration. Own sibling databases (<T007 name>_ctrbf, _ctrbf2). Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const MIGRATION = "20261107000000_bay_containers";

// A database with every migration before this one. Returns its URL and a runner for prisma commands against it.
async function before(suffix: string) {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const names = fs.readdirSync(migrationsDir).filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory()).sort();
  assert.ok(names.includes(MIGRATION), "the migration exists");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p162-pre-"));
  fs.mkdirSync(path.join(tmp, "prisma", "migrations"), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(tmp, "prisma", "schema.prisma"));
  fs.copyFileSync(path.join(migrationsDir, "migration_lock.toml"), path.join(tmp, "prisma", "migrations", "migration_lock.toml"));
  for (const n of names.slice(0, names.indexOf(MIGRATION))) fs.cpSync(path.join(migrationsDir, n), path.join(tmp, "prisma", "migrations", n), { recursive: true });
  const dbUrl = siblingDatabaseUrl(url!, suffix);
  await root.$executeRawUnsafe(`CREATE DATABASE "${new URL(dbUrl).pathname.slice(1)}"`);
  const prisma = (args: string[], cwd: string) => spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), ...args], { cwd, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" });
  const first = prisma(["migrate", "deploy", "--schema", path.join(tmp, "prisma", "schema.prisma")], tmp);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  return { dbUrl, applyThis: () => { const r = prisma(["migrate", "deploy"], process.cwd()); assert.equal(r.status, 0, r.stdout + r.stderr); } };
}

test("BF1 existing bays keep their rows and version tokens and land in the container of their old type", { skip, timeout: 240_000 }, async () => {
  const { dbUrl, applyThis } = await before("ctrbf");
  const pdb = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    // Today's bays: two wash, one inactive detailing, two paint.
    for (const [id, name, type, active, order] of [["b1", "Wash Bay 1", "WASH", true, 1], ["b2", "Wash Bay 2", "WASH", true, 2], ["b3", "Detailing Bay 1", "DETAILING", false, 3], ["b4", "Paint Booth 1", "PAINT", true, 4], ["b5", "Paint Booth 2", "PAINT", true, 5]] as const)
      await pdb.$executeRawUnsafe(`INSERT INTO bays (id, name, "nameKey", "sortOrder", "isActive", "bayType", "updatedAt") VALUES ('${id}', '${name}', '${name.toLowerCase()}', ${order}, ${active}, '${type}', '2027-01-02T03:04:05.678Z')`);
    const read = (sql: string) => pdb.$queryRawUnsafe<Record<string, unknown>[]>(sql);
    const bayRows = `SELECT id, name, "isActive", "sortOrder", "bayType"::text AS "bayType", to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt" FROM bays ORDER BY id`;
    const was = await read(bayRows);
    applyThis();
    assert.deepEqual(await read(bayRows), was, "every bay row is unchanged apart from the new column, version token included");
    const placed = await read(`SELECT y.id, c.name AS container FROM bays y JOIN bay_containers c ON c.id = y."containerId" ORDER BY y.id`);
    assert.deepEqual(placed.map((b) => [b.id, b.container]), [["b1", "Wash"], ["b2", "Wash"], ["b3", "Detailing"], ["b4", "Paint"], ["b5", "Paint"]]);
    const containers = await read(`SELECT name, "usualQueues", "sortOrder", "isActive" FROM bay_containers ORDER BY "sortOrder"`);
    assert.deepEqual(containers.map((c) => [c.name, c.usualQueues, c.isActive]), [["Wash", ["WASH"], true], ["Detailing", ["DETAILING_COATING", "TINT_PPF"], true], ["Paint", ["REPAINT"], true]]);
  } finally { await pdb.$disconnect(); }
});

test("BF2 a bay already named Wash does not stop the migration: the starting container gets a different name", { skip, timeout: 240_000 }, async () => {
  const { dbUrl, applyThis } = await before("ctrbf2");
  const pdb = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    await pdb.$executeRawUnsafe(`INSERT INTO bays (id, name, "nameKey", "sortOrder", "bayType", "updatedAt") VALUES ('c1', 'Wash', 'wash', 1, 'WASH', now())`);
    applyThis();
    assert.deepEqual((await pdb.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM bay_containers ORDER BY "sortOrder"`)).map((c) => c.name), ["Wash area", "Detailing", "Paint"]);
  } finally { await pdb.$disconnect(); }
});

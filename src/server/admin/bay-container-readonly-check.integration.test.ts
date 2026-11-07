// P1-62 A1: the read-only release check (prisma/sql/p1-62-readonly-check.sql) passes on a correctly provisioned database, is one SELECT
// that writes nothing, and names the problem when something is wrong. Own sibling database (<T007 name>_ctrrc). Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const rcUrl = url ? siblingDatabaseUrl(url, "ctrrc") : "postgresql://unused@localhost/zeus_t007_unused_ctrrc";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: rcUrl } } });
const script = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-62-readonly-check.sql"), "utf8");

before(async () => {
  if (skip) return;
  await createAndMigrate(root, rcUrl);
  provisionRuntimeRole(rcUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

interface Row { name: string; ok: boolean; detail: string }
const run = () => db.$queryRawUnsafe<Row[]>(script);

test("CR1 on a migrated, provisioned database every check passes and the verdict is ALL_OK", { skip }, async () => {
  const rows = await run();
  assert.deepEqual(rows.filter((r) => !r.ok), []);
  assert.deepEqual([rows.at(-1)!.name, rows.at(-1)!.ok, rows.at(-1)!.detail], ["VERDICT", true, "ALL_OK"]);
  assert.ok(rows.length >= 30, `a thorough check (${rows.length} rows)`);
  for (const needle of ["every bay has a container", "at least one active container", "trigger bays.bays_default_container is enabled", "zeus_app has no privilege at all on bay_container_audit_events"])
    assert.ok(rows.some((r) => r.name.includes(needle) && r.ok), needle);
});

test("CR2 the script is one SELECT that writes nothing", { skip }, async () => {
  const code = script.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMIT)\b/i);
  const total = () => db.$queryRawUnsafe<{ n: number }[]>(`SELECT (SELECT count(*) FROM bay_containers)::int + (SELECT count(*) FROM bay_container_audit_events)::int + (SELECT count(*) FROM bays)::int AS n`);
  const before = await total();
  await run();
  await run();
  assert.equal((await total())[0].n, before[0].n);
});

test("CR3 an extra grant and a bay without a container are each named and fail the verdict; putting things back passes again", { skip }, async () => {
  await db.$executeRawUnsafe(`GRANT UPDATE ("containerId") ON bays TO zeus_app`);
  try { assert.ok((await run()).some((r) => r.name.startsWith("zeus_app cannot change bays.containerId") && !r.ok)); }
  finally { await db.$executeRawUnsafe(`REVOKE UPDATE ("containerId") ON bays FROM zeus_app`); }
  await db.$executeRawUnsafe(`ALTER TABLE bays DISABLE TRIGGER bays_default_container`);
  try {
    await db.$executeRawUnsafe(`INSERT INTO bays (id, name, "nameKey", "sortOrder", "bayType", "updatedAt") VALUES ('orphan-bay', 'Orphan', 'orphan', 1, 'WASH', now())`);
    assert.ok((await run()).some((r) => r.name.includes("every bay has a container") && !r.ok));
  } finally {
    await db.$executeRawUnsafe(`DELETE FROM bays WHERE id = 'orphan-bay'`);
    await db.$executeRawUnsafe(`ALTER TABLE bays ENABLE TRIGGER bays_default_container`);
  }
  assert.equal((await run()).at(-1)!.detail, "ALL_OK");
});

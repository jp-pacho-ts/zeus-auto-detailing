// P1-38: the read-only release check (prisma/sql/p1-38-readonly-check.sql) passes on a correctly provisioned database, is one SELECT that
// writes nothing, and names the problem when something is wrong (an extra grant). Own sibling database (<T007 name>_suprc). Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const rcUrl = url ? siblingDatabaseUrl(url, "suprc") : "postgresql://unused@localhost/zeus_t007_unused_suprc";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: rcUrl } } });
const script = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-38-readonly-check.sql"), "utf8");

before(async () => {
  if (skip) return;
  await createAndMigrate(root, rcUrl);
  provisionRuntimeRole(rcUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

interface Row { name: string; ok: boolean; detail: string }
const run = () => db.$queryRawUnsafe<Row[]>(script);

test("SR1 on a migrated, provisioned database every check passes and the verdict is ALL_OK", { skip }, async () => {
  const rows = await run();
  assert.deepEqual(rows.filter((r) => !r.ok), []);
  assert.deepEqual([rows.at(-1)!.name, rows.at(-1)!.ok, rows.at(-1)!.detail], ["VERDICT", true, "ALL_OK"]);
  assert.ok(rows.length >= 40, `a thorough check (${rows.length} rows)`);
  for (const needle of ["enum SupplyMovementKind is exactly OPENING, RECEIVE, USE (no ADJUST)", "zeus_app has no privilege at all on supply_audit_events", "trigger supply_items.supply_items_consistent is enabled"])
    assert.ok(rows.some((r) => r.name.includes(needle) && r.ok), needle);
});

test("SR2 the script is one SELECT that writes nothing", { skip }, async () => {
  const code = script.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMIT)\b/i);
  const before = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT (SELECT count(*) FROM supply_items)::int + (SELECT count(*) FROM supply_movements)::int + (SELECT count(*) FROM supply_audit_events)::int AS n`);
  await run();
  await run();
  const after = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT (SELECT count(*) FROM supply_items)::int + (SELECT count(*) FROM supply_movements)::int + (SELECT count(*) FROM supply_audit_events)::int AS n`);
  assert.equal(after[0].n, before[0].n);
});

test("SR3 an extra grant to the runtime role is named and fails the verdict; putting it back passes again", { skip }, async () => {
  await db.$executeRawUnsafe(`GRANT INSERT ON supply_items TO zeus_app`);
  try {
    const rows = await run();
    assert.ok(rows.some((r) => r.name === "zeus_app cannot write supply_items" && !r.ok));
    assert.equal(rows.at(-1)!.ok, false);
  } finally { await db.$executeRawUnsafe(`REVOKE INSERT ON supply_items FROM zeus_app`); }
  await db.$executeRawUnsafe(`GRANT SELECT ON supply_audit_events TO zeus_app`);
  try { assert.ok((await run()).some((r) => r.name === "zeus_app has no privilege at all on supply_audit_events" && !r.ok)); }
  finally { await db.$executeRawUnsafe(`REVOKE SELECT ON supply_audit_events FROM zeus_app`); }
  assert.equal((await run()).at(-1)!.detail, "ALL_OK");
});

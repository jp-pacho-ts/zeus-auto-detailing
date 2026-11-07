// P1-39: the read-only release check (prisma/sql/p1-39-readonly-check.sql) passes on a correctly provisioned database, is one SELECT that writes nothing, and
// names the problem when something is wrong. Own sibling database (<T007 name>_exprc). Without T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const rcUrl = url ? siblingDatabaseUrl(url, "exprc") : "postgresql://unused@localhost/zeus_t007_unused_exprc";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: rcUrl } } });
const script = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-39-readonly-check.sql"), "utf8");

before(async () => {
  if (skip) return;
  await createAndMigrate(root, rcUrl);
  provisionRuntimeRole(rcUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

interface Row { name: string; ok: boolean; detail: string }
const run = () => db.$queryRawUnsafe<Row[]>(script);

test("ER1 on a migrated, provisioned database every check passes and the verdict is ALL_OK", { skip }, async () => {
  const rows = await run();
  assert.deepEqual(rows.filter((r) => !r.ok), []);
  assert.deepEqual([rows.at(-1)!.name, rows.at(-1)!.ok, rows.at(-1)!.detail], ["VERDICT", true, "ALL_OK"]);
  assert.ok(rows.length >= 40, `a thorough check (${rows.length} rows)`);
  for (const needle of ["seeded category Salaries and wages", "zeus_app cannot write expense_events", "trigger expenses.expenses_no_delete is enabled", "zeus_app still reads supply_movements"])
    assert.ok(rows.some((r) => r.name.includes(needle) && r.ok), needle);
});

test("ER2 the script is one SELECT that writes nothing", { skip }, async () => {
  const code = script.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMIT)\b/i);
  const total = () => db.$queryRawUnsafe<{ n: number }[]>(`SELECT (SELECT count(*) FROM expenses)::int + (SELECT count(*) FROM expense_events)::int + (SELECT count(*) FROM expense_categories)::int AS n`);
  const first = await total();
  await run();
  await run();
  assert.equal((await total())[0].n, first[0].n);
});

test("ER3 an extra grant and a disabled trigger are each named and fail the verdict; putting them back passes again", { skip }, async () => {
  await db.$executeRawUnsafe(`GRANT INSERT ON expenses TO zeus_app`);
  try {
    const rows = await run();
    assert.ok(rows.some((r) => r.name === "zeus_app cannot write expenses" && !r.ok));
    assert.equal(rows.at(-1)!.ok, false);
  } finally { await db.$executeRawUnsafe(`REVOKE INSERT ON expenses FROM zeus_app`); }
  await db.$executeRawUnsafe(`ALTER TABLE expense_events DISABLE TRIGGER expense_event_immutable`);
  try { assert.ok((await run()).some((r) => r.name === "trigger expense_events.expense_event_immutable is enabled" && !r.ok)); }
  finally { await db.$executeRawUnsafe(`ALTER TABLE expense_events ENABLE TRIGGER expense_event_immutable`); }
  assert.equal((await run()).at(-1)!.detail, "ALL_OK");
});

// P1-42: the read-only release check (prisma/sql/p1-42-readonly-check.sql) passes on a correctly provisioned database, is one SELECT that writes
// nothing, and names the problem when something is wrong (an extra grant). Own sibling database (<T007 name>_setrc). Without
// T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const rcUrl = url ? siblingDatabaseUrl(url, "setrc") : "postgresql://unused@localhost/zeus_t007_unused_setrc";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: rcUrl } } });
const script = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-42-readonly-check.sql"), "utf8");

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
  for (const needle of ["exactly one settings row", "zeus_app has no privilege at all on shop_settings_audit_events", "trigger shop_settings_audit_events.shop_settings_audit_immutable"]) {
    assert.ok(rows.some((r) => r.name.includes(needle) && r.ok), needle);
  }
  assert.equal(rows.find((r) => r.name === "info: maintenance")!.detail, "false", "the release starts live");
});

test("SR2 the script is one SELECT that writes nothing", { skip }, async () => {
  const code = script.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMIT)\b/i);
  const before = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT revision + (SELECT count(*)::int FROM shop_settings_audit_events) AS n FROM shop_settings`);
  await run();
  await run();
  const after = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT revision + (SELECT count(*)::int FROM shop_settings_audit_events) AS n FROM shop_settings`);
  assert.equal(after[0].n, before[0].n);
});

test("SR3 an extra grant to the runtime role is named and fails the verdict; putting it back passes again", { skip }, async () => {
  await db.$executeRawUnsafe(`GRANT UPDATE ON shop_settings TO zeus_app`);
  try {
    const rows = await run();
    assert.ok(rows.some((r) => r.name === "zeus_app cannot write shop_settings" && !r.ok));
    assert.equal(rows.at(-1)!.ok, false);
  } finally { await db.$executeRawUnsafe(`REVOKE UPDATE ON shop_settings FROM zeus_app`); }
  await db.$executeRawUnsafe(`GRANT SELECT ON shop_settings_audit_events TO zeus_app`);
  try { assert.ok((await run()).some((r) => r.name === "zeus_app has no privilege at all on shop_settings_audit_events" && !r.ok)); }
  finally { await db.$executeRawUnsafe(`REVOKE SELECT ON shop_settings_audit_events FROM zeus_app`); }
  assert.equal((await run()).at(-1)!.detail, "ALL_OK");
});

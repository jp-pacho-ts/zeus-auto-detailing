// P1-64: the read-only release check (prisma/sql/p1-64-readonly-check.sql) passes on a correctly provisioned database, is one SELECT that writes nothing,
// and names the problem when something is wrong. Own sibling database (<T007 name>_sprc). Without T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const rcUrl = url ? siblingDatabaseUrl(url, "sprc") : "postgresql://unused@localhost/zeus_t007_unused_sprc";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: rcUrl } } });
const script = fs.readFileSync(path.join(process.cwd(), "prisma", "sql", "p1-64-readonly-check.sql"), "utf8");

before(async () => {
  if (skip) return;
  await createAndMigrate(root, rcUrl);
  provisionRuntimeRole(rcUrl);
});
after(async () => { await db.$disconnect(); await root.$disconnect(); });

interface Row { name: string; ok: boolean; detail: string }
const run = () => db.$queryRawUnsafe<Row[]>(script);

test("SPR1 on a migrated, provisioned database every check passes and the verdict is ALL_OK", { skip }, async () => {
  const rows = await run();
  assert.deepEqual(rows.filter((r) => !r.ok), []);
  assert.deepEqual([rows.at(-1)!.name, rows.at(-1)!.ok, rows.at(-1)!.detail], ["VERDICT", true, "ALL_OK"]);
  assert.ok(rows.length >= 17, `a thorough check (${rows.length} rows)`);
  for (const needle of ["zeus_app has no privilege at all on staff_profiles", "trigger staff.staff_removed_is_final is enabled", "every removed row is inactive and holds no personal detail"])
    assert.ok(rows.some((r) => r.name.includes(needle) && r.ok), needle);
});

test("SPR2 the script is one SELECT that writes nothing", { skip }, () => {
  const code = script.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMIT)\b/i);
});

test("SPR3 an extra grant and a removed row still holding a detail are each named and fail the verdict; putting things back passes again", { skip }, async () => {
  await db.$executeRawUnsafe(`GRANT SELECT ON staff_profiles TO zeus_app`);
  try {
    const rows = await run();
    assert.ok(rows.some((r) => r.name === "zeus_app has no privilege at all on staff_profiles" && !r.ok));
    assert.equal(rows.at(-1)!.ok, false);
  } finally { await db.$executeRawUnsafe(`REVOKE SELECT ON staff_profiles FROM zeus_app`); }
  const bad = await db.staff.create({ data: { name: "RC Removed", phone: "0917", email: "rc-removed@example.test", role: "DETAILER", isActive: false } });
  await db.$executeRawUnsafe(`UPDATE staff SET "removedAt" = now() WHERE id = '${bad.id}'`);
  assert.ok((await run()).some((r) => r.name === "every removed row is inactive and holds no personal detail" && !r.ok));
  await db.$executeRawUnsafe(`ALTER TABLE staff DISABLE TRIGGER staff_removed_is_final`);
  try { await db.staff.delete({ where: { id: bad.id } }); } finally { await db.$executeRawUnsafe(`ALTER TABLE staff ENABLE TRIGGER staff_removed_is_final`); }
  assert.equal((await run()).at(-1)!.detail, "ALL_OK");
});

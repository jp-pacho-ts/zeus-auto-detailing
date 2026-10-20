import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { siblingDatabaseUrl } from "../catalog-db.fixture";

const parent = process.env.T007_TEST_DATABASE_URL;
const url = parent
  ? siblingDatabaseUrl(parent, "board_privileges")
  : "postgresql://unused@localhost/zeus_t007_unused_board_privileges";
const root = new PrismaClient({ datasources: { db: { url: parent || url } } });
const db = new PrismaClient({ datasources: { db: { url } } });
before(async () => {
  if (!parent) return;
  const name = new URL(url).pathname.slice(1);
  await root.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const [role] = await root.$queryRawUnsafe<{ n: number }[]>(
    "SELECT count(*)::int AS n FROM pg_roles WHERE rolname='zeus_app'",
  );
  if (!role.n) await root.$executeRawUnsafe("CREATE ROLE zeus_app LOGIN");
  // Existing owner default privileges must not widen this migration's runtime contract.
  await db.$executeRawUnsafe(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO zeus_app",
  );
  await db.$executeRawUnsafe(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC",
  );
  const migrated = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url, T007_TEST_DATABASE_URL: url },
      encoding: "utf8",
    },
  );
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
});
after(async () => {
  await db.$disconnect();
  await root.$disconnect();
});
test(
  "P1-17 exact runtime grants survive broad owner and PUBLIC defaults",
  { skip: !parent },
  async () => {
    const [rights] = await db.$queryRawUnsafe<Record<string, boolean>[]>(
      "SELECT has_table_privilege('zeus_app','bay_type_queues','SELECT') AS read, has_table_privilege('zeus_app','bay_type_queues','UPDATE') AS update, has_table_privilege('zeus_app','bay_type_queues','DELETE') AS delete, has_table_privilege('zeus_app','booking_worker_assignments','INSERT') AS insert, has_table_privilege('zeus_app','booking_worker_assignments','UPDATE') AS worker_update, has_table_privilege('zeus_app','bay_occupancies','TRUNCATE') AS truncate",
    );
    assert.deepEqual(rights, {
      read: true,
      update: false,
      delete: false,
      insert: true,
      worker_update: false,
      truncate: false,
    });
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE zeus_app");
        await tx.$executeRawUnsafe(
          "DELETE FROM bay_type_queues WHERE \"queueCode\"='WASH'",
        );
      }),
      /permission denied/i,
    );
    assert.equal(await db.bayTypeQueue.count(), 4);
  },
);

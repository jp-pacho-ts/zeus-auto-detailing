// P1-10 M1: the admin, customer-create and staff-auth suites rerun with every service call as the
// zeus_app runtime role provisioned by prisma/sql/runtime-role.sql, each on a fresh sibling
// database. Fixtures keep the owner client; nothing may fail, cancel or skip. The suites run one
// after another in this file, so at most one nested suite adds load to npm test at a time.
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { runSuiteAsRuntimeRole } from "./catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url || process.env.T007_SERVICE_ROLE !== undefined;
const suites = [
  ["admin", "src/server/admin/admin.integration.test.ts", false],
  ["create", "src/server/bookings-create.integration.test.ts", false],
  ["auth", "src/server/auth/auth.integration.test.ts", true], // auth services use DATABASE_URL directly
] as const;

for (const [name, file, servicesUseDatabaseUrl] of suites) {
  test(`${file} passes with every service call as zeus_app`, { skip, timeout: 900_000 }, async () => {
    const root = new PrismaClient({ datasources: { db: { url: url! } } });
    try { console.info(`zeus_app ${name}: ` + await runSuiteAsRuntimeRole(root, url!, name, file, servicesUseDatabaseUrl)); }
    finally { await root.$disconnect(); }
  });
}

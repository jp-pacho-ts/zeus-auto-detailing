import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, siblingDatabaseUrl } from "./catalog-db.fixture";
const url = process.env.T007_TEST_DATABASE_URL, skip = !url;
const admin = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: url ? siblingDatabaseUrl(url, "lifecycle_storage") : "postgresql://unused@localhost/zeus_t007_unused_storage" } } });
before(async () => { if (url) {
    assert.equal(url, process.env.DATABASE_URL);
    await createAndMigrate(admin, siblingDatabaseUrl(url, "lifecycle_storage"));
} });
after(async () => { await db.$disconnect(); await admin.$disconnect(); });
test("additive lifecycle tables, recovery fences and immutable global key namespace", { skip }, async () => {
    const tables = await db.$queryRaw<{
        name: string;
    }[]> `SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public'`;
    for (const name of [
        "booking_operations", "booking_management_grants", "booking_management_sessions", "booking_turnstile_uses", "booking_notification_outbox"
    ])
        assert.ok(tables.some(t => t.name === name), name);
    const key = "a".repeat(64), id = randomUUID();
    await db.$executeRaw `INSERT INTO booking_operations (id,"keyHash",kind,outcome,"recoveryExpiresAt") VALUES (${id},${key},'CREATE','CLOSED_WITHOUT_COMMIT',statement_timestamp()+interval '24 hours')`;
    await assert.rejects(db.$executeRaw `UPDATE booking_operations SET "requestHash"=${"b".repeat(64)} WHERE id=${id}`, /immutable/i);
    await assert.rejects(db.$executeRaw `DELETE FROM booking_operations WHERE id=${id}`, /immutable/i);
    await assert.rejects(db.$executeRaw `INSERT INTO booking_operations (id,"keyHash",kind,outcome,"recoveryExpiresAt") VALUES (${randomUUID()},${key},'CANCEL','CLOSED_WITHOUT_COMMIT',statement_timestamp()+interval '24 hours')`, /23505|already exists/i);
    await assert.rejects(db.$executeRaw `INSERT INTO booking_operations (id,"keyHash",kind,outcome,"recoveryExpiresAt") VALUES (${randomUUID()},${"c".repeat(64)},'CREATE','COMMITTED',statement_timestamp()+interval '24 hours')`, /check constraint/i);
});
test("runtime grants do not permit deleting receipts or minting an invalid operation shape", { skip }, async () => {
    const [{ exists }] = await db.$queryRaw<{
        exists: boolean;
    }[]> `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') AS exists`;
    assert.ok(exists, "Fresh cluster must provision zeus_app");
    const privileges = await db.$queryRaw<{
        insert: boolean;
        update: boolean;
        delete: boolean;
    }[]> `SELECT has_table_privilege('zeus_app','booking_operations','INSERT') AS insert,has_table_privilege('zeus_app','booking_operations','UPDATE') AS update,has_table_privilege('zeus_app','booking_operations','DELETE') AS delete`;
    assert.deepEqual(privileges[0], {
        insert: true, update: false, delete: false
    });
});

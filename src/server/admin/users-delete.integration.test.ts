// User Management delete: every service call runs as the runtime role (zeus_app) against real PostgreSQL with the real
// migrations. Own sibling database (<T007 name>_users_delete); synthetic data only; nothing is dropped. Without
// T007_TEST_DATABASE_URL the tests skip. Fixtures and checks use the owner client (db); service calls use the app client.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { AdminServiceError } from "./errors";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const dbUrl = url ? siblingDatabaseUrl(url, "users_delete") : "postgresql://unused@localhost/zeus_t007_unused_users_delete";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
let app: PrismaClient;
let s: typeof import("./index");
let ADMIN: StaffActor, OWNER: StaffActor;
const opts = () => ({ db: app });
const sha = () => createHash("sha256").update(randomUUID()).digest("hex");
const future = () => new Date(Date.now() + 3_600_000);

before(async () => {
  if (skip) return;
  await createAndMigrate(root, dbUrl);
  provisionRuntimeRole(dbUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(dbUrl) } } });
  s = await import("./index");
  const admin = await db.staff.create({ data: { name: "Delete Admin", phone: "09170000101", email: "del-admin@example.test", role: "ADMIN" } });
  const owner = await db.staff.create({ data: { name: "Delete Owner", phone: "09170000102", email: "del-owner@example.test", role: "SUPERADMIN" } });
  ADMIN = { staffId: admin.id, role: "ADMIN", sessionId: randomUUID() };
  OWNER = { staffId: owner.id, role: "ADMIN", sessionId: randomUUID() };
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

async function refused(p: Promise<unknown>, code: string, label: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.equal((e as AdminServiceError).code, code, `${label}: ${String((e as Error).message)}`);
    return true;
  }, label);
}

async function newUser(email: string, role: "ADMIN" | "SUPERADMIN" = "ADMIN") {
  const { user } = await s.createUser(ADMIN, { name: "Temp Admin", phone: "0917 555 0000", email, role }, opts());
  await db.staffSession.create({ data: { tokenHash: sha(), staffId: user.id, credentialGeneration: 1, createdAt: new Date(), lastSeenAt: new Date(), idleExpiresAt: future(), expiresAt: future() } });
  return user;
}

test("UD1 delete erases name, email, phone and password, revokes sessions, hides the account and audits", { skip }, async () => {
  const user = await newUser("temp-ud1@example.test");
  // The typed email is matched without regard to case or surrounding spaces.
  assert.deepEqual(await s.deleteUser(ADMIN, user.id, { expectedRevision: user.revision, confirmEmail: "  TEMP-UD1@example.test " }, opts()), { id: user.id, deleted: true });

  assert.ok(!(await s.listUsers(ADMIN, opts())).some((u) => u.id === user.id), "gone from the list");
  const row = await db.staff.findUniqueOrThrow({ where: { id: user.id } });
  assert.deepEqual([row.name, row.phone, row.isActive, row.email.endsWith("@staff.invalid")], ["Deleted user", "", false, true]);
  assert.ok(row.removedAt);
  assert.equal(await db.staffCredential.count({ where: { staffId: user.id } }), 0);
  assert.equal(await db.staffSession.count({ where: { staffId: user.id, revokedAt: null } }), 0);
  const audit = await db.$queryRawUnsafe<{ actor: string; details: string }[]>(
    `SELECT "actorStaffId" AS actor, details FROM user_audit_events WHERE action = 'USER_DELETED' AND "targetStaffId" = $1`, user.id);
  assert.deepEqual(audit, [{ actor: ADMIN.staffId, details: "ADMIN" }]);

  // A retry after a lost response (stale revision) gets the same answer and writes nothing more.
  assert.deepEqual(await s.deleteUser(ADMIN, user.id, { expectedRevision: user.revision, confirmEmail: "temp-ud1@example.test" }, opts()), { id: user.id, deleted: true });
  const again = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM user_audit_events WHERE action = 'USER_DELETED' AND "targetStaffId" = $1`, user.id);
  assert.equal(Number(again[0].n), 1);
});

test("UD2 the email of a deleted account can be used again", { skip }, async () => {
  const user = await newUser("temp-ud2@example.test");
  await s.deleteUser(ADMIN, user.id, { expectedRevision: user.revision, confirmEmail: user.email }, opts());
  const { user: reused } = await s.createUser(ADMIN, { name: "Second Admin", email: "temp-ud2@example.test", role: "ADMIN" }, opts());
  assert.notEqual(reused.id, user.id);
});

test("UD3 a Super Admin can be deleted while another Super Admin remains; the last one cannot", { skip }, async () => {
  const second = await newUser("temp-ud3-owner@example.test", "SUPERADMIN");
  await s.deleteUser(ADMIN, second.id, { expectedRevision: second.revision, confirmEmail: second.email }, opts());
  assert.ok((await db.staff.findUniqueOrThrow({ where: { id: second.id } })).removedAt, "second Super Admin deleted");

  const owner = await db.staff.findUniqueOrThrow({ where: { id: OWNER.staffId } });
  await refused(s.deleteUser(ADMIN, OWNER.staffId, { expectedRevision: owner.revision, confirmEmail: owner.email }, opts()), "NOT_ALLOWED", "last Super Admin");
  assert.equal((await db.staff.findUniqueOrThrow({ where: { id: OWNER.staffId } })).removedAt, null);
});

test("UD4 refusals: wrong email, own account, stale revision, unknown id, a detailer, a STAFF caller", { skip }, async () => {
  const user = await newUser("temp-ud4@example.test");
  const detailer = await db.staff.create({ data: { name: "Delete Detailer", phone: "09170000103", email: "del-detailer@example.test", role: "DETAILER" } });
  const self = await db.staff.findUniqueOrThrow({ where: { id: ADMIN.staffId } });

  await assert.rejects(s.deleteUser(ADMIN, user.id, { expectedRevision: user.revision, confirmEmail: "someone-else@example.test" }, opts()),
    (e: unknown) => { assert.equal((e as AdminServiceError).code, "VALIDATION_ERROR"); assert.ok((e as AdminServiceError).fieldErrors?.confirmEmail); return true; }, "wrong email");
  await refused(s.deleteUser(ADMIN, ADMIN.staffId, { expectedRevision: self.revision, confirmEmail: self.email }, opts()), "NOT_ALLOWED", "own account");
  await refused(s.deleteUser(ADMIN, user.id, { expectedRevision: user.revision + 1, confirmEmail: user.email }, opts()), "VERSION_CONFLICT", "stale revision");
  await refused(s.deleteUser(ADMIN, randomUUID(), { expectedRevision: 1, confirmEmail: "x@example.test" }, opts()), "NOT_FOUND", "unknown id");
  await refused(s.deleteUser(ADMIN, detailer.id, { expectedRevision: detailer.revision, confirmEmail: detailer.email }, opts()), "NOT_FOUND", "detailer");
  await refused(s.deleteUser({ staffId: detailer.id, role: "STAFF", sessionId: randomUUID() }, user.id, { expectedRevision: user.revision, confirmEmail: user.email }, opts()), "FORBIDDEN", "STAFF caller");

  // The database guards its own account check too, whatever the service does.
  await assert.rejects(app.$executeRaw`SELECT admin_user_delete(${ADMIN.staffId}, ${ADMIN.staffId}, ${self.revision}::integer, ${self.email})`, /ZT008/);
  assert.equal((await db.staff.findUniqueOrThrow({ where: { id: user.id } })).removedAt, null, "nothing was removed");
});

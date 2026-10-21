// P1-10 M1 (ADR-003 S-06): the staff-mutation gate on the runtime role's audit privileges.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { StaffDbPermit } from "@/server/auth/db-admission";
import { auditPrivilegeGate } from "./audit-privilege";
import { AdminServiceError } from "./errors";
import { setAdminEventSink } from "./log";

const GOOD = { superuser: false, bypassrls: false, owner: false, schemaOwner: false, databaseOwner: false, insert: true, select: true, update: false, delete: false, truncate: false, references: false, trigger: false, triggers: 2 };
function fake(row: Record<string, unknown>) {
  const counter = { checks: 0 };
  const permit = {
    async read(work: (tx: never) => Promise<unknown>) { counter.checks++; return work({ $queryRaw: async () => [row] } as never); },
    write: async () => { throw new Error("the gate never writes"); },
  } as unknown as StaffDbPermit;
  return { permit, counter, db: {} as PrismaClient };
}
const events: Record<string, unknown>[] = [];
setAdminEventSink((event, fields) => events.push({ event, ...fields }));

test("a passing check is cached for the process: one check, then none", async () => {
  const f = fake(GOOD);
  for (let i = 0; i < 3; i++) await auditPrivilegeGate(f.permit, f.db, true, () => i * 120_000);
  assert.equal(f.counter.checks, 1);
});

test("enforced: a failing check refuses with 503 RETRYABLE_ERROR, logs once, and re-checks at most every 60 s", async () => {
  events.length = 0;
  const f = fake({ ...GOOD, superuser: true, owner: true, update: true, triggers: 1 });
  let t = 0;
  const refused = async () => assert.rejects(auditPrivilegeGate(f.permit, f.db, true, () => t), (e: unknown) =>
    e instanceof AdminServiceError && e.adminCode === "RETRYABLE_ERROR" && e.status === 503 && e.toEnvelope().commitState === "NOT_COMMITTED");
  await refused();
  t = 59_999; await refused();
  assert.equal(f.counter.checks, 1, "no re-check inside 60 s");
  t = 60_000; await refused();
  assert.equal(f.counter.checks, 2);
  assert.deepEqual(events, [1, 2].map(() => ({ event: "admin.audit_privilege_violation", problems: "superuser,owner,update,triggers", enforced: true })));
});

test("not enforced (outside production): a failing check only warns", async () => {
  events.length = 0;
  const f = fake({ ...GOOD, delete: true });
  await auditPrivilegeGate(f.permit, f.db, false, () => 0);
  await auditPrivilegeGate(f.permit, f.db, false, () => 1_000);
  assert.deepEqual(events, [{ event: "admin.audit_privilege_violation", problems: "delete", enforced: false }]);
});

test("each check reports every problem class: missing INSERT/SELECT, BYPASSRLS, REFERENCES, TRIGGER, TRUNCATE", async () => {
  events.length = 0;
  const f = fake({ ...GOOD, bypassrls: true, insert: false, select: false, references: true, trigger: true, truncate: true });
  await auditPrivilegeGate(f.permit, f.db, false, () => 0);
  assert.equal(events[0].problems, "bypassrls,insert,select,truncate,references,trigger");
});

// Codex F3: owning the schema or the database gives owner authority whatever the table grants say.
test("enforced: a role that owns the public schema or the database is refused with 503 before any write", async () => {
  events.length = 0;
  for (const [row, problems] of [[{ schemaOwner: true }, "schema_owner"], [{ databaseOwner: true }, "database_owner"]] as const) {
    const f = fake({ ...GOOD, ...row });
    await assert.rejects(auditPrivilegeGate(f.permit, f.db, true, () => 0), (e: unknown) =>
      e instanceof AdminServiceError && e.adminCode === "RETRYABLE_ERROR" && e.toEnvelope().commitState === "NOT_COMMITTED");
    assert.deepEqual(events.pop(), { event: "admin.audit_privilege_violation", problems, enforced: true });
  }
});

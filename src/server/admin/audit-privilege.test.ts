// P1-10 M1 (ADR-003 S-06): the staff-mutation gate on the runtime role's audit privileges.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { StaffDbPermit } from "@/server/auth/db-admission";
import { auditPrivilegeGate } from "./audit-privilege";
import { AdminServiceError } from "./errors";
import { setAdminEventSink } from "./log";

const GOOD = { superuser: false, bypassrls: false, owner: false, schemaOwner: false, databaseOwner: false, insert: true, select: true, update: false, delete: false, truncate: false, references: false, trigger: false, triggers: 2,
  // admin_audit_events (P1-37, Codex F3): the intended state is NO privilege at all and three enabled triggers.
  adminMissing: false, adminOwner: false, adminInsert: false, adminSelect: false, adminUpdate: false, adminDelete: false, adminTruncate: false, adminReferences: false, adminTrigger: false, adminTriggers: 3 };
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

// Codex F3 (P1-37): admin_audit_events must be unreadable and unwritable for the runtime role, column grants included, and its
// three triggers must be on. Any deviation refuses staff mutations in production, like the booking audit table.
test("admin_audit_events: every privilege, a lone column grant, a missing table and a disabled trigger are each a named problem", async () => {
  events.length = 0;
  const cases: [Record<string, unknown>, string][] = [
    [{ adminInsert: true }, "admin_audit_insert"], // e.g. only INSERT(action, "actorStaffId", "targetStaffId", reason): a forged event
    [{ adminSelect: true }, "admin_audit_select"], [{ adminUpdate: true }, "admin_audit_update"], [{ adminDelete: true }, "admin_audit_delete"],
    [{ adminTruncate: true }, "admin_audit_truncate"], [{ adminReferences: true }, "admin_audit_references"], [{ adminTrigger: true }, "admin_audit_trigger"],
    [{ adminOwner: true }, "admin_audit_owner"], [{ adminTriggers: 2 }, "admin_audit_triggers"], [{ adminTriggers: 0 }, "admin_audit_triggers"],
    [{ adminMissing: true }, "admin_audit_missing"],
  ];
  for (const [row, problems] of cases) {
    const f = fake({ ...GOOD, ...row });
    await assert.rejects(auditPrivilegeGate(f.permit, f.db, true, () => 0), (e: unknown) =>
      e instanceof AdminServiceError && e.adminCode === "RETRYABLE_ERROR" && e.status === 503 && e.toEnvelope().commitState === "NOT_COMMITTED");
    assert.deepEqual(events.pop(), { event: "admin.audit_privilege_violation", problems, enforced: true });
  }
  const all = fake({ ...GOOD, adminOwner: true, adminInsert: true, adminSelect: true, adminUpdate: true, adminDelete: true, adminTruncate: true, adminReferences: true, adminTrigger: true, adminTriggers: 1 });
  await auditPrivilegeGate(all.permit, all.db, false, () => 0);
  assert.equal(events.pop()?.problems, "admin_audit_owner,admin_audit_insert,admin_audit_select,admin_audit_update,admin_audit_delete,admin_audit_truncate,admin_audit_references,admin_audit_trigger,admin_audit_triggers");
  // The state the migration and runtime-role.sql produce passes (and is cached).
  const good = fake(GOOD);
  await auditPrivilegeGate(good.permit, good.db, true, () => 0);
  assert.equal(events.length, 0);
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

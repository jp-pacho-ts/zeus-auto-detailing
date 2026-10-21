import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { StaffDbPermit, StaffTx } from "@/server/auth/db-admission";
import { AdminServiceError } from "./errors";
import { adminEvent } from "./log";

// ADR-003 S-06 enforcement check (ARCHITECTURE "Audit immutability and database principals").
// Before the first staff mutation of a process, under that mutation's STAFF_MUTATION permit and
// before its write transaction, confirm the runtime role cannot rewrite the audit trail: not
// superuser or BYPASSRLS, not the table owner or a member of it, not the owner of its schema or
// of the database (owner authority survives any revoke; Codex F3), INSERT and SELECT only on
// booking_audit_events, and both immutability triggers enabled. A pass is cached for the
// process; a failure is re-checked at most every 60 s. In production a failure refuses every
// staff mutation with 503 RETRYABLE_ERROR (NOT_COMMITTED: no write began) and logs
// admin.audit_privilege_violation; elsewhere it only warns. Customer booking and staff reads
// never pass through here.
const RECHECK_MS = 60_000;
const TRIGGER_COUNT = 2; // booking_audit_immutable (UPDATE, DELETE) and booking_audit_no_truncate

interface PrivilegeRow {
  superuser: boolean; bypassrls: boolean; owner: boolean; schemaOwner: boolean; databaseOwner: boolean; insert: boolean; select: boolean;
  update: boolean; delete: boolean; truncate: boolean; references: boolean; trigger: boolean; triggers: number;
}

// Problem classes only (no role names or SQL in logs).
export async function checkAuditPrivileges(tx: StaffTx): Promise<string[]> {
  const [r] = await tx.$queryRaw<PrivilegeRow[]>`
    SELECT r.rolsuper AS "superuser", r.rolbypassrls AS "bypassrls",
      pg_has_role(current_user, c.relowner, 'MEMBER') AS "owner",
      pg_has_role(current_user, n.nspowner, 'MEMBER') AS "schemaOwner",
      (SELECT pg_has_role(current_user, d.datdba, 'MEMBER') FROM pg_database d WHERE d.datname = current_database()) AS "databaseOwner",
      has_table_privilege(current_user, c.oid, 'INSERT') AS "insert",
      has_table_privilege(current_user, c.oid, 'SELECT') AS "select",
      has_any_column_privilege(current_user, c.oid, 'UPDATE') AS "update",
      has_table_privilege(current_user, c.oid, 'DELETE') AS "delete",
      has_table_privilege(current_user, c.oid, 'TRUNCATE') AS "truncate",
      has_any_column_privilege(current_user, c.oid, 'REFERENCES') AS "references",
      has_table_privilege(current_user, c.oid, 'TRIGGER') AS "trigger",
      (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname IN ('booking_audit_immutable', 'booking_audit_no_truncate')
        AND t.tgenabled IN ('O', 'A')) AS "triggers"
    FROM pg_roles r, pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE r.rolname = current_user AND c.oid = 'public.booking_audit_events'::regclass`;
  if (!r) return ["missing"];
  const problems: string[] = [];
  if (r.superuser) problems.push("superuser");
  if (r.bypassrls) problems.push("bypassrls");
  if (r.owner) problems.push("owner");
  if (r.schemaOwner) problems.push("schema_owner");
  if (r.databaseOwner) problems.push("database_owner");
  if (!r.insert) problems.push("insert");
  if (!r.select) problems.push("select");
  for (const p of ["update", "delete", "truncate", "references", "trigger"] as const) if (r[p]) problems.push(p);
  if (r.triggers !== TRIGGER_COUNT) problems.push("triggers");
  return problems;
}

const state = new WeakMap<PrismaClient, { ok: boolean; at: number }>();

export async function auditPrivilegeGate(permit: StaffDbPermit, db: PrismaClient, enforce: boolean, now: () => number = Date.now): Promise<void> {
  const known = state.get(db);
  if (known?.ok) return;
  if (!known || now() - known.at >= RECHECK_MS) {
    const problems = await permit.read(checkAuditPrivileges);
    state.set(db, { ok: problems.length === 0, at: now() });
    if (!problems.length) return;
    adminEvent("admin.audit_privilege_violation", { problems: problems.join(","), enforced: enforce });
  }
  if (enforce) throw new AdminServiceError("RETRYABLE_ERROR");
}

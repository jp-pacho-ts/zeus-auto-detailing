// P1-37 Team: every service call runs as the runtime role (zeus_app) against real PostgreSQL with the real migration.
// Own sibling database (<T007 name>_team); synthetic data only; nothing is dropped. Without T007_TEST_DATABASE_URL the
// tests skip. Fixtures and "the app cannot" checks use the owner client (db); every service call uses the app client.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { AdminServiceError } from "./errors";
import type { StaffActor } from "./context";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const teamUrl = url ? siblingDatabaseUrl(url, "team") : "postgresql://unused@localhost/zeus_t007_unused_team";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: teamUrl } } }); // owner: fixtures and trigger checks
let app: PrismaClient; // zeus_app: every service call and every "the app cannot" check
type Services = typeof import("./index");
let s: Services;
let ADMIN: StaffActor, MANAGER: StaffActor, STAFF: StaffActor, INACTIVE_ADMIN: StaffActor;
let adminRow: { id: string }, managerRow: { id: string };
const opts = () => ({ db: app });
// staff_sessions.tokenHash is checked to be a SHA-256 hex digest.
const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

before(async () => {
  if (skip) return;
  await createAndMigrate(root, teamUrl);
  provisionRuntimeRole(teamUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(teamUrl) } } });
  s = await import("./index");
  adminRow = await db.staff.create({ data: { name: "Team Admin", phone: "09170000001", email: "team-admin@example.test", role: "ADMIN" } });
  managerRow = await db.staff.create({ data: { name: "Team Manager", phone: "09170000002", email: "team-manager@example.test", role: "MANAGER" } });
  const detailer = await db.staff.create({ data: { name: "Team Detailer", phone: "09170000003", email: "team-detailer@example.test", role: "DETAILER" } });
  const inactive = await db.staff.create({ data: { name: "Team Former Admin", phone: "09170000004", email: "team-former@example.test", role: "ADMIN", isActive: false } });
  ADMIN = { staffId: adminRow.id, role: "ADMIN", sessionId: randomUUID() };
  MANAGER = { staffId: managerRow.id, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
  INACTIVE_ADMIN = { staffId: inactive.id, role: "ADMIN", sessionId: randomUUID() };
});
after(async () => { if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}
const count = async (table: string, where = "TRUE") => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0].n);
const audits = (action?: string) => db.adminAuditEvent.findMany({ where: action ? { action: action as never } : {}, orderBy: { createdAt: "asc" } });
let seq = 0;
const newPerson = (extra: Record<string, unknown> = {}) => s.addPerson(ADMIN, { name: `Synthetic Detailer ${++seq}`, ...extra }, opts());

test("T1 STAFF and unauthenticated roles are refused for every Team operation, and nothing is written", { skip }, async () => {
  const before = [await count("staff"), await count("admin_audit_events")];
  const id = randomUUID();
  await refused(s.listTeam(STAFF, opts()), "FORBIDDEN", "list");
  await refused(s.addPerson(STAFF, { name: "Nobody" }, opts()), "FORBIDDEN", "add");
  await refused(s.updatePerson(STAFF, id, { expectedRevision: 1, name: "X" }, opts()), "FORBIDDEN", "update");
  await refused(s.setPersonActive(STAFF, id, { expectedRevision: 1, active: false }, opts()), "FORBIDDEN", "active");
  await refused(s.removePerson(STAFF, id, { expectedRevision: 1 }, opts()), "FORBIDDEN", "remove");
  assert.deepEqual([await count("staff"), await count("admin_audit_events")], before);
});

test("T2 the database repeats the check: an inactive ADMIN, an unknown actor and a detailer are refused even if the service role claim is ADMIN", { skip }, async () => {
  const before = [await count("staff"), await count("admin_audit_events")];
  await refused(s.addPerson(INACTIVE_ADMIN, { name: "Nobody" }, opts()), "FORBIDDEN", "inactive admin");
  await refused(s.addPerson({ ...ADMIN, staffId: randomUUID() }, { name: "Nobody" }, opts()), "FORBIDDEN", "unknown actor");
  await refused(s.listTeam({ ...STAFF, role: "ADMIN" }, opts()), "FORBIDDEN", "a detailer claiming ADMIN");
  assert.deepEqual([await count("staff"), await count("admin_audit_events")], before);
});

test("T3 add: a detailer is created with a placeholder email, no sign-in, one audit row, and no name or phone in the trail", { skip }, async () => {
  const p = await s.addPerson(MANAGER, { name: "  Maria Santos  ", phone: " 0917 555 0101 " }, opts());
  assert.equal(p.name, "Maria Santos");
  assert.equal(p.phone, "0917 555 0101");
  assert.equal(p.role, "DETAILER");
  assert.deepEqual([p.isActive, p.commissionRateBp, p.canSignIn, p.openJobs, p.revision, p.email], [true, null, false, 0, 1, null]);
  const row = await db.staff.findUniqueOrThrow({ where: { id: p.id } });
  assert.match(row.email, /^detailer-[0-9a-f]{8}@staff\.invalid$/);
  const rows = (await audits("STAFF_CREATED")).filter((a) => a.targetStaffId === p.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].actorStaffId, rows[0].newValue, rows[0].targetLabel], [MANAGER.staffId, "DEFAULT", null]);
  const trail = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  for (const pii of ["Maria", "Santos", "0917", "555"]) assert.ok(!trail.includes(pii), `audit row leaked ${pii}`);
});

test("T4 add with an email and a personal percentage: lowercased, exact basis points", { skip }, async () => {
  const p = await newPerson({ email: "  Juan.Cruz@Example.TEST ", ratePercent: "12.5" });
  assert.equal(p.email, "juan.cruz@example.test");
  assert.equal(p.commissionRateBp, 1250);
  const zero = await newPerson({ ratePercent: "0" });
  assert.equal(zero.commissionRateBp, 0);
  const full = await newPerson({ ratePercent: "100" });
  assert.equal(full.commissionRateBp, 10_000);
  const odd = await newPerson({ ratePercent: "7.25" });
  assert.equal(odd.commissionRateBp, 725);
});

test("T5 add: a duplicate email is a plain field error", { skip }, async () => {
  await newPerson({ email: "dupe@example.test" });
  const before = await count("staff");
  await refused(s.addPerson(ADMIN, { name: "Second", email: "DUPE@example.test" }, opts()), "VALIDATION_ERROR", "duplicate", (e) =>
    assert.deepEqual(e.fieldErrors.email, ["That email is already used."]));
  assert.equal(await count("staff"), before);
});

test("T6 add: invalid input is refused with nothing written (Zod), and a stray role or id in the body is refused", { skip }, async () => {
  const before = [await count("staff"), await count("admin_audit_events")];
  const bad: unknown[] = [
    {}, { name: "" }, { name: "   " }, { name: "x".repeat(81) }, { name: "Line\nBreak" }, { name: "Ok", phone: "abc" }, { name: "Ok", phone: "1".repeat(31) },
    { name: "Ok", email: "not-an-email" }, { name: "Ok", ratePercent: "101" }, { name: "Ok", ratePercent: "-1" }, { name: "Ok", ratePercent: "1.234" },
    { name: "Ok", ratePercent: "abc" }, { name: "Ok", ratePercent: "" }, { name: "Ok", role: "ADMIN" }, { name: "Ok", id: randomUUID() }, { name: "Ok", isActive: false },
    { name: "Ok", commissionRateBp: 5000 },
  ];
  for (const input of bad) await refused(s.addPerson(ADMIN, input, opts()), "VALIDATION_ERROR", JSON.stringify(input));
  assert.deepEqual([await count("staff"), await count("admin_audit_events")], before);
});

test("T7 update: changes bump the revision and audit field NAMES only; a no-op writes nothing; a stale revision changes nothing", { skip }, async () => {
  const p = await newPerson({ phone: "0917 000 0007" });
  const noop = await s.updatePerson(ADMIN, p.id, { expectedRevision: 1, name: p.name, phone: p.phone }, opts());
  assert.equal(noop.revision, 1);
  assert.equal((await audits("STAFF_UPDATED")).filter((a) => a.targetStaffId === p.id).length, 0, "a no-op writes no audit row");
  const changed = await s.updatePerson(ADMIN, p.id, { expectedRevision: 1, name: "Renamed Person", phone: "0917 000 0008" }, opts());
  assert.deepEqual([changed.name, changed.phone, changed.revision], ["Renamed Person", "0917 000 0008", 2]);
  const rows = (await audits("STAFF_UPDATED")).filter((a) => a.targetStaffId === p.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].newValue, "name,phone");
  assert.ok(!JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? String(v) : v)).includes("Renamed"), "no value in the trail");
  const before = await count("admin_audit_events");
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 1, name: "Stale" }, opts()), "VERSION_CONFLICT", "stale");
  assert.equal((await db.staff.findUniqueOrThrow({ where: { id: p.id } })).name, "Renamed Person");
  assert.equal(await count("admin_audit_events"), before);
  await refused(s.updatePerson(ADMIN, randomUUID(), { expectedRevision: 1, name: "Ghost" }, opts()), "NOT_FOUND", "unknown");
});

test("T8 update: a personal percentage and clearing it to the default are audited with basis points", { skip }, async () => {
  const p = await newPerson();
  const a = await s.updatePerson(ADMIN, p.id, { expectedRevision: 1, ratePercent: "15" }, opts());
  assert.equal(a.commissionRateBp, 1500);
  const b = await s.updatePerson(ADMIN, p.id, { expectedRevision: 2, ratePercent: null }, opts());
  assert.equal(b.commissionRateBp, null);
  const rows = (await audits("COMMISSION_RATE_SET")).filter((x) => x.targetStaffId === p.id);
  assert.deepEqual(rows.map((r) => [r.previousValue, r.newValue]), [["DEFAULT", "1500"], ["1500", "DEFAULT"]]);
  // A rate-only change is not a STAFF_UPDATED event.
  assert.equal((await audits("STAFF_UPDATED")).filter((x) => x.targetStaffId === p.id).length, 0);
});

test("T9 update: the email of a person who can sign in is the operator's to change; a person without sign-in can have it set", { skip }, async () => {
  const p = await newPerson();
  const set = await s.updatePerson(ADMIN, p.id, { expectedRevision: 1, email: "now.real@example.test" }, opts());
  assert.equal(set.email, "now.real@example.test");
  await db.staffCredential.create({ data: { staffId: p.id, passwordHash: "x", passwordChangedAt: new Date(), updatedAt: new Date() } });
  const listed = (await s.listTeam(ADMIN, opts())).people.find((x) => x.id === p.id)!;
  assert.equal(listed.canSignIn, true);
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 2, email: "other@example.test" }, opts()), "NOT_ALLOWED", "credential");
  assert.equal((await db.staff.findUniqueOrThrow({ where: { id: p.id } })).email, "now.real@example.test");
});

test("T10 ADMIN and MANAGER accounts accept only a percentage; their name, phone, email, active state and removal are the operator's", { skip }, async () => {
  const before = await db.staff.findUniqueOrThrow({ where: { id: managerRow.id } });
  await refused(s.updatePerson(ADMIN, managerRow.id, { expectedRevision: before.revision, name: "Renamed Manager" }, opts()), "NOT_ALLOWED", "name");
  await refused(s.updatePerson(ADMIN, managerRow.id, { expectedRevision: before.revision, phone: "0917" }, opts()), "NOT_ALLOWED", "phone");
  await refused(s.setPersonActive(ADMIN, managerRow.id, { expectedRevision: before.revision, active: false }, opts()), "NOT_ALLOWED", "deactivate");
  await refused(s.removePerson(ADMIN, managerRow.id, { expectedRevision: before.revision }, opts()), "NOT_ALLOWED", "remove");
  await refused(s.setPersonActive(ADMIN, adminRow.id, { expectedRevision: 1, active: false }, opts()), "NOT_ALLOWED", "yourself");
  const after = await db.staff.findUniqueOrThrow({ where: { id: managerRow.id } });
  assert.deepEqual([after.name, after.isActive, after.revision, after.role], [before.name, true, before.revision, "MANAGER"]);
  const rated = await s.updatePerson(ADMIN, managerRow.id, { expectedRevision: before.revision, ratePercent: "20" }, opts());
  assert.equal(rated.commissionRateBp, 2000);
  assert.equal(rated.name, "Team Manager");
});

test("T11 deactivate and reactivate: sessions are revoked, the revision moves, a repeat is a no-op, and each change is audited once", { skip }, async () => {
  const p = await newPerson();
  const future = new Date(Date.now() + 3_600_000);
  await db.staffSession.create({ data: { tokenHash: sha(), staffId: p.id, credentialGeneration: 1, createdAt: new Date(), lastSeenAt: new Date(), idleExpiresAt: future, expiresAt: future } });
  const off = await s.setPersonActive(ADMIN, p.id, { expectedRevision: 1, active: false }, opts());
  assert.deepEqual([off.isActive, off.revision], [false, 2]);
  const session = await db.staffSession.findFirstOrThrow({ where: { staffId: p.id } });
  assert.equal(session.revokedReason, "DEACTIVATED");
  assert.ok(session.revokedAt);
  const again = await s.setPersonActive(ADMIN, p.id, { expectedRevision: 2, active: false }, opts());
  assert.equal(again.revision, 2);
  const on = await s.setPersonActive(ADMIN, p.id, { expectedRevision: 2, active: true }, opts());
  assert.deepEqual([on.isActive, on.revision], [true, 3]);
  assert.ok((await db.staffSession.findFirstOrThrow({ where: { staffId: p.id } })).revokedAt, "earlier sessions stay revoked");
  const kinds = (await db.adminAuditEvent.findMany({ where: { targetStaffId: p.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
  assert.deepEqual(kinds, ["STAFF_CREATED", "STAFF_DEACTIVATED", "STAFF_REACTIVATED"]);
  await refused(s.setPersonActive(ADMIN, p.id, { expectedRevision: 1, active: false }, opts()), "VERSION_CONFLICT", "stale");
});

test("T12 remove: a person with no history is deleted (the audit row keeps only the name); a person with history is deactivated", { skip }, async () => {
  const fresh = await s.addPerson(ADMIN, { name: "Removed Person Zed" }, opts());
  const gone = await s.removePerson(ADMIN, fresh.id, { expectedRevision: 1 }, opts());
  assert.deepEqual([gone.outcome, gone.person], ["DELETED", null]);
  assert.equal(await count("staff", `id = '${fresh.id}'`), 0);
  const removed = (await audits("STAFF_REMOVED")).filter((a) => a.targetStaffId === fresh.id);
  assert.equal(removed.length, 1);
  assert.deepEqual([removed[0].targetLabel, removed[0].newValue, removed[0].actorStaffId], ["Removed Person Zed", "DELETED", ADMIN.staffId]);
  assert.equal((await audits("STAFF_CREATED")).filter((a) => a.targetStaffId === fresh.id).length, 1, "the creation record outlives the person");

  const used = await newPerson();
  const future = new Date(Date.now() + 3_600_000);
  await db.staffSession.create({ data: { tokenHash: sha(), staffId: used.id, credentialGeneration: 1, createdAt: new Date(), lastSeenAt: new Date(), idleExpiresAt: future, expiresAt: future } });
  const kept = await s.removePerson(ADMIN, used.id, { expectedRevision: 1 }, opts());
  assert.equal(kept.outcome, "DEACTIVATED");
  assert.deepEqual([kept.person?.isActive, kept.person?.revision], [false, 2]);
  assert.equal(await count("staff", `id = '${used.id}'`), 1);
  const rows = (await audits("STAFF_DEACTIVATED")).filter((a) => a.targetStaffId === used.id);
  assert.deepEqual(rows.map((r) => [r.reason, r.targetLabel]), [["Removed: has history", null]]);
  await refused(s.removePerson(ADMIN, randomUUID(), { expectedRevision: 1 }, opts()), "NOT_FOUND", "unknown");
  await refused(s.removePerson(ADMIN, used.id, { expectedRevision: 1 }, opts()), "VERSION_CONFLICT", "stale");
});

test("T13 the list: phones for ADMIN only, default rate and revision, sign-in and history flags, the placeholder email hidden", { skip }, async () => {
  const withHistory = await newPerson();
  const future = new Date(Date.now() + 3_600_000);
  await db.staffSession.create({ data: { tokenHash: sha(), staffId: withHistory.id, credentialGeneration: 1, createdAt: new Date(), lastSeenAt: new Date(), idleExpiresAt: future, expiresAt: future } });
  const clean = await newPerson();
  const team = await s.listTeam(ADMIN, opts());
  assert.deepEqual([team.defaultRateBp, team.settingsRevision], [2000, 1]);
  const byId = new Map(team.people.map((p) => [p.id, p]));
  assert.equal(byId.get(withHistory.id)!.hasHistory, true);
  assert.equal(byId.get(clean.id)!.hasHistory, false);
  assert.equal(byId.get(clean.id)!.email, null);
  assert.equal(byId.get(adminRow.id)!.phone, "09170000001");
  assert.equal(byId.get(adminRow.id)!.role, "ADMIN");
  // Active people first, then by role and name.
  const inactiveAt = team.people.findIndex((p) => !p.isActive);
  assert.ok(team.people.slice(inactiveAt).every((p) => !p.isActive), "inactive people sort last");
});

test("T14 the runtime role has no write privilege on staff or the money tables, cannot read phones or the audit table, and cannot run the internal functions", { skip }, async () => {
  const denied = async (sql: string, label: string) => assert.rejects(app.$executeRawUnsafe(sql), /permission denied|must be owner/i, label);
  await denied(`INSERT INTO staff (id, name, phone, email, role) VALUES ('x', 'x', '', 'x@example.test', 'ADMIN')`, "insert staff");
  await denied(`UPDATE staff SET role = 'ADMIN' WHERE id = '${STAFF.staffId}'`, "promote a detailer");
  await denied(`UPDATE staff SET "isActive" = false WHERE id = '${STAFF.staffId}'`, "deactivate directly");
  await denied(`UPDATE staff SET "commissionRateBp" = 9999 WHERE id = '${STAFF.staffId}'`, "set a rate directly");
  await denied(`DELETE FROM staff WHERE id = '${STAFF.staffId}'`, "delete staff");
  await assert.rejects(app.$queryRawUnsafe(`SELECT phone FROM staff`), /permission denied/i, "read phones");
  await assert.rejects(app.$queryRawUnsafe(`SELECT * FROM admin_audit_events`), /permission denied/i, "read the audit table");
  await denied(`INSERT INTO admin_audit_events (action, "actorStaffId", "targetStaffId", "newValue") VALUES ('STAFF_CREATED', '${ADMIN.staffId}', 'x', 'DEFAULT')`, "write the audit table");
  for (const table of ["commission_settings", "commission_accruals", "commission_entries"]) {
    await app.$queryRawUnsafe(`SELECT count(*) FROM ${table}`);
    await denied(`DELETE FROM ${table}`, `delete ${table}`);
    await denied(`TRUNCATE ${table}`, `truncate ${table}`);
  }
  await denied(`UPDATE commission_settings SET "defaultRateBp" = 5000`, "set the default directly");
  await denied(`INSERT INTO commission_entries ("bookingId", "staffId", "position", "baseCentavos", "rateBp", "amountCentavos") VALUES ('x', 'x', 1, 1, 1, 1)`, "insert an entry");
  await denied(`UPDATE commission_entries SET "paidAt" = now()`, "mark paid directly");
  for (const fn of ["commission_accrue('x')", "commission_consistency_check('x')", "admin_assert_actor('x')", "commission_split(1, ARRAY[1000])"])
    await assert.rejects(app.$queryRawUnsafe(`SELECT ${fn}`), /permission denied/i, fn);
  await assert.rejects(app.$queryRawUnsafe(`SELECT admin_staff_create($1, 'Nope', '', '', NULL::integer)`, STAFF.staffId), /ZT004/, "a detailer actor id is refused inside the function");
});

test("T15 the audit trail is append-only and shaped: owner UPDATE, DELETE and TRUNCATE are rejected; a row with a name in the wrong place is rejected", { skip }, async () => {
  const [row] = await audits();
  await assert.rejects(db.$executeRawUnsafe(`UPDATE admin_audit_events SET reason = 'x' WHERE id = '${row.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM admin_audit_events WHERE id = '${row.id}'`), /append-only/);
  await assert.rejects(db.$executeRawUnsafe(`TRUNCATE admin_audit_events`), /append-only/);
  const shape = (cols: string, vals: string) => db.$executeRawUnsafe(`INSERT INTO admin_audit_events (${cols}) VALUES (${vals})`);
  await assert.rejects(shape(`action, "actorStaffId", "targetStaffId", "targetLabel"`, `'STAFF_CREATED', '${ADMIN.staffId}', '${STAFF.staffId}', 'A Name'`), /admin_audit_shape/);
  await assert.rejects(shape(`action, "actorStaffId", "targetStaffId", "newValue"`, `'STAFF_UPDATED', '${ADMIN.staffId}', '${STAFF.staffId}', 'Maria Santos'`), /admin_audit_shape/);
  await assert.rejects(shape(`action, "actorStaffId", "bookingId", "reason"`, `'COMMISSION_ACCRUAL_FAILED', NULL, 'b', 'duplicate key value violates unique constraint for Maria'`), /admin_audit_shape/);
  await assert.rejects(shape(`action, "actorStaffId", "targetStaffId", "targetLabel", "newValue"`, `'STAFF_REMOVED', '${ADMIN.staffId}', 'gone', '${"n".repeat(81)}', 'DELETED'`), /admin_audit_shape/);
});

test("T16 PII: across every audit row written by this suite, no name, phone or email appears except targetLabel on STAFF_REMOVED", { skip }, async () => {
  const rows = await audits();
  assert.ok(rows.length > 20);
  const named = new Set<string>();
  for (const r of rows) {
    if (r.targetLabel !== null) { assert.equal(r.action, "STAFF_REMOVED"); named.add(r.targetLabel); }
    const copy = { ...r, targetLabel: null } as Record<string, unknown>;
    const text = JSON.stringify(copy, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    for (const pii of ["Synthetic Detailer", "Renamed", "Maria", "Santos", "@example.test", "@staff.invalid", "0917", "Team Admin", "Team Manager", "Team Detailer"])
      assert.ok(!text.includes(pii), `${r.action} row leaked ${pii}`);
  }
  assert.deepEqual([...named], ["Removed Person Zed"], "the removed person's name is the only name stored, and only here");
});

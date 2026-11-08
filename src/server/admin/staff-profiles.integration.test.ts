// P1-64 staff profiles and Remove: every service call runs as the runtime role (zeus_app) against real PostgreSQL with the real migration. Own sibling
// database (<T007 name>_staffp); synthetic data only. Without T007_TEST_DATABASE_URL the tests skip. The flows with bookings and commissions are in
// commissions.integration.test.ts (C35 to C38), which has the booking helpers.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, provisionRuntimeRole, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { StaffActor } from "./context";
import type { AdminServiceError } from "./errors";
import { setAdminEventSink } from "./log";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const spUrl = url ? siblingDatabaseUrl(url, "staffp") : "postgresql://unused@localhost/zeus_t007_unused_staffp";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: spUrl } } }); // owner: fixtures and "even the owner cannot" checks
let app: PrismaClient; // zeus_app
let s: typeof import("./index");
let ADMIN: StaffActor, STAFF: StaffActor, detailerId: string, adminId: string;
const opts = () => ({ db: app });
const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

// Every value is unmistakable, so a leak into a log or an audit row can be searched for.
const FULL = {
  nickname: "Annie-SECRET1", position: "Detailer", contactEmail: "secret2@example.test", address: "SECRET3 Caibaan\nTacloban City", birthDate: "1999-02-14",
  hiredOn: "2025-03-12", emergencyName: "Rosa SECRET4", emergencyPhone: "0917 555 0900", notes: "SECRET5 prefers morning shift.",
};
const EMPTY = { nickname: null, position: null, contactEmail: null, address: null, birthDate: null, hiredOn: null, emergencyName: null, emergencyPhone: null, notes: null };

before(async () => {
  if (skip) return;
  await createAndMigrate(root, spUrl);
  provisionRuntimeRole(spUrl);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(spUrl) } } });
  s = await import("./index");
  const admin = await db.staff.create({ data: { name: "SP Admin", phone: "09170000001", email: "sp-admin@example.test", role: "ADMIN" } });
  const detailer = await db.staff.create({ data: { name: "SP Detailer", phone: "09170000003", email: "sp-detailer@example.test", role: "DETAILER" } });
  adminId = admin.id;
  detailerId = detailer.id;
  ADMIN = { staffId: admin.id, role: "ADMIN", sessionId: randomUUID() };
  STAFF = { staffId: detailer.id, role: "STAFF", sessionId: randomUUID() };
});
after(async () => { setAdminEventSink(() => {}); if (app) await app.$disconnect(); await db.$disconnect(); await root.$disconnect(); });

async function refused(p: Promise<unknown>, code: string, label: string, check?: (e: AdminServiceError) => void) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as AdminServiceError;
    assert.equal(err.code, code, `${label}: ${String((e as Error).message)}`);
    check?.(err);
    return true;
  }, label);
}
const count = async (table: string, where = "TRUE") => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0].n);
const row = (id: string) => db.staff.findUniqueOrThrow({ where: { id } });
let seq = 0;
const newPerson = (extra: Record<string, unknown> = {}) => s.addPerson(ADMIN, { name: `SP Person ${++seq}`, phone: "0917 111 2222", ...extra }, opts());
// A session row points at the person, so they have history. This is the T12 way of making history without a booking.
async function giveHistory(staffId: string) {
  const future = new Date(Date.now() + 3_600_000);
  await db.staffSession.create({ data: { tokenHash: sha(), staffId, credentialGeneration: 1, createdAt: new Date(), lastSeenAt: new Date(), idleExpiresAt: future, expiresAt: future } });
}

test("SP1 STAFF is refused for every profile and Remove operation, and nothing is written", { skip }, async () => {
  const before = [await count("staff"), await count("staff_profiles"), await count("admin_audit_events")];
  const id = randomUUID();
  await refused(s.getPerson(STAFF, id, opts()), "FORBIDDEN", "read");
  await refused(s.removePreview(STAFF, id, opts()), "FORBIDDEN", "preview");
  await refused(s.updatePerson(STAFF, id, { expectedRevision: 1, profile: EMPTY }, opts()), "FORBIDDEN", "save");
  await refused(s.addPerson(STAFF, { name: "Nobody", profile: EMPTY }, opts()), "FORBIDDEN", "add");
  await refused(s.removePerson(STAFF, id, { expectedRevision: 1 }, opts()), "FORBIDDEN", "remove");
  assert.deepEqual([await count("staff"), await count("staff_profiles"), await count("admin_audit_events")], before);
});

test("SP2 the database repeats the check: a detailer's id claiming ADMIN is refused by every function", { skip }, async () => {
  const claim: StaffActor = { ...STAFF, role: "ADMIN" };
  const p = await newPerson();
  await refused(s.getPerson(claim, p.id, opts()), "FORBIDDEN", "read");
  await refused(s.updatePerson(claim, p.id, { expectedRevision: 1, profile: FULL }, opts()), "FORBIDDEN", "save");
  await refused(s.addPerson(claim, { name: "Nobody" }, opts()), "FORBIDDEN", "add");
  await refused(s.removePerson(claim, p.id, { expectedRevision: 1 }, opts()), "FORBIDDEN", "remove");
  assert.equal(await count("staff_profiles", `"staffId" = '${p.id}'`), 0);
  assert.equal((await row(p.id)).revision, 1);
});

test("SP3 save and read: every detail round trips, the Team list carries the summary, a no-change save writes nothing, blanks clear, a stale revision changes nothing", { skip }, async () => {
  const p = await newPerson();
  assert.deepEqual((await s.getPerson(ADMIN, p.id, opts())).profile, EMPTY, "a new person has no details yet");

  const saved = await s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: FULL }, opts());
  assert.equal(saved.revision, 2);
  const read = await s.getPerson(ADMIN, p.id, opts());
  assert.deepEqual(read.profile, { ...FULL, contactEmail: "secret2@example.test" });
  assert.equal(read.person.id, p.id);
  const listed = (await s.listTeam(ADMIN, opts())).people.find((x) => x.id === p.id)!;
  assert.deepEqual([listed.nickname, listed.position, listed.hiredOn], ["Annie-SECRET1", "Detailer", "2025-03-12"]);

  const auditCount = await count("admin_audit_events", `"targetStaffId" = '${p.id}'`);
  const same = await s.updatePerson(ADMIN, p.id, { expectedRevision: 2, profile: FULL }, opts());
  assert.equal(same.revision, 2, "no change, no new revision");
  assert.equal(await count("admin_audit_events", `"targetStaffId" = '${p.id}'`), auditCount, "no change, no audit row");

  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: EMPTY }, opts()), "VERSION_CONFLICT", "stale");
  assert.equal((await s.getPerson(ADMIN, p.id, opts())).profile.nickname, "Annie-SECRET1");

  // Name, phone and rate in the same save, one transaction.
  const both = await s.updatePerson(ADMIN, p.id, { expectedRevision: 2, name: "SP Renamed", ratePercent: "12.5", profile: { ...FULL, nickname: "Blank-Later" } }, opts());
  assert.deepEqual([both.name, both.commissionRateBp, both.nickname, both.revision], ["SP Renamed", 1250, "Blank-Later", 4]);

  const cleared = await s.updatePerson(ADMIN, p.id, { expectedRevision: 4, profile: { ...EMPTY, nickname: "", address: "   ", contactEmail: "", emergencyPhone: "" } }, opts());
  assert.equal(cleared.nickname, null);
  assert.deepEqual((await s.getPerson(ADMIN, p.id, opts())).profile, EMPTY, "blank and null both clear");
});

test("SP4 bad details are refused with nothing written: Zod for shape, the database for the dates that depend on today", { skip }, async () => {
  const p = await newPerson();
  const bad: Record<string, unknown>[] = [
    { ...EMPTY, nickname: "x".repeat(41) }, { ...EMPTY, position: "x".repeat(41) }, { ...EMPTY, nickname: "Line\nBreak" }, { ...EMPTY, contactEmail: "not-an-email" },
    { ...EMPTY, address: "x".repeat(301) }, { ...EMPTY, notes: "x".repeat(1001) }, { ...EMPTY, notes: "bell\u0007" }, { ...EMPTY, emergencyName: "x".repeat(81) },
    { ...EMPTY, emergencyPhone: "abc" }, { ...EMPTY, birthDate: "14 Feb 1999" }, { ...EMPTY, hiredOn: "2025-13-01" }, { ...EMPTY, role: "ADMIN" }, { nickname: "missing keys" },
  ];
  for (const profile of bad) await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile }, opts()), "VALIDATION_ERROR", JSON.stringify(profile).slice(0, 60));
  const year = new Date().getUTCFullYear();
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: { ...EMPTY, birthDate: `${year - 5}-01-01` } }, opts()), "VALIDATION_ERROR", "a child", (e) => assert.match(JSON.stringify(e), /birthDate/));
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: { ...EMPTY, birthDate: "1899-12-31" } }, opts()), "VALIDATION_ERROR", "too old", (e) => assert.match(JSON.stringify(e), /birthDate/));
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: { ...EMPTY, hiredOn: `${year + 2}-01-01` } }, opts()), "VALIDATION_ERROR", "hired far ahead", (e) => assert.match(JSON.stringify(e), /hiredOn/));
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: { ...EMPTY, hiredOn: "1989-12-31" } }, opts()), "VALIDATION_ERROR", "hired too long ago", (e) => assert.match(JSON.stringify(e), /hiredOn/));
  // Line breaks are fine in the two long fields.
  await s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: { ...EMPTY, address: "Line one\nLine two", notes: "A\nB" } }, opts());
  assert.equal((await s.getPerson(ADMIN, p.id, opts())).profile.address, "Line one\nLine two");
});

test("SP5 add with a browser-made id: a retry returns the same person, different content is refused, four at once make one row, and details can come with it", { skip }, async () => {
  const id = randomUUID();
  const body = { id, name: "SP Retry", phone: "0917 000 1111", ratePercent: "15" };
  const first = await s.addPerson(ADMIN, body, opts());
  assert.equal(first.id, id);
  const again = await s.addPerson(ADMIN, body, opts());
  assert.equal(again.id, id);
  assert.equal(await count("staff", `id = '${id}'`), 1);
  assert.equal(await count("admin_audit_events", `"targetStaffId" = '${id}' AND action = 'STAFF_CREATED'`), 1, "one audit row");
  await refused(s.addPerson(ADMIN, { ...body, name: "SP Other" }, opts()), "VALIDATION_ERROR", "same id, other content");
  await refused(s.addPerson(ADMIN, { ...body, phone: "0917 999 9999" }, opts()), "VALIDATION_ERROR", "same id, other phone");

  const race = randomUUID();
  const raced = await Promise.all([1, 2, 3, 4].map(() => s.addPerson(ADMIN, { id: race, name: "SP Race" }, opts())));
  assert.deepEqual(new Set(raced.map((r) => r.id)), new Set([race]));
  assert.equal(await count("staff", `id = '${race}'`), 1, "four at once make one row");
  assert.equal(await count("admin_audit_events", `"targetStaffId" = '${race}' AND action = 'STAFF_CREATED'`), 1);

  const withDetails = await s.addPerson(ADMIN, { id: randomUUID(), name: "SP Details", profile: FULL }, opts());
  assert.equal((await s.getPerson(ADMIN, withDetails.id, opts())).profile.notes, FULL.notes);
  const noId = await s.addPerson(ADMIN, { name: "SP No Id" }, opts());
  assert.match(noId.id, /^[0-9a-f-]{36}$/, "the older screen sends no id; the server makes one");
  await refused(s.addPerson(ADMIN, { id: "not-a-uuid", name: "SP Bad" }, opts()), "VALIDATION_ERROR", "not a uuid");
});

test("SP6 the runtime role can touch no profile directly, cannot read the hidden column, and cannot run the guard", { skip }, async () => {
  const denied = /permission denied/;
  await assert.rejects(app.$queryRawUnsafe(`SELECT * FROM staff_profiles`), denied);
  await assert.rejects(app.$executeRawUnsafe(`INSERT INTO staff_profiles ("staffId") VALUES ('${detailerId}')`), denied);
  await assert.rejects(app.$executeRawUnsafe(`UPDATE staff_profiles SET notes = 'x'`), denied);
  await assert.rejects(app.$executeRawUnsafe(`DELETE FROM staff_profiles`), denied);
  await assert.rejects(app.$executeRawUnsafe(`TRUNCATE staff_profiles`), denied);
  await assert.rejects(app.$queryRawUnsafe(`SELECT "removedAt" FROM staff`), denied);
  await assert.rejects(app.$queryRawUnsafe(`SELECT phone FROM staff`), denied);
  await assert.rejects(app.$executeRawUnsafe(`UPDATE staff SET "removedAt" = now()`), denied);
  await assert.rejects(app.$queryRawUnsafe(`SELECT guard_removed_staff()`), denied);
});

test("SP7 the Team list is staff names only in the database itself; the admin's profile cannot be read or set", { skip }, async () => {
  const rows = await app.$queryRawUnsafe<{ id: string; role: string }[]>(`SELECT id, role FROM admin_team_list_v2('${adminId}')`);
  assert.ok(rows.length > 0 && rows.every((r) => r.role === "DETAILER"));
  assert.ok(!rows.some((r) => r.id === adminId));
  await refused(s.getPerson(ADMIN, adminId, opts()), "NOT_ALLOWED", "read the admin");
  await refused(s.updatePerson(ADMIN, adminId, { expectedRevision: 1, profile: FULL }, opts()), "NOT_ALLOWED", "set the admin");
  await refused(s.removePerson(ADMIN, adminId, { expectedRevision: 1 }, opts()), "NOT_ALLOWED", "remove the admin");
  assert.equal(await count("staff_profiles", `"staffId" = '${adminId}'`), 0);
});

test("SP8 Remove, a person nothing points at: details and row are gone, the name stays only in the audit row, and a retry gets the same answer", { skip }, async () => {
  const p = await newPerson({ profile: FULL, name: "SP Never Used" });
  const gone = await s.removePerson(ADMIN, p.id, { expectedRevision: p.revision }, opts());
  assert.deepEqual(gone, { outcome: "DELETED", takenOff: [] });
  assert.equal(await count("staff", `id = '${p.id}'`), 0);
  assert.equal(await count("staff_profiles", `"staffId" = '${p.id}'`), 0);
  const audit = await db.adminAuditEvent.findMany({ where: { targetStaffId: p.id, action: "STAFF_REMOVED" } });
  assert.deepEqual(audit.map((a) => [a.targetLabel, a.newValue]), [["SP Never Used", "DELETED"]]);
  const retry = await s.removePerson(ADMIN, p.id, { expectedRevision: p.revision }, opts());
  assert.equal(retry.outcome, "DELETED", "a lost response retried is the same answer");
  assert.equal(await count("admin_audit_events", `"targetStaffId" = '${p.id}' AND action = 'STAFF_REMOVED'`), 1, "no second audit row");
  await refused(s.removePerson(ADMIN, randomUUID(), { expectedRevision: 1 }, opts()), "NOT_FOUND", "someone who never existed");
});

test("SP9 Remove, a person with history: hidden for good, name kept, everything personal erased, sessions stopped; retry and stale behave", { skip }, async () => {
  const p = await newPerson({ name: "SP Has History", profile: FULL });
  await giveHistory(p.id);
  await db.staffCredential.create({ data: { staffId: p.id, passwordHash: sha(), passwordChangedAt: new Date(), updatedAt: new Date() } });
  assert.equal(await count("staff_credentials", `"staffId" = '${p.id}'`), 1);
  await refused(s.removePerson(ADMIN, p.id, { expectedRevision: 1 }, opts()), "VERSION_CONFLICT", "stale revision");
  assert.equal((await row(p.id)).removedAt, null, "a refusal changes nothing");

  const r = await s.removePerson(ADMIN, p.id, { expectedRevision: p.revision }, opts());
  assert.deepEqual(r, { outcome: "REMOVED", takenOff: [] });
  const after = await row(p.id);
  assert.equal(after.name, "SP Has History", "the name stays for history");
  assert.equal(after.phone, "", "the phone is erased");
  assert.equal(after.email, `removed-${p.id.replace(/-/g, "")}@staff.invalid`, "the email is a placeholder");
  assert.equal(after.isActive, false);
  assert.ok(after.removedAt);
  assert.equal(await count("staff_profiles", `"staffId" = '${p.id}'`), 0, "the details are erased");
  assert.equal(await count("staff_credentials", `"staffId" = '${p.id}'`), 0, "credentials are erased");
  assert.equal(await count("staff_sessions", `"staffId" = '${p.id}' AND "revokedAt" IS NULL`), 0, "sessions are stopped");
  const audit = await db.adminAuditEvent.findMany({ where: { targetStaffId: p.id, action: "STAFF_DEACTIVATED" } });
  assert.deepEqual(audit.map((a) => [a.reason, a.targetLabel]), [["Removed: personal details erased", null]]);

  assert.ok(!(await s.listTeam(ADMIN, opts())).people.some((x) => x.id === p.id), "not on the Team");
  await refused(s.getPerson(ADMIN, p.id, opts()), "NOT_FOUND", "details");
  await refused(s.removePreview(ADMIN, p.id, opts()), "NOT_FOUND", "preview");
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: after.revision, name: "Back Again" }, opts()), "NOT_FOUND", "the older edit function");
  await refused(s.updatePerson(ADMIN, p.id, { expectedRevision: after.revision, profile: FULL }, opts()), "NOT_FOUND", "edit details");

  const retry = await s.removePerson(ADMIN, p.id, { expectedRevision: p.revision }, opts());
  assert.equal(retry.outcome, "REMOVED", "the first call moved the revision; a retry carrying the old one is the same answer");
  assert.equal(await count("admin_audit_events", `"targetStaffId" = '${p.id}' AND action = 'STAFF_DEACTIVATED'`), 1, "no second audit row");
});

test("SP10 whatever points at a person keeps the row hidden: supplies count too, without a list in the function", { skip }, async () => {
  const byAudit = await newPerson({ name: "SP Supply Audit" }), byMove = await newPerson({ name: "SP Supply Move" }), clean = await newPerson({ name: "SP Clean" });
  await db.$executeRawUnsafe(`INSERT INTO supply_audit_events (action, "actorStaffId", "targetSupplyId") VALUES ('SUPPLY_CREATED', '${byAudit.id}', 'x')`);
  const item = randomUUID();
  await s.addSupply(ADMIN, { id: item, name: "SP Wax", unit: "bottle", reorderLevel: 0, costPesos: "1" }, opts());
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`INSERT INTO supply_movements ("itemId", kind, delta, "stockAfter", "actorStaffId") VALUES ('${item}', 'RECEIVE', 1, 1, '${byMove.id}')`);
    await tx.$executeRawUnsafe(`UPDATE supply_items SET "currentStock" = 1 WHERE id = '${item}'`);
  });
  assert.equal((await s.removePerson(ADMIN, byAudit.id, { expectedRevision: 1 }, opts())).outcome, "REMOVED", "a supply audit row points at them");
  assert.equal((await s.removePerson(ADMIN, byMove.id, { expectedRevision: 1 }, opts())).outcome, "REMOVED", "a stock movement points at them");
  assert.equal((await s.removePerson(ADMIN, clean.id, { expectedRevision: 1 }, opts())).outcome, "DELETED", "the same function deletes someone nothing points at");
  const moved = await s.listMovements(ADMIN, item, {}, opts());
  assert.equal(moved.movements[0].actorName, "SP Supply Move", "the supplies history keeps the name");
  // The decision is the foreign key's own, so a table added later (expenses, for one) is covered by adding its RESTRICT foreign key.
  const src = fs.readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261108000000_staff_profiles", "migration.sql"), "utf8");
  const body = src.slice(src.indexOf("CREATE FUNCTION admin_staff_remove_v2"), src.indexOf("-- 8. Privileges"));
  assert.doesNotMatch(body, /supply_|commission_|expense/, "the remove function names no history table");
  assert.match(body, /EXCEPTION WHEN foreign_key_violation OR restrict_violation/);
});

test("SP11 a removed row is final, even for the owner and the operator CLI's own statement", { skip }, async () => {
  const p = await newPerson();
  await giveHistory(p.id);
  await s.removePerson(ADMIN, p.id, { expectedRevision: 1 }, opts());
  await assert.rejects(db.$executeRawUnsafe(`UPDATE staff SET "isActive" = true WHERE id = '${p.id}'`), /This person was removed/);
  await assert.rejects(db.$executeRawUnsafe(`UPDATE staff SET name = 'Changed' WHERE id = '${p.id}'`), /This person was removed/);
  const other = await newPerson();
  await assert.rejects(db.$executeRawUnsafe(`UPDATE staff SET "removedAt" = now() WHERE id = '${other.id}'`), /staff_removed_is_inactive/, "hidden must also be inactive");
});

test("SP12 a person made inactive before this change stays listed, so Remove can clear them", { skip }, async () => {
  const p = await newPerson();
  await db.staff.update({ where: { id: p.id }, data: { isActive: false, revision: 2 } });
  const listed = (await s.listTeam(ADMIN, opts())).people.find((x) => x.id === p.id)!;
  assert.equal(listed.isActive, false);
  assert.equal((await s.removePerson(ADMIN, p.id, { expectedRevision: 2 }, opts())).outcome, "DELETED", "nothing points at them, so inactive or not they are really gone");
  const used = await newPerson();
  await giveHistory(used.id);
  await db.staff.update({ where: { id: used.id }, data: { isActive: false, revision: 2 } });
  assert.equal((await s.removePerson(ADMIN, used.id, { expectedRevision: 2 }, opts())).outcome, "REMOVED", "with history they are hidden, and leave the list");
  assert.ok(!(await s.listTeam(ADMIN, opts())).people.some((x) => x.id === used.id));
});

test("SP13 privacy: no detail reaches an audit row or a log event, and only the admin Team code names the table or the fields", { skip }, async () => {
  const events: unknown[] = [];
  setAdminEventSink((name, fields) => events.push([name, fields]));
  const p = await newPerson({ name: "SP Private" });
  const saved = await s.updatePerson(ADMIN, p.id, { expectedRevision: 1, profile: FULL }, opts());
  await s.getPerson(ADMIN, p.id, opts());
  await s.removePreview(ADMIN, p.id, opts());
  await s.removePerson(ADMIN, p.id, { expectedRevision: saved.revision }, opts());
  setAdminEventSink(() => {});
  const secrets = /SECRET\d|secret2@|Annie|Rosa|0917 555 0900|1999-02-14|2025-03-12|SP Private/;
  assert.ok(events.length >= 3, "events were captured");
  assert.doesNotMatch(JSON.stringify(events), secrets, "log events carry ids only");
  const audit = await db.adminAuditEvent.findMany({ where: { targetStaffId: p.id } });
  const edit = audit.filter((a) => a.action === "STAFF_UPDATED");
  assert.deepEqual(edit.map((a) => a.newValue), ["profile"], "the audit row holds the word only");
  const withoutLabel = audit.filter((a) => a.action !== "STAFF_REMOVED");
  assert.doesNotMatch(JSON.stringify(withoutLabel, (_k, v) => (typeof v === "bigint" ? String(v) : v)), secrets, "no value in any audit row");

  // Nothing outside the admin Team code can even name these. A public or customer path that started to would fail here.
  const allowed = /(?:server[\\/]admin[\\/](?:team|staff-profile|runtime-role\.integration)|components[\\/]admin[\\/]team[\\/]|lib[\\/]admin-validation|types[\\/]admin-contracts|app[\\/]api[\\/]admin[\\/]team[\\/])/;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && !allowed.test(f) && /staff_profiles|admin_staff_profile|emergencyName|emergencyPhone|contactEmail/.test(fs.readFileSync(f, "utf8"))) hits.push(f);
    }
  };
  walk(path.join(process.cwd(), "src"));
  assert.deepEqual(hits, []);
});

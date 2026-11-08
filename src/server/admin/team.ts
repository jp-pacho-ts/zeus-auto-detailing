import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { AdminStaffProfile, AdminTeam, AdminTeamPerson, AdminTeamPersonDetail, AdminTeamRemoveOutcome, AdminTeamRemovePreview } from "@/types/admin-contracts";
import { AdminIdSchema, type StaffProfileSchema, TeamCreateSchema, TeamRemoveSchema, TeamUpdateSchema } from "@/lib/admin-validation";
import { percentToBasisPoints, safeCentavos } from "@/lib/commission";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import { loadForWrite, mutate } from "./mutation";
import { takeOff } from "./workers-write";

// P1-37: the Team screen. ADMIN only, enforced here and again inside every database function. The app role has no
// write privilege on staff: each write is an owner-run SECURITY DEFINER function that re-checks the actor, takes the
// shop lock, validates, writes the row and its audit row together, and returns an error code this file maps to a plain
// message. Only DETAILER people can be added, edited, deactivated or removed (ADMIN and MANAGER accounts, their
// passwords and role changes stay with the operator CLI, ADR-003); an ADMIN or MANAGER row accepts only a rate.
// Names, phones and emails are never logged.

interface TeamRow {
  id: string; name: string; phone: string; email: string; role: string; isActive: boolean; commissionRateBp: number | null;
  hasCredential: boolean; openJobs: number; hasHistory: boolean; revision: number; createdAt: Date;
  nickname: string | null; position: string | null; hiredOn: string | null;
}
interface SettingsRow { defaultRateBp: number; revision: number }

// A function declaration, not a generic arrow: the test loader parses .ts files with JSX on.
function read<T>(options: AdminOptions, work: (tx: StaffTx) => Promise<T>): Promise<T> {
  return withStaffDb("STAFF_READ", work, { access: "read", db: options.db, signal: options.signal });
}

function mapTeamError(error: unknown): never {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("ZT001")) throw new AdminServiceError("NOT_FOUND");
  if (text.includes("ZT002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed this person. Reload the list and try again.");
  if (text.includes("ZT003")) throw new AdminServiceError("NOT_ALLOWED", "Only the operator can change that account.");
  if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
  if (text.includes("ZT005")) throw new AdminServiceError("NOT_ALLOWED", "This person still has open jobs. Move or finish them first.");
  if (text.includes("ZT006")) throw new AdminServiceError("VALIDATION_ERROR");
  if (text.includes("ZT007")) throw fieldError("email", "That email is already used.");
  if (text.includes("ZT008")) throw new AdminServiceError("NOT_ALLOWED", "You can't change your own account.");
  if (text.includes("ZT009")) throw new AdminServiceError("NOT_FOUND"); // removed: a name on history, no longer a person on the Team
  if (text.includes("ZT010")) throw fieldError("birthDate", "Enter a real birth date. Staff must be at least 14.");
  if (text.includes("ZT011")) throw fieldError("hiredOn", "Enter a real date hired, no more than a year ahead.");
  throw error;
}

const toPerson = (r: TeamRow): AdminTeamPerson => ({
  id: r.id, name: r.name, phone: r.phone,
  email: r.email.endsWith("@staff.invalid") ? null : r.email, // the placeholder for a person added without an email
  role: r.role as AdminTeamPerson["role"], isActive: r.isActive, commissionRateBp: r.commissionRateBp,
  canSignIn: r.hasCredential, openJobs: Number(r.openJobs), hasHistory: r.hasHistory, revision: Number(r.revision), createdAt: r.createdAt.toISOString(),
  nickname: r.nickname, position: r.position, hiredOn: r.hiredOn,
});

// P1-61 (LE 2026-11-07): the Team holds the staff names the admin typed and nothing else. The admin and any manager account are never
// staff here: they are not listed, cannot be found by id, and (see workers-write.ts) cannot be assigned to a booking or credited.
async function teamRows(tx: StaffTx, actor: StaffActor): Promise<TeamRow[]> {
  try { return await tx.$queryRaw<TeamRow[]>`SELECT * FROM admin_team_list_v2(${actor.staffId})`; } catch (error) { return mapTeamError(error); }
}
async function settings(tx: StaffTx): Promise<SettingsRow> {
  const [row] = await tx.$queryRaw<SettingsRow[]>`SELECT "defaultRateBp", revision FROM commission_settings WHERE id = 1`;
  return { defaultRateBp: Number(row.defaultRateBp), revision: Number(row.revision) };
}
// P1-61: nothing on the Team screen can change the admin or a manager account, not even a commission percentage: they are not staff and
// are never credited. An unknown id is left to the database function to report as not found.
async function staffNameOnly(tx: StaffTx, actor: StaffActor, id: string): Promise<void> {
  let all: { id: string; role: string }[];
  try { all = await tx.$queryRaw<{ id: string; role: string }[]>`SELECT id, role::text AS role FROM admin_team_list(${actor.staffId})`; } catch (error) { return mapTeamError(error); }
  const row = all.find((r) => r.id === id);
  if (row && row.role !== "DETAILER") throw new AdminServiceError("NOT_ALLOWED", "Only staff names can be changed here.");
}
async function personOrThrow(tx: StaffTx, actor: StaffActor, id: string): Promise<AdminTeamPerson> {
  const row = (await teamRows(tx, actor)).find((r) => r.id === id);
  if (!row) throw new AdminServiceError("NOT_FOUND");
  return toPerson(row);
}
// A percentage string to basis points. The schema already refused anything else, so null here is a defect.
const bp = (percent: string): number => {
  const value = percentToBasisPoints(percent);
  if (value === null) throw new AdminServiceError("VALIDATION_ERROR");
  return value;
};

export async function listTeam(actor: StaffActor, options: AdminOptions = {}): Promise<AdminTeam> {
  authorize(actor, "TEAM_READ");
  return read(options, async (tx) => {
    const people = (await teamRows(tx, actor)).map(toPerson);
    const s = await settings(tx);
    return { people, defaultRateBp: s.defaultRateBp, settingsRevision: s.revision };
  });
}

// P1-64: one person's details, for the admin. Never logged, and read only through the owner-run function.
export async function getPerson(actor: StaffActor, id: unknown, options: AdminOptions = {}): Promise<AdminTeamPersonDetail> {
  authorize(actor, "TEAM_READ");
  const staffId = parse(AdminIdSchema, id);
  return read(options, async (tx) => {
    let profile: AdminStaffProfile;
    try {
      const [row] = await tx.$queryRaw<{ r: AdminStaffProfile }[]>`SELECT admin_staff_profile_get(${actor.staffId}, ${staffId}) AS r`;
      profile = row.r;
    } catch (error) { return mapTeamError(error); }
    return { person: await personOrThrow(tx, actor, staffId), profile };
  });
}

// "Set these values", in the caller's transaction. Returns whether anything changed.
async function writeProfile(tx: StaffTx, actor: StaffActor, staffId: string, revision: number, p: z.output<typeof StaffProfileSchema>): Promise<boolean> {
  try {
    const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_staff_profile_set(${actor.staffId}, ${staffId}, ${revision}::integer, ${p.nickname}::text, ${p.position}::text, ${p.contactEmail}::text, ${p.address}::text, ${p.birthDate}::date, ${p.hiredOn}::date, ${p.emergencyName}::text, ${p.emergencyPhone}::text, ${p.notes}::text) AS r`;
    return row.r.changed;
  } catch (error) { return mapTeamError(error); }
}

export async function addPerson(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminTeamPerson> {
  authorize(actor, "TEAM_WRITE");
  const v = parse(TeamCreateSchema, input);
  const rate = v.ratePercent == null ? null : bp(v.ratePercent);
  const id = v.id ?? randomUUID();
  return mutate(options, "team_add", async (tx) => {
    let made: { revision: number; replayed: boolean };
    try {
      const [row] = await tx.$queryRaw<{ r: { revision: number; replayed: boolean } }[]>`SELECT admin_staff_create_v2(${actor.staffId}, ${id}, ${v.name}, ${v.phone ?? ""}, ${v.email ?? ""}, ${rate}::integer) AS r`;
      made = row.r;
    } catch (error) { return mapTeamError(error); }
    // A retry already wrote its details the first time.
    if (v.profile && !made.replayed) await writeProfile(tx, actor, id, made.revision, v.profile);
    adminEvent("admin.team.created", { actorStaffId: actor.staffId, targetStaffId: id, replayed: made.replayed });
    return personOrThrow(tx, actor, id);
  });
}

export async function updatePerson(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminTeamPerson> {
  authorize(actor, "TEAM_WRITE");
  const staffId = parse(AdminIdSchema, id), v = parse(TeamUpdateSchema, input);
  // Absent = leave alone, null = use the default, text = a personal percentage.
  const mode = v.ratePercent === undefined ? "KEEP" : v.ratePercent === null ? "DEFAULT" : "SET";
  const rate = v.ratePercent == null ? null : bp(v.ratePercent);
  return mutate(options, "team_update", async (tx) => {
    await staffNameOnly(tx, actor, staffId);
    let changed: boolean, revision: number;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean; revision: number } }[]>`SELECT admin_staff_update(${actor.staffId}, ${staffId}, ${v.name ?? null}, ${v.phone ?? null}, ${v.email ?? null}, ${mode}, ${rate}::integer, ${v.expectedRevision}::integer) AS r`;
      changed = row.r.changed;
      revision = row.r.revision;
    } catch (error) { return mapTeamError(error); }
    if (v.profile && (await writeProfile(tx, actor, staffId, revision, v.profile))) changed = true;
    adminEvent("admin.team.updated", { actorStaffId: actor.staffId, targetStaffId: staffId, changed });
    return personOrThrow(tx, actor, staffId);
  });
}


const OPEN_JOBS = (tx: StaffTx, staffId: string) => tx.$queryRaw<{ id: string; referenceCode: string; revision: number }[]>`
  SELECT b.id, b."referenceCode", b.revision FROM booking_worker_assignments w JOIN bookings b ON b.id = w."bookingId"
  WHERE w."staffId" = ${staffId} AND b.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS') ORDER BY b."bookingDate", b."referenceCode", b.id`;

// P1-64: what Remove will do, shown before the admin confirms. Unpaid is the Commissions screen's own sum (earned minus paid, adjustments included).
export async function removePreview(actor: StaffActor, id: unknown, options: AdminOptions = {}): Promise<AdminTeamRemovePreview> {
  authorize(actor, "TEAM_READ");
  const staffId = parse(AdminIdSchema, id);
  return read(options, async (tx) => {
    await personOrThrow(tx, actor, staffId);
    const open = await OPEN_JOBS(tx, staffId);
    const [unpaid] = await tx.$queryRaw<{ amount: bigint; jobs: number }[]>`
      SELECT (COALESCE(sum(e."amountCentavos") FILTER (WHERE e."paidAt" IS NULL), 0) + COALESCE(sum(adj.unpaid), 0))::bigint AS amount,
        (count(*) FILTER (WHERE e."paidAt" IS NULL OR adj.unpaid IS NOT NULL))::integer AS jobs
      FROM commission_entries e
      LEFT JOIN LATERAL (SELECT sum(x."amountCentavos") FILTER (WHERE x."paidAt" IS NULL) AS unpaid FROM commission_adjustments x WHERE x."entryId" = e.id) adj ON true
      WHERE e."staffId" = ${staffId}`;
    return { openJobs: open.map((b) => ({ bookingId: b.id, referenceCode: b.referenceCode })), unpaidCentavos: safeCentavos(unpaid.amount), unpaidJobs: Number(unpaid.jobs) };
  });
}

// P1-64: Remove always works. In one transaction the person comes off their open jobs (each with its revision and audit row, and they earn nothing on
// them) and is then erased or hidden. Commission already earned is not touched. Any failure undoes all of it.
export async function removePerson(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<{ outcome: AdminTeamRemoveOutcome; takenOff: string[] }> {
  authorize(actor, "TEAM_WRITE");
  const staffId = parse(AdminIdSchema, id), v = parse(TeamRemoveSchema, input);
  return mutate(options, "team_remove", async (tx) => {
    await staffNameOnly(tx, actor, staffId);
    const open = await OPEN_JOBS(tx, staffId);
    for (const job of open) {
      await loadForWrite(tx, job.id, Number(job.revision)); // its date lock, as every board write takes
      await takeOff(tx, actor, job.id, staffId, Number(job.revision));
    }
    let outcome: AdminTeamRemoveOutcome;
    try {
      const [row] = await tx.$queryRaw<{ r: AdminTeamRemoveOutcome }[]>`SELECT admin_staff_remove_v2(${actor.staffId}, ${staffId}, ${v.expectedRevision}::integer) AS r`;
      outcome = row.r;
    } catch (error) { return mapTeamError(error); }
    adminEvent("admin.team.removed", { actorStaffId: actor.staffId, targetStaffId: staffId, outcome, takenOff: open.length });
    return { outcome, takenOff: open.map((b) => b.referenceCode) };
  });
}

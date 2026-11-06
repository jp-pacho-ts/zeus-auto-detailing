import "server-only";
import type { AdminTeam, AdminTeamPerson, AdminTeamRemoveOutcome } from "@/types/admin-contracts";
import { AdminIdSchema, TeamActiveSchema, TeamCreateSchema, TeamRemoveSchema, TeamUpdateSchema } from "@/lib/admin-validation";
import { percentToBasisPoints } from "@/lib/commission";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import { mutate } from "./mutation";

// P1-37: the Team screen. ADMIN only, enforced here and again inside every database function. The app role has no
// write privilege on staff: each write is an owner-run SECURITY DEFINER function that re-checks the actor, takes the
// shop lock, validates, writes the row and its audit row together, and returns an error code this file maps to a plain
// message. Only DETAILER people can be added, edited, deactivated or removed (ADMIN and MANAGER accounts, their
// passwords and role changes stay with the operator CLI, ADR-003); an ADMIN or MANAGER row accepts only a rate.
// Names, phones and emails are never logged.

interface TeamRow {
  id: string; name: string; phone: string; email: string; role: string; isActive: boolean; commissionRateBp: number | null;
  hasCredential: boolean; openJobs: number; hasHistory: boolean; revision: number; createdAt: Date;
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
  throw error;
}

const toPerson = (r: TeamRow): AdminTeamPerson => ({
  id: r.id, name: r.name, phone: r.phone,
  email: r.email.endsWith("@staff.invalid") ? null : r.email, // the placeholder for a person added without an email
  role: r.role as AdminTeamPerson["role"], isActive: r.isActive, commissionRateBp: r.commissionRateBp,
  canSignIn: r.hasCredential, openJobs: Number(r.openJobs), hasHistory: r.hasHistory, revision: Number(r.revision), createdAt: r.createdAt.toISOString(),
});

// P1-61 (LE 2026-11-07): the Team holds the staff names the admin typed and nothing else. The admin and any manager account are never
// staff here: they are not listed, cannot be found by id, and (see workers-write.ts) cannot be assigned to a booking or credited.
async function teamRows(tx: StaffTx, actor: StaffActor): Promise<TeamRow[]> {
  try { return (await tx.$queryRaw<TeamRow[]>`SELECT * FROM admin_team_list(${actor.staffId})`).filter((r) => r.role === "DETAILER"); } catch (error) { return mapTeamError(error); }
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

export async function addPerson(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminTeamPerson> {
  authorize(actor, "TEAM_WRITE");
  const v = parse(TeamCreateSchema, input);
  const rate = v.ratePercent == null ? null : bp(v.ratePercent);
  return mutate(options, "team_add", async (tx) => {
    let id: string;
    try {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT admin_staff_create(${actor.staffId}, ${v.name}, ${v.phone ?? ""}, ${v.email ?? ""}, ${rate}::integer) AS id`;
      id = row.id;
    } catch (error) { return mapTeamError(error); }
    adminEvent("admin.team.created", { actorStaffId: actor.staffId, targetStaffId: id });
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
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_staff_update(${actor.staffId}, ${staffId}, ${v.name ?? null}, ${v.phone ?? null}, ${v.email ?? null}, ${mode}, ${rate}::integer, ${v.expectedRevision}::integer) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapTeamError(error); }
    adminEvent("admin.team.updated", { actorStaffId: actor.staffId, targetStaffId: staffId, changed });
    return personOrThrow(tx, actor, staffId);
  });
}

export async function setPersonActive(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminTeamPerson> {
  authorize(actor, "TEAM_WRITE");
  const staffId = parse(AdminIdSchema, id), v = parse(TeamActiveSchema, input);
  return mutate(options, "team_active", async (tx) => {
    await staffNameOnly(tx, actor, staffId);
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_staff_set_active(${actor.staffId}, ${staffId}, ${v.active}, ${v.expectedRevision}::integer) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapTeamError(error); }
    adminEvent(v.active ? "admin.team.reactivated" : "admin.team.deactivated", { actorStaffId: actor.staffId, targetStaffId: staffId, changed });
    return personOrThrow(tx, actor, staffId);
  });
}

// Deletes a person with no history; deactivates one with history. The outcome says which, so the screen can tell the truth.
export async function removePerson(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<{ outcome: AdminTeamRemoveOutcome; person: AdminTeamPerson | null }> {
  authorize(actor, "TEAM_WRITE");
  const staffId = parse(AdminIdSchema, id), v = parse(TeamRemoveSchema, input);
  return mutate(options, "team_remove", async (tx) => {
    await staffNameOnly(tx, actor, staffId);
    let outcome: AdminTeamRemoveOutcome;
    try {
      const [row] = await tx.$queryRaw<{ r: AdminTeamRemoveOutcome }[]>`SELECT admin_staff_remove(${actor.staffId}, ${staffId}, ${v.expectedRevision}::integer) AS r`;
      outcome = row.r;
    } catch (error) { return mapTeamError(error); }
    adminEvent("admin.team.removed", { actorStaffId: actor.staffId, targetStaffId: staffId, outcome });
    return { outcome, person: outcome === "DELETED" ? null : await personOrThrow(tx, actor, staffId) };
  });
}

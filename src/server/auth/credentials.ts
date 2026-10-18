import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { BlocklistUnavailableError, loadPasswordBlocklist } from "./blocklist";
import { hashStaffPassword } from "./hash";
import { authEvent } from "./log";
import { StaffNewPasswordSchema, newPasswordRejection, screenStaffPassword, type StaffPasswordRejection } from "./password";
import type { StaffRole } from "./policy";

// Operator credential writes (bootstrap, reset, unlock, deactivate, reactivate) for the
// out-of-process staff:credential CLI. Each follows the credential coordination protocol
// (T-029 S-01): one short READ COMMITTED transaction that locks the StaffCredential row
// before any state-dependent write (the Staff read before the lock only resolves the id
// from the email); hashing and screening happen before it opens. An in-app reset
// path would have to run these under the STAFF_MUTATION permit instead.

export type CredentialFailure =
  | { ok: false; reason: "REJECTED"; rejection: StaffPasswordRejection }
  | { ok: false; reason: "NOT_FOUND" | "NO_CREDENTIAL" | "INTEGRITY" | "CONFLICT" | "USAGE" | "BLOCKLIST_UNAVAILABLE"; message: string };
export type CredentialResult = { ok: true; staffId: string; created: boolean } | CredentialFailure;

const LOCK_TIMEOUT_MS = 2000;
const STATEMENT_TIMEOUT_MS = 3000;

async function locked<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(LOCK_TIMEOUT_MS)}, true),
      set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
}

interface StaffRow { id: string; name: string; hasCredential: boolean }
async function findStaff(db: PrismaClient | Prisma.TransactionClient, email: string): Promise<StaffRow | null | "INTEGRITY"> {
  const rows = await db.$queryRaw<StaffRow[]>`
    SELECT s."id", s."name", c."staffId" IS NOT NULL AS "hasCredential"
    FROM "staff" s LEFT JOIN "staff_credentials" c ON c."staffId" = s."id"
    WHERE lower(s."email") = ${email} LIMIT 2`;
  if (rows.length > 1) return "INTEGRITY";
  return rows[0] ?? null;
}
const integrity = { ok: false, reason: "INTEGRITY", message: "More than one staff record matches that email." } as const;
const notFound = { ok: false, reason: "NOT_FOUND", message: "No staff member has that email." } as const;

export interface SetPasswordInput { email: string; name?: string; role?: StaffRole; phone?: string }

export async function setStaffPassword(
  db: PrismaClient, input: SetPasswordInput, rawPassword: string,
  options: { isCommon?: (form: string) => boolean } = {},
): Promise<CredentialResult> {
  const email = input.email.trim().toLowerCase();
  const reject = (rejection: StaffPasswordRejection, staffId: string | null): CredentialResult => {
    authEvent("auth.credential_changed", { staffId, operation: "SET_PASSWORD", rejection });
    return { ok: false, reason: "REJECTED", rejection };
  };
  const existing = await findStaff(db, email);
  if (existing === "INTEGRITY") return integrity;
  if (!existing && (!input.name?.trim() || !input.role)) {
    return { ok: false, reason: "USAGE", message: "A new staff member needs --name and --role." };
  }
  // Raw input -> shared schema (normalizes) -> screening -> hash. Nothing is written on rejection.
  const shape = newPasswordRejection(rawPassword);
  if (shape) return reject(shape, existing?.id ?? null);
  const normalized = StaffNewPasswordSchema.parse(rawPassword);
  let isCommon = options.isCommon;
  if (!isCommon) {
    try { isCommon = loadPasswordBlocklist(); } catch (error) {
      if (error instanceof BlocklistUnavailableError) return { ok: false, reason: "BLOCKLIST_UNAVAILABLE", message: error.message };
      throw error;
    }
  }
  const name = input.name?.trim() || existing?.name || "";
  const screened = screenStaffPassword(normalized, { email, name }, isCommon);
  if (screened) return reject(screened, existing?.id ?? null);
  const passwordHash = await hashStaffPassword(normalized);

  try {
    const result = await locked(db, async (tx) => {
      const staff = await findStaff(tx, email);
      if (staff === "INTEGRITY") return integrity;
      const profile = { ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...(input.role ? { role: input.role } : {}) };
      if (!staff) {
        // Bootstrap of a new Staff row: the unique email makes a concurrent second bootstrap fail.
        const id = randomUUID();
        await tx.staff.create({ data: { id, email, name: input.name!.trim(), role: input.role!, phone: input.phone ?? "" } });
        await tx.$executeRaw`INSERT INTO "staff_credentials" ("staffId", "passwordHash", "generation", "passwordChangedAt", "updatedAt")
          VALUES (${id}, ${passwordHash}, 1, statement_timestamp(), statement_timestamp())`;
        return { ok: true as const, staffId: id, created: true };
      }
      const [credential] = await tx.$queryRaw<{ staffId: string }[]>`
        SELECT "staffId" FROM "staff_credentials" WHERE "staffId" = ${staff.id} FOR UPDATE`;
      if (!credential) {
        // Existing Staff without a credential: the staffId primary key rejects a duplicate.
        await tx.$executeRaw`INSERT INTO "staff_credentials" ("staffId", "passwordHash", "generation", "passwordChangedAt", "updatedAt")
          VALUES (${staff.id}, ${passwordHash}, 1, statement_timestamp(), statement_timestamp())`;
      } else {
        await tx.$executeRaw`UPDATE "staff_credentials" SET "passwordHash" = ${passwordHash}, "generation" = "generation" + 1,
          "passwordChangedAt" = statement_timestamp(), "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = statement_timestamp()
          WHERE "staffId" = ${staff.id}`;
        await tx.$executeRaw`UPDATE "staff_sessions" SET "revokedAt" = statement_timestamp(), "revokedReason" = 'PASSWORD_CHANGED'
          WHERE "staffId" = ${staff.id} AND "revokedAt" IS NULL`;
      }
      if (Object.keys(profile).length) await tx.staff.update({ where: { id: staff.id }, data: profile });
      return { ok: true as const, staffId: staff.id, created: false };
    });
    if (result.ok) authEvent("auth.credential_changed", { staffId: result.staffId, operation: "SET_PASSWORD" });
    return result;
  } catch (error) {
    // A unique violation (Prisma P2002, or 23505 from a raw insert) is a concurrent bootstrap.
    if (error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === "P2002" || (error.code === "P2010" && error.meta?.code === "23505"))) {
      return { ok: false, reason: "CONFLICT", message: "Another change to this staff member happened at the same time. Run the command again." };
    }
    throw error;
  }
}

async function lockedStaffChange(
  db: PrismaClient, rawEmail: string, operation: "UNLOCK" | "DEACTIVATE" | "REACTIVATE",
  change: (tx: Prisma.TransactionClient, staffId: string, hasCredential: boolean) => Promise<void>,
): Promise<CredentialResult> {
  const email = rawEmail.trim().toLowerCase();
  const result = await locked(db, async (tx) => {
    const staff = await findStaff(tx, email);
    if (staff === "INTEGRITY") return integrity;
    if (!staff) return notFound;
    if (operation === "UNLOCK" && !staff.hasCredential) return { ok: false, reason: "NO_CREDENTIAL", message: "That staff member has no sign-in credential." } as const;
    if (staff.hasCredential) await tx.$queryRaw`SELECT "staffId" FROM "staff_credentials" WHERE "staffId" = ${staff.id} FOR UPDATE`;
    await change(tx, staff.id, staff.hasCredential);
    return { ok: true as const, staffId: staff.id, created: false };
  });
  if (result.ok) authEvent("auth.credential_changed", { staffId: result.staffId, operation });
  return result;
}

export function unlockStaffCredential(db: PrismaClient, email: string): Promise<CredentialResult> {
  return lockedStaffChange(db, email, "UNLOCK", async (tx, staffId) => {
    await tx.$executeRaw`UPDATE "staff_credentials" SET "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = statement_timestamp()
      WHERE "staffId" = ${staffId}`;
  });
}

export function deactivateStaff(db: PrismaClient, email: string): Promise<CredentialResult> {
  return lockedStaffChange(db, email, "DEACTIVATE", async (tx, staffId) => {
    await tx.$executeRaw`UPDATE "staff" SET "isActive" = false WHERE "id" = ${staffId}`;
    await tx.$executeRaw`UPDATE "staff_sessions" SET "revokedAt" = statement_timestamp(), "revokedReason" = 'DEACTIVATED'
      WHERE "staffId" = ${staffId} AND "revokedAt" IS NULL`;
  });
}

// Revoked sessions stay revoked.
export function reactivateStaff(db: PrismaClient, email: string): Promise<CredentialResult> {
  return lockedStaffChange(db, email, "REACTIVATE", async (tx, staffId) => {
    await tx.$executeRaw`UPDATE "staff" SET "isActive" = true WHERE "id" = ${staffId}`;
  });
}

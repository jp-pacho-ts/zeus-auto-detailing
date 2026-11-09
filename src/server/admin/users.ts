import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { AdminUser, AdminUserCreateResult, AdminUserResetPasswordResult } from "@/types/admin-contracts";
import { AdminIdSchema, UserCreateSchema, UserUpdateSchema } from "@/lib/admin-validation";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { hashStaffPassword } from "@/server/auth/hash";
import { loadPasswordBlocklist } from "@/server/auth/blocklist";
import { screenStaffPassword, StaffNewPasswordSchema, type StaffPasswordContext } from "@/server/auth/password";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, fieldError } from "./errors";

interface UserRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: "SUPERADMIN" | "ADMIN";
  isActive: boolean;
  hasCredential: boolean;
  passwordChangedAt: Date | null;
  revision: number;
  createdAt: Date;
}

function mapUserError(error: unknown): never {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("ZT001")) throw new AdminServiceError("NOT_FOUND", "User not found.");
  if (text.includes("ZT002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed this user. Reload the list and try again.");
  if (text.includes("ZT003")) throw new AdminServiceError("NOT_ALLOWED", "Cannot deactivate or demote the last active admin.");
  if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
  if (text.includes("ZT006")) throw new AdminServiceError("VALIDATION_ERROR");
  if (text.includes("ZT007")) throw fieldError("email", "That email is already used.");
  if (text.includes("ZT008")) throw new AdminServiceError("NOT_ALLOWED", "You cannot deactivate your own account.");
  throw error;
}

const toUser = (r: UserRow): AdminUser => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  role: r.role,
  isActive: r.isActive,
  hasCredential: r.hasCredential,
  passwordChangedAt: r.passwordChangedAt ? r.passwordChangedAt.toISOString() : null,
  revision: Number(r.revision),
  createdAt: r.createdAt.toISOString(),
});

export function generateTemporaryPassword(context: StaffPasswordContext): string {
  const isCommon = loadPasswordBlocklist();
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = randomBytes(16).toString("base64url");
    const parsed = StaffNewPasswordSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const rejection = screenStaffPassword(parsed.data, context, isCommon);
    if (!rejection) return parsed.data;
  }
  throw new Error("Unable to generate secure temporary password");
}

export async function listUsers(actor: StaffActor, options: AdminOptions = {}): Promise<AdminUser[]> {
  authorize(actor, "USER_READ");
  return withStaffDb("STAFF_READ", async (tx: StaffTx) => {
    try {
      const rows = await tx.$queryRaw<UserRow[]>`SELECT * FROM admin_user_list(${actor.staffId})`;
      return rows.map(toUser);
    } catch (error) {
      return mapUserError(error);
    }
  }, { access: "read", db: options.db, signal: options.signal });
}

export async function createUser(
  actor: StaffActor,
  rawInput: unknown,
  options: AdminOptions = {},
): Promise<AdminUserCreateResult> {
  authorize(actor, "USER_WRITE");
  const input = parse(UserCreateSchema, rawInput);
  const id = input.id ?? randomUUID();
  const temporaryPassword = generateTemporaryPassword({ email: input.email, name: input.name });
  const passwordHash = await hashStaffPassword(temporaryPassword);

  return withStaffDb("STAFF_MUTATION", async (tx: StaffTx) => {
    try {
      await tx.$executeRawUnsafe("SELECT admin_user_create($1, $2, $3, $4, $5, $6, $7)",
        actor.staffId,
        id,
        input.name,
        input.phone,
        input.email,
        input.role,
        passwordHash,
      );

      const rows = await tx.$queryRaw<UserRow[]>`SELECT * FROM admin_user_get(${actor.staffId}, ${id})`;
      const created = rows[0];
      if (!created) throw new AdminServiceError("NOT_FOUND", "Created user not found");
      return { user: toUser(created), temporaryPassword };
    } catch (error) {
      return mapUserError(error);
    }
  }, { access: "write", db: options.db, signal: options.signal });
}

export async function updateUser(
  actor: StaffActor,
  rawUserId: unknown,
  rawInput: unknown,
  options: AdminOptions = {},
): Promise<AdminUser> {
  authorize(actor, "USER_WRITE");
  const targetId = parse(AdminIdSchema, rawUserId);
  const input = parse(UserUpdateSchema, rawInput);

  return withStaffDb("STAFF_MUTATION", async (tx: StaffTx) => {
    try {
      await tx.$executeRawUnsafe("SELECT admin_user_update($1, $2, $3, $4, $5, $6, $7::integer)",
        actor.staffId,
        targetId,
        input.name,
        input.phone,
        input.role,
        input.isActive,
        input.expectedRevision,
      );

      const rows = await tx.$queryRaw<UserRow[]>`SELECT * FROM admin_user_get(${actor.staffId}, ${targetId})`;
      const updated = rows[0];
      if (!updated) throw new AdminServiceError("NOT_FOUND", "Updated user not found");
      return toUser(updated);
    } catch (error) {
      return mapUserError(error);
    }
  }, { access: "write", db: options.db, signal: options.signal });
}

export async function resetUserPassword(
  actor: StaffActor,
  rawUserId: unknown,
  _rawInput: unknown,
  options: AdminOptions = {},
): Promise<AdminUserResetPasswordResult> {
  authorize(actor, "USER_WRITE");
  const targetId = parse(AdminIdSchema, rawUserId);

  return withStaffDb("STAFF_MUTATION", async (tx: StaffTx) => {
    try {
      const rows = await tx.$queryRaw<UserRow[]>`SELECT * FROM admin_user_get(${actor.staffId}, ${targetId})`;
      const target = rows[0];
      if (!target) throw new AdminServiceError("NOT_FOUND", "User not found.");

      const temporaryPassword = generateTemporaryPassword({ email: target.email, name: target.name });
      const passwordHash = await hashStaffPassword(temporaryPassword);

      await tx.$executeRawUnsafe("SELECT admin_user_reset_password($1, $2, $3)",
        actor.staffId,
        targetId,
        passwordHash,
      );

      return { ok: true, temporaryPassword };
    } catch (error) {
      return mapUserError(error);
    }
  }, { access: "write", db: options.db, signal: options.signal });
}

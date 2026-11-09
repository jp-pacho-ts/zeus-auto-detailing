import "server-only";
import { UserChangePasswordSchema } from "@/lib/admin-validation";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { hashStaffPassword, verifyStaffPassword } from "@/server/auth/hash";
import { loadPasswordBlocklist } from "@/server/auth/blocklist";
import {
  normalizeStaffPassword,
  screenStaffPassword,
  STAFF_PASSWORD_REJECTION_MESSAGES,
  StaffNewPasswordSchema,
} from "@/server/auth/password";
import { hashSessionToken } from "@/server/auth/session";
import { AdminServiceError, fieldError } from "@/server/admin/errors";
import { parse } from "@/server/admin/context";

interface CredentialRow {
  passwordHash: string;
  name: string;
  email: string;
  isActive: boolean;
}

export async function changeOwnPassword(
  staffId: string,
  sessionToken: string,
  rawInput: unknown,
): Promise<{ ok: true }> {
  const input = parse(UserChangePasswordSchema, rawInput);

  const normalizedCurrent = normalizeStaffPassword(input.currentPassword);
  if (normalizedCurrent === null) {
    throw fieldError("currentPassword", "Current password contains invalid characters.");
  }

  const normalizedNew = normalizeStaffPassword(input.newPassword);
  if (normalizedNew === null) {
    throw fieldError("newPassword", "New password contains invalid characters.");
  }

  const parseResult = StaffNewPasswordSchema.safeParse(input.newPassword);
  if (!parseResult.success) {
    throw fieldError("newPassword", "Password must be 15 to 128 characters long.");
  }

  return withStaffDb("STAFF_MUTATION", async (tx: StaffTx) => {
    const [row] = await tx.$queryRaw<CredentialRow[]>`
      SELECT c."passwordHash", s."name", s."email", s."isActive"
      FROM public.staff s
      JOIN public.staff_credentials c ON c."staffId" = s.id
      WHERE s.id = ${staffId} AND s."removedAt" IS NULL
    `;

    if (!row || !row.isActive) {
      throw new AdminServiceError("NOT_FOUND", "Account not found or inactive.");
    }

    const matches = await verifyStaffPassword(row.passwordHash, normalizedCurrent);
    if (!matches) {
      throw fieldError("currentPassword", "Current password is incorrect.");
    }

    if (normalizedCurrent === normalizedNew) {
      throw fieldError("newPassword", "New password must be different from current password.");
    }

    const isCommon = loadPasswordBlocklist();
    const rejection = screenStaffPassword(normalizedNew, { email: row.email, name: row.name }, isCommon);
    if (rejection) {
      throw fieldError("newPassword", STAFF_PASSWORD_REJECTION_MESSAGES[rejection]);
    }

    const newHash = await hashStaffPassword(normalizedNew);
    const tokenHash = hashSessionToken(sessionToken);

    try {
      await tx.$executeRawUnsafe(
        "SELECT auth_user_change_password($1, $2, $3)",
        staffId,
        newHash,
        tokenHash,
      );
      return { ok: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("ZT001")) throw new AdminServiceError("NOT_FOUND", "Account not found.");
      if (msg.includes("ZT006")) throw new AdminServiceError("VALIDATION_ERROR");
      throw error;
    }
  }, { access: "write" });
}

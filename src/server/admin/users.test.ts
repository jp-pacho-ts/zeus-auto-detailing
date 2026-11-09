// P1-41: User management and password change unit tests (schemas, roles, password generation).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UserChangePasswordSchema,
  UserCreateSchema,
  UserResetPasswordSchema,
  UserUpdateSchema,
} from "@/lib/admin-validation";
import { canPerform } from "./roles";
import { generateTemporaryPassword } from "./users";
import { screenStaffPassword, StaffNewPasswordSchema } from "@/server/auth/password";
import { loadPasswordBlocklist } from "@/server/auth/blocklist";

const ID = "0b8b3b3e-2b1a-4e5c-9f00-000000000001";
const ok = (schema: { safeParse(x: unknown): { success: boolean } }, input: unknown) =>
  assert.equal(schema.safeParse(input).success, true, JSON.stringify(input));
const bad = (schema: { safeParse(x: unknown): { success: boolean } }, input: unknown) =>
  assert.equal(schema.safeParse(input).success, false, JSON.stringify(input));

test("USER_READ and USER_WRITE operations are ADMIN only; STAFF has neither", () => {
  for (const op of ["USER_READ", "USER_WRITE"] as const) {
    assert.equal(canPerform(op, "ADMIN"), true, `ADMIN ${op}`);
    assert.equal(canPerform(op, "STAFF"), false, `STAFF ${op}`);
  }
});

test("UserCreateSchema: requires name, email, role; validates types strictly", () => {
  ok(UserCreateSchema, {
    name: "Alex Doe",
    email: "alex@example.test",
    role: "ADMIN",
  });
  ok(UserCreateSchema, {
    id: ID,
    name: "Alex Doe",
    email: "alex@example.test",
    phone: "+63 917 555 1234",
    role: "SUPERADMIN",
  });
  ok(UserCreateSchema, {
    name: "Alex Doe",
    email: "alex@example.test",
  }); // defaults to ADMIN

  // Rejections
  bad(UserCreateSchema, {});
  bad(UserCreateSchema, { name: "", email: "alex@example.test", role: "ADMIN" });
  bad(UserCreateSchema, { name: "Alex", email: "not-an-email", role: "ADMIN" });
  bad(UserCreateSchema, { name: "Alex", email: "alex@example.test", role: "DETAILER" }); // detailers have no accounts
  bad(UserCreateSchema, { name: "Alex", email: "alex@example.test", role: "STAFF" });
  bad(UserCreateSchema, { name: "Alex", email: "alex@example.test", role: "ADMIN", extraField: 123 });
  bad(UserCreateSchema, { name: "Alex", email: "alex@example.test", role: "ADMIN", id: "not-a-uuid" });
});

test("UserUpdateSchema: requires expectedRevision, name, role, isActive", () => {
  ok(UserUpdateSchema, {
    expectedRevision: 1,
    name: "Alex Doe",
    role: "ADMIN",
    isActive: true,
  });
  ok(UserUpdateSchema, {
    expectedRevision: 2,
    name: "Alex Doe",
    phone: "0917-123-4567",
    role: "SUPERADMIN",
    isActive: false,
  });

  // Rejections
  bad(UserUpdateSchema, {});
  bad(UserUpdateSchema, { expectedRevision: 0, name: "Alex", role: "ADMIN", isActive: true });
  bad(UserUpdateSchema, { expectedRevision: 1, name: "", role: "ADMIN", isActive: true });
  bad(UserUpdateSchema, { expectedRevision: 1, name: "Alex", role: "DETAILER", isActive: true });
  bad(UserUpdateSchema, { expectedRevision: 1, name: "Alex", role: "ADMIN" }); // missing isActive
});

test("UserChangePasswordSchema: validates presence of current and new passwords", () => {
  ok(UserChangePasswordSchema, {
    currentPassword: "OldPassword12345!",
    newPassword: "NewSecurePassword54321!",
  });
  bad(UserChangePasswordSchema, { currentPassword: "", newPassword: "NewSecurePassword54321!" });
  bad(UserChangePasswordSchema, { currentPassword: "OldPassword12345!", newPassword: "" });
  bad(UserChangePasswordSchema, {});
});

test("UserResetPasswordSchema: accepts empty or missing object strictly", () => {
  ok(UserResetPasswordSchema, {});
  ok(UserResetPasswordSchema, undefined);
  bad(UserResetPasswordSchema, { password: "foo" });
});

test("generateTemporaryPassword produces a valid password meeting all policy checks", () => {
  const context = { email: "operator@zeusautodetailing.test", name: "Operator Admin" };
  const temp = generateTemporaryPassword(context);

  assert.equal(typeof temp, "string");
  assert.ok(temp.length >= 15, `length ${temp.length} >= 15`);

  // Verify against StaffNewPasswordSchema
  const parsed = StaffNewPasswordSchema.safeParse(temp);
  assert.equal(parsed.success, true);

  // Verify against blocklist and screen rules
  const isCommon = loadPasswordBlocklist();
  const rejection = screenStaffPassword(temp, context, isCommon);
  assert.equal(rejection, null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validatePasswordInput,
  formatTimeRemaining,
  resolveEffectiveTheme,
  THEME_OPTIONS,
} from "./user-settings-model";

test("validates password change requirements strictly", () => {
  // Empty current password
  assert.deepEqual(validatePasswordInput("", "validLongPassword15", "validLongPassword15"), {
    valid: false,
    field: "currentPassword",
    error: "Enter your current password.",
  });

  // Short new password (< 15 chars)
  assert.deepEqual(validatePasswordInput("currentPass12345", "shortPass", "shortPass"), {
    valid: false,
    field: "newPassword",
    error: "New password must be at least 15 characters long.",
  });

  // Same password
  assert.deepEqual(validatePasswordInput("passwordThatIs15CharsLong", "passwordThatIs15CharsLong", "passwordThatIs15CharsLong"), {
    valid: false,
    field: "newPassword",
    error: "New password must be different from your current password.",
  });

  // Mismatched confirmation
  assert.deepEqual(validatePasswordInput("currentPass12345", "brandNewPassword15Chars", "differentNewPassword15"), {
    valid: false,
    field: "confirmPassword",
    error: "New passwords do not match.",
  });

  // Valid password change
  assert.deepEqual(validatePasswordInput("currentPass12345", "brandNewPassword15Chars", "brandNewPassword15Chars"), {
    valid: true,
  });
});

test("formats session expiration time remaining clearly", () => {
  const now = new Date("2026-11-11T12:00:00Z");

  // 45 minutes remaining
  const in45Min = "2026-11-11T12:45:00Z";
  assert.equal(formatTimeRemaining(in45Min, now), "45m");

  // 2 hours 15 min remaining
  const in2Hours = "2026-11-11T14:15:00Z";
  assert.equal(formatTimeRemaining(in2Hours, now), "2h 15m");

  // Past expiry
  const past = "2026-11-11T11:59:00Z";
  assert.equal(formatTimeRemaining(past, now), "Expired");
});

test("resolves effective theme according to mode and system preference", () => {
  assert.equal(resolveEffectiveTheme("dark", false), "dark");
  assert.equal(resolveEffectiveTheme("dark", true), "dark");
  assert.equal(resolveEffectiveTheme("light", true), "light");
  assert.equal(resolveEffectiveTheme("light", false), "light");
  assert.equal(resolveEffectiveTheme("system", true), "dark");
  assert.equal(resolveEffectiveTheme("system", false), "light");
  assert.equal(THEME_OPTIONS.length, 3);
});

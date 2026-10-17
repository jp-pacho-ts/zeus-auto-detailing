import "server-only";
import { z } from "zod";
import { STAFF_PASSWORD_POLICY } from "./policy";

// Password policy (S-04, R-01). Every path that sets a password parses the raw input
// with StaffNewPasswordSchema (which normalizes), then screenStaffPassword, before hashing.
export type StaffPasswordRejection = "CHARACTERS" | "LENGTH" | "BLOCKLIST";
export interface StaffPasswordContext { email: string; name: string }

export const STAFF_PASSWORD_REJECTION_MESSAGES: Readonly<Record<StaffPasswordRejection, string>> = {
  CHARACTERS: "Use printable characters only.",
  LENGTH: "Use 15 to 128 characters.",
  BLOCKLIST: "This password is too common or easy to guess, or is based on your name, email or the shop's name. Choose another.",
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

// Login and every set/reset path use this; the result is hashed as UTF-8.
// No trimming and no case folding: spaces and case are part of the password.
export function normalizeStaffPassword(raw: string): string | null {
  if (LONE_SURROGATE.test(raw) || CONTROL.test(raw)) return null;
  return raw.normalize("NFC");
}

const PW = STAFF_PASSWORD_POLICY;
const codePoints = (s: string) => Array.from(s).length;

// One rule for login and every set/reset path (R-01), in this order: raw UTF-16 cap,
// well-formed and control-free, NFC, then the normalized maximum.
export const StaffPasswordInputSchema = z.string().min(1).max(PW.maxRawUtf16Units)
  .transform((s, ctx) => {
    const n = normalizeStaffPassword(s);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Use printable characters only" });
      return z.NEVER;
    }
    return n;
  })
  .pipe(z.string().refine((s) => codePoints(s) <= PW.maxCodePoints,
    `Use at most ${PW.maxCodePoints} characters`));

export const StaffLoginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.string().email()),
  password: StaffPasswordInputSchema, // the NFC string that is verified
}).strict();

// Every set/reset path: the same input rule plus the minimum, then screenStaffPassword.
export const StaffNewPasswordSchema = StaffPasswordInputSchema.pipe(z.string().refine(
  (s) => codePoints(s) >= PW.minCodePoints,
  `Use ${PW.minCodePoints} to ${PW.maxCodePoints} characters`,
));

// Maps a StaffNewPasswordSchema failure to the reason class the CLI reports.
export function newPasswordRejection(raw: string): StaffPasswordRejection | null {
  if (raw.length > PW.maxRawUtf16Units) return "LENGTH";
  const n = normalizeStaffPassword(raw);
  if (n === null) return "CHARACTERS";
  const length = codePoints(n);
  return length < PW.minCodePoints || length > PW.maxCodePoints ? "LENGTH" : null;
}

const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "0123456789",
  "qwertyuiopasdfghjklzxcvbnm", "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p"];
const SEQUENCE_HAYSTACKS = SEQUENCES.flatMap((s) => {
  const r = s.repeat(3);
  return [r, Array.from(r).reverse().join("")];
});

// Normalizes a corpus entry or comparison form the same way as a password form.
export function blocklistForm(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

// Whole-string comparison forms (never substrings): as typed, without spaces,
// and with leading/trailing digits and symbols removed.
function comparisonForms(normalized: string): string[] {
  const spaced = blocklistForm(normalized);
  const joined = spaced.replace(/ /g, "");
  const core = joined.replace(/^[\p{N}\p{P}\p{S}]+|[\p{N}\p{P}\p{S}]+$/gu, "");
  return [...new Set([spaced, joined, core])].filter((f) => f.length > 0);
}
function contextTerms(ctx: StaffPasswordContext): Set<string> {
  const email = ctx.email.trim().toLowerCase();
  const local = email.split("@")[0] ?? "";
  const name = blocklistForm(ctx.name);
  return new Set([email, local, local.replace(/[._+-]/g, ""), name,
    name.replace(/ /g, ""), ...PW.serviceTerms].filter((t) => t.length > 0));
}
function isRepetition(form: string, isKnown: (unit: string) => boolean): boolean {
  const cps = Array.from(form);
  for (let len = 1; len <= cps.length / 2; len++) {
    if (cps.length % len !== 0) continue;
    const unit = cps.slice(0, len).join("");
    if (unit.repeat(cps.length / len) === form && (len <= 4 || isKnown(unit))) return true;
  }
  return false;
}

// isCommon looks a comparison form up in the bundled corpus (blocklist.ts).
export function screenStaffPassword(
  normalized: string, ctx: StaffPasswordContext, isCommon: (form: string) => boolean,
): StaffPasswordRejection | null {
  const length = codePoints(normalized);
  if (length < PW.minCodePoints || length > PW.maxCodePoints) return "LENGTH";
  const terms = contextTerms(ctx);
  const isKnown = (f: string) => isCommon(f) || terms.has(f);
  for (const form of comparisonForms(normalized)) {
    if (isKnown(form)) return "BLOCKLIST";
    if (codePoints(form) < PW.structuralMinCodePoints) continue;
    if (new Set(Array.from(form)).size < PW.minDistinctCodePoints) return "BLOCKLIST";
    if (SEQUENCE_HAYSTACKS.some((h) => h.includes(form))) return "BLOCKLIST";
    if (isRepetition(form, isKnown)) return "BLOCKLIST";
  }
  return null;
}

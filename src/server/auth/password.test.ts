// S-04 and R-01: one password input rule for every set path and login.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  StaffLoginSchema, StaffNewPasswordSchema, StaffPasswordInputSchema,
  newPasswordRejection, normalizeStaffPassword, screenStaffPassword,
} from "./password";
import { STAFF_PASSWORD_POLICY } from "./policy";

const utf8 = (s: string) => Buffer.from(s, "utf8");
// Compare hash inputs without printing passwords in assertion messages.
function sameHashInput(a: string, b: string, label: string) {
  assert.ok(utf8(a).equals(utf8(b)), `${label}: hash inputs differ`);
}
function acceptedAtSetAndLogin(raw: string, label: string) {
  const set = StaffNewPasswordSchema.safeParse(raw);
  assert.ok(set.success, `${label}: rejected when set`);
  const login = StaffPasswordInputSchema.safeParse(raw);
  assert.ok(login.success, `${label}: rejected at login`);
  sameHashInput(set.data, login.data, label);
  // The stored NFC string itself also passes login unchanged.
  const again = StaffPasswordInputSchema.safeParse(set.data);
  assert.ok(again.success, `${label}: normalized form rejected at login`);
  sameHashInput(again.data, set.data, label);
  return set.data;
}

test("the runtime ICU's maximum canonical decomposition is at most 4 code points", () => {
  let max = 0;
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const n = Array.from(String.fromCodePoint(cp).normalize("NFD")).length;
    if (n > max) max = n;
  }
  assert.ok(max <= 4, `maximum canonical decomposition is ${max}`);
  assert.equal(STAFF_PASSWORD_POLICY.maxRawUtf16Units, 2 * max * STAFF_PASSWORD_POLICY.maxCodePoints);
});

test("T-032 counter-example: 100 Hangul syllables typed as decomposed Jamo", () => {
  const composed = "한".repeat(100);
  const decomposed = composed.normalize("NFD");
  assert.equal(decomposed.length, 300);
  assert.equal(Array.from(composed).length, 100);
  const a = acceptedAtSetAndLogin(decomposed, "decomposed Jamo");
  const b = acceptedAtSetAndLogin(composed, "composed Hangul");
  sameHashInput(a, b, "Jamo vs syllables");
});

test("15 and 128 code-point boundaries", () => {
  assert.equal(StaffNewPasswordSchema.safeParse("q".repeat(14)).success, false);
  acceptedAtSetAndLogin("q".repeat(15), "15");
  acceptedAtSetAndLogin("q".repeat(128), "128");
  assert.equal(StaffNewPasswordSchema.safeParse("q".repeat(129)).success, false);
  assert.equal(StaffPasswordInputSchema.safeParse("q".repeat(129)).success, false);
  // Login has no minimum, so a later policy change can never strand a password.
  assert.equal(StaffPasswordInputSchema.safeParse("short").success, true);
});

test("128 four-code-point decompositions (512 raw units) round-trip", () => {
  const nfd = "ᾂ".normalize("NFD");
  assert.equal(Array.from(nfd).length, 4);
  const raw = nfd.repeat(128);
  assert.equal(raw.length, 512);
  const n = acceptedAtSetAndLogin(raw, "U+1F82 x 128");
  assert.equal(Array.from(n).length, 128);
});

test("supplementary characters that normalize to one BMP character", () => {
  const raw = "\u{2F800}".repeat(128); // CJK compatibility ideograph -> U+4E3D
  assert.equal(raw.length, 256);
  const n = acceptedAtSetAndLogin(raw, "U+2F800 x 128");
  assert.equal(n, "丽".repeat(128));
});

test("NFC, NFD and mixed equivalent forms give the same hash input", () => {
  const base = "Café crème brûlée façade naïve";
  const mixed = Array.from(base.normalize("NFC")).map((c, i) => (i % 2 ? c.normalize("NFD") : c)).join("");
  const forms = [base.normalize("NFC"), base.normalize("NFD"), mixed];
  assert.equal(new Set(forms).size, 3);
  const outputs = forms.map((f, i) => acceptedAtSetAndLogin(f, `form ${i}`));
  for (const o of outputs) sameHashInput(o, outputs[0], "equivalent forms");
});

test("1,024 / 1,025 raw-unit boundary", () => {
  const at = StaffPasswordInputSchema.safeParse("a".repeat(1024));
  assert.equal(at.success, false);
  assert.match(at.error!.issues[0].message, /at most 128 characters/); // passed the raw cap
  const over = StaffPasswordInputSchema.safeParse("a".repeat(1025));
  assert.equal(over.success, false);
  assert.equal(over.error!.issues[0].code, "too_big"); // stopped by the raw cap
  assert.equal(newPasswordRejection("a".repeat(1025)), "LENGTH");
});

test("lone surrogates and control characters are rejected; spaces, case and length kept", () => {
  for (const bad of ["valid-length-pass\uD800word", "valid-length-pass\uDC00word", "tab\tinside-a-long-password", "nul\u0000inside-a-long-password", "c1\u0085inside-a-long-password"]) {
    assert.equal(StaffPasswordInputSchema.safeParse(bad).success, false);
    assert.equal(normalizeStaffPassword(bad), null);
    assert.equal(newPasswordRejection(bad), "CHARACTERS");
  }
  const spaced = "  Leading And Trailing Spaces  ";
  const parsed = StaffPasswordInputSchema.parse(spaced);
  sameHashInput(parsed, spaced, "spaces and case preserved");
  assert.notEqual(StaffPasswordInputSchema.parse("Case Sensitive Pass"), StaffPasswordInputSchema.parse("case sensitive pass"));
  const long = "x".repeat(100) + "end";
  assert.equal(StaffPasswordInputSchema.parse(long).length, 103); // never truncated
});

test("login schema lowercases the email and keeps the password raw apart from NFC", () => {
  const parsed = StaffLoginSchema.parse({ email: "  Owner@Example.COM ", password: " Pass Word " });
  assert.equal(parsed.email, "owner@example.com");
  sameHashInput(parsed.password, " Pass Word ", "login password");
  assert.equal(StaffLoginSchema.safeParse({ email: "owner@example.com", password: "x", extra: 1 }).success, false);
  assert.equal(StaffLoginSchema.safeParse({ email: "not-an-email", password: "x" }).success, false);
  assert.equal(StaffLoginSchema.safeParse({ email: "owner@example.com", password: "" }).success, false);
});

const corpus = new Set(["password", "letmein", "iloveyou", "sunshine"]);
const isCommon = (f: string) => corpus.has(f);
const ctx = { email: "maria.santos@example.com", name: "Maria Santos" };

test("screening rejects corpus, context, structural and repetition cases", () => {
  const rejected: [string, string][] = [
    ["password12345678", "core form is a corpus entry"],
    ["!!!Sunshine2026!!!", "core form is a corpus entry"],
    ["maria.santos@example.com", "email"],
    ["mariasantos123456", "local part without punctuation"],
    ["Maria Santos 2026!!", "name"],
    ["  zeusautodetailing  ", "service term"],
    ["abcdefghijklmnopq", "alphabet sequence"],
    ["qponmlkjihgfedcba", "reverse alphabet sequence"],
    ["1234567890123456", "digit sequence"],
    ["qwertyuiopasdfgh", "keyboard sequence"],
    ["abababababababab", "few distinct code points"],
    ["letmeinletmeinletmein", "repetition of a corpus term"],
    ["abcdabcdabcdabcd", "repetition of a 4-unit"],
  ];
  for (const [pw, label] of rejected) {
    assert.equal(screenStaffPassword(pw.normalize("NFC"), ctx, isCommon), "BLOCKLIST", label);
  }
  // Rules 3-4 only apply to forms of 8+ code points; a whole-string rule, never substrings.
  assert.equal(screenStaffPassword("correct horse battery staple", ctx, isCommon), null);
  assert.equal(screenStaffPassword("my password is long and odd", ctx, isCommon), null);
  assert.equal(screenStaffPassword("мой пароль для мойки авто", ctx, isCommon), null);
  assert.equal(screenStaffPassword("한".repeat(3) + "글 비밀번호 문장입니다 정말로", ctx, isCommon), null);
  assert.equal(screenStaffPassword("short", ctx, isCommon), "LENGTH");
});

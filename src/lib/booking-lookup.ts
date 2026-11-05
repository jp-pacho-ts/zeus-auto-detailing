// P1-32: the pure rules of the "reference code + last name" booking lookup. No server imports, so the
// manage page and the server share one definition.
import type { BookingStatus } from "@/types/contracts";

// A reference code is "ZEUS-" and six random characters from 36 (about 31 bits); anything else is not one.
const REFERENCE = /^ZEUS-[A-Z0-9]{6}$/;
export function normalizeReference(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return REFERENCE.test(code) ? code : null;
}

// Case, accents and these separators do not matter, and nothing else: spaces, hyphens and dashes, apostrophes (straight or curly)
// and dots. "De la Cruz" = "dé  la CRUZ", "O'Neil" = "o-neil". Any other symbol is kept, so it has to match as typed: "O/Neil" and
// "Anne&Marie" do NOT match "ONeil" and "AnneMarie" (Codex note on the earlier rule, which erased every non-letter).
export function normalizeLastName(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s\p{Pd}'\u2018\u2019\u02BC\u0060\u00B4.]/gu, "");
}
// An empty name never matches anything, not even another empty one.
export function lastNamesMatch(a: unknown, b: unknown): boolean {
  const x = normalizeLastName(a), y = normalizeLastName(b);
  return x.length > 0 && x === y;
}

// A booking made before first and last name were separate keeps one name; its last word stands in.
export function lastNameFallback(customerName: string): string | null {
  const words = customerName.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 ? words[words.length - 1] : null;
}

const one = (s: string) => s.trim().replace(/\s+/g, " ");
// The display name stored in customerName: "First Last", or an old-style single name EXACTLY as the schema trimmed it.
// Codex F2: the old path must not collapse inner spaces. The release-1 parser only trimmed, existing receipts bind the hash of
// those bytes, and a stale exact retry of "Ana  Santos" must hash as it did before, not conflict with its own receipt.
export function composeCustomerName(input: { customerName?: string; customerFirstName?: string; customerLastName?: string }): string {
  if (input.customerFirstName && input.customerLastName) return one(input.customerFirstName) + " " + one(input.customerLastName);
  return input.customerName ?? "";
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("63") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^9\d{9}$/.test(national) ? "+63 9•• ••• " + national.slice(-4) : "•••";
}
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at > 0 ? email[0] + "•••" + email.slice(at) : "•••";
}

// What the customer sees. Status level only: per-service work status stays staff-only (LE 2026-10-21).
const STEPS = ["Received", "Confirmed", "In service", "Completed"];
export interface BookingProgress { label: string; step: number; steps: string[]; cancelled: boolean }
export function progressFor(status: BookingStatus): BookingProgress {
  if (status === "CANCELLED") return { label: "Cancelled", step: 0, steps: STEPS, cancelled: true };
  const step = { PENDING: 1, CONFIRMED: 2, IN_PROGRESS: 3, COMPLETED: 4 }[status] ?? 1;
  return { label: STEPS[step - 1], step, steps: STEPS, cancelled: false };
}

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

// Case, accents, spacing, hyphens, apostrophes and dots do not matter: "De la Cruz" = "dé  la CRUZ".
export function normalizeLastName(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
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
// The display name stored in customerName: "First Last", or an old-style single name as sent.
export function composeCustomerName(input: { customerName?: string; customerFirstName?: string; customerLastName?: string }): string {
  if (input.customerFirstName && input.customerLastName) return one(input.customerFirstName) + " " + one(input.customerLastName);
  return one(input.customerName ?? "");
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

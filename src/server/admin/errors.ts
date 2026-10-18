import "server-only";
import type { ErrorCode } from "@/types/contracts";
import type { AdminBookingDetail, AdminError, AdminErrorCode } from "@/types/admin-contracts";
import { StaffAuthError } from "@/server/auth/errors";

const STATUS: Record<AdminErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  VERSION_CONFLICT: 409, SCHEDULE_CONFLICT: 409, BOOKING_NOT_MANAGEABLE: 409, CATALOG_UPDATED: 409, SLOT_UNAVAILABLE: 409, IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429, RETRYABLE_ERROR: 503, INTERNAL_ERROR: 500,
};
const MESSAGES: Partial<Record<AdminErrorCode, string>> = {
  VALIDATION_ERROR: "Please check the highlighted fields.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That record doesn't exist.",
  VERSION_CONFLICT: "Someone else changed this booking. Review the latest version and try again.",
  SCHEDULE_CONFLICT: "That change doesn't fit the schedule.",
  BOOKING_NOT_MANAGEABLE: "This booking can't be changed that way.",
  CATALOG_UPDATED: "The service list changed. Try again.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  RETRYABLE_ERROR: "The staff service is temporarily unavailable. Please try again shortly.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

// A StaffAuthError subtype, so the P1-06 permit wrapper passes it through instead of turning it
// into 503. Every admin outcome is decided before commit, so commitState is NOT_COMMITTED.
export class AdminServiceError extends StaffAuthError {
  currentBooking: AdminBookingDetail | null;
  constructor(public adminCode: AdminErrorCode, message?: string, options: {
    fieldErrors?: Record<string, string[]>; currentBooking?: AdminBookingDetail | null; retryAfterSeconds?: number | null;
  } = {}) {
    super(adminCode as ErrorCode, message ?? MESSAGES[adminCode] ?? "Request failed.",
      options.retryAfterSeconds ?? (adminCode === "RETRYABLE_ERROR" ? 10 : null), options.fieldErrors ?? {});
    this.currentBooking = options.currentBooking ?? null;
  }
  override get status(): number { return STATUS[this.adminCode] ?? 500; }
  toEnvelope(): AdminError {
    return {
      code: this.adminCode, message: this.message, fieldErrors: this.fieldErrors,
      retryable: this.adminCode === "RETRYABLE_ERROR" || this.adminCode === "RATE_LIMITED",
      commitState: "NOT_COMMITTED", currentBooking: this.currentBooking,
    };
  }
}

export const fieldError = (field: string, message: string, code: AdminErrorCode = "VALIDATION_ERROR", currentBooking: AdminBookingDetail | null = null) =>
  new AdminServiceError(code, message, { fieldErrors: { [field]: [message] }, currentBooking });

export function zodError(issues: { path: PropertyKey[]; message: string }[]): AdminServiceError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) (fieldErrors[issue.path.map(String).join(".") || "form"] ??= []).push(issue.message);
  return new AdminServiceError("VALIDATION_ERROR", undefined, { fieldErrors });
}

// A P1-02 database guard firing means a service pre-check was missed: never a user outcome.
const GUARD = /P0001|violates check constraint|Queue day is full|Queue cap is below|booking line|Booking line|day-queue|audit row|revision|Only ADMIN|must come from the head release/i;
export function isGuardViolation(error: unknown): boolean {
  return error instanceof Error && !(error instanceof StaffAuthError) && GUARD.test(error.message);
}

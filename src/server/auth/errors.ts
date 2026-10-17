import "server-only";
import type { ErrorCode } from "@/types/contracts";
import type { AdminError } from "./types";

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  RATE_LIMITED: 429, RETRYABLE_ERROR: 503, INTERNAL_ERROR: 500,
};
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: "Sign in to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  RATE_LIMITED: "Too many sign-in attempts. Wait a moment and try again.",
  RETRYABLE_ERROR: "The staff service is temporarily unavailable. Please try again shortly.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

export class StaffAuthError extends Error {
  constructor(
    public code: ErrorCode,
    message = MESSAGES[code] ?? "Request failed.",
    public retryAfterSeconds: number | null = code === "RETRYABLE_ERROR" ? 10 : null,
    public fieldErrors: Record<string, string[]> = {},
  ) { super(message); }
  get status(): number { return STATUS[this.code] ?? 500; }
  toAdminError(): AdminError {
    return {
      code: this.code, message: this.message, fieldErrors: this.fieldErrors,
      retryable: this.code === "RETRYABLE_ERROR" || this.code === "RATE_LIMITED",
      commitState: "NOT_APPLICABLE", currentBooking: null,
    };
  }
}

// Anything that is not a StaffAuthError is a dependency failure: fail closed with 503.
export function asStaffAuthError(error: unknown): StaffAuthError {
  return error instanceof StaffAuthError ? error : new StaffAuthError("RETRYABLE_ERROR");
}

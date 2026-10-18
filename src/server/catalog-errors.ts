import "server-only";
import type { BookingQuote, LifecycleError } from "@/types/catalog-contracts";

// Lifecycle errors the catalog and quote surfaces return. Statuses follow ARCHITECTURE T-042:
// SERVICE_NOT_OFFERED is 400, QUOTE_REQUIRED/CATALOG_UPDATED/QUOTE_EXPIRED are 409.
export type CatalogErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "SERVICE_NOT_OFFERED" | "QUOTE_REQUIRED"
  | "CATALOG_UPDATED" | "QUOTE_EXPIRED" | "RATE_LIMITED" | "RETRYABLE_ERROR";
const STATUS: Record<CatalogErrorCode, number> = {
  VALIDATION_ERROR: 400, NOT_FOUND: 404, SERVICE_NOT_OFFERED: 400, QUOTE_REQUIRED: 409,
  CATALOG_UPDATED: 409, QUOTE_EXPIRED: 409, RATE_LIMITED: 429, RETRYABLE_ERROR: 503,
};

// A published release that breaks the catalog's shape (missing offers, an unmapped primary
// service): the surfaces fail closed with 503, never a partial catalog or quote.
export class CatalogIntegrityError extends Error {}

export function catalogError(code: CatalogErrorCode, message: string, options: {
  fieldErrors?: Record<string, string[]>; commitState?: LifecycleError["commitState"];
  currentQuote?: BookingQuote | null; retryAfterSeconds?: number | null;
} = {}): LifecycleError {
  const retryable = code === "RATE_LIMITED" || code === "RETRYABLE_ERROR";
  return {
    code, message, fieldErrors: options.fieldErrors ?? {}, retryable,
    commitState: options.commitState ?? "NOT_APPLICABLE",
    currentQuote: options.currentQuote ?? null, currentBooking: null,
    retryAfterSeconds: retryable ? (options.retryAfterSeconds ?? 10) : null,
  };
}

export const catalogUnavailable = () =>
  catalogError("RETRYABLE_ERROR", "The service list is temporarily unavailable. Please try again shortly.");

export function catalogValidationError(issues: { path: PropertyKey[]; message: string }[]): LifecycleError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) (fieldErrors[issue.path.map(String).join(".") || "form"] ??= []).push(issue.message);
  return catalogError("VALIDATION_ERROR", "Please check the selected service, size and add-ons.", { fieldErrors });
}

export function catalogHttpStatus(error: LifecycleError): number {
  return STATUS[error.code as CatalogErrorCode] ?? 500;
}

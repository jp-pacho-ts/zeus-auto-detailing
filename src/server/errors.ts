import type { ContractError, ErrorCode } from "@/types/contracts";

export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public fieldErrors: Record<string, string[]> = {}, public retryable = false) { super(message); }
}
export function contractError(error: unknown): ContractError {
  if (error instanceof DomainError) return { code: error.code, message: error.message, fieldErrors: error.fieldErrors, retryable: error.retryable };
  // Never serialize ORM errors, customer data, connection URLs or SQL.
  return { code: "RETRYABLE_ERROR", message: "The shop service is temporarily unavailable. Please retry.", fieldErrors: {}, retryable: true };
}
export function validationError(issues: { path: PropertyKey[]; message: string }[]): ContractError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { code: "VALIDATION_ERROR", message: "Please check the highlighted details.", fieldErrors, retryable: false };
}

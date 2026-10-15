import "server-only";
import { createHash } from "node:crypto";
import { DomainError } from "./errors";
import type { ContractError, ErrorCode } from "@/types/contracts";

const windows = new Map<string, { count: number; until: number }>();
export function rateLimit(headers: Headers, scope: string, limit: number): void {
  const now = Date.now();
  for (const [key, value] of windows) if (value.until <= now) windows.delete(key);
  // The deployment ingress must overwrite client-supplied forwarding headers.
  const address = headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const key = scope + createHash("sha256").update(address).digest("hex");
  const current = windows.get(key) || { count: 0, until: now + 60000 };
  if (current.count >= limit || (!windows.has(key) && windows.size >= 5000)) throw new DomainError("RATE_LIMITED", "Too many requests. Please wait a minute before retrying.", {}, true);
  current.count++; windows.set(key, current);
}
export function httpStatus(error: ContractError): number {
  const codes: Record<ErrorCode, number> = { VALIDATION_ERROR: 400, NOT_FOUND: 404, SLOT_UNAVAILABLE: 409, SCHEDULE_CONFLICT: 409, VERSION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, UNAUTHENTICATED: 401, FORBIDDEN: 403, RATE_LIMITED: 429, RETRYABLE_ERROR: 503, INTERNAL_ERROR: 500 };
  return codes[error.code];
}
export const responseHeaders = { "Cache-Control": "no-store", "Retry-After": "60" };
export async function readBookingJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new DomainError("VALIDATION_ERROR", "Send booking details as JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("VALIDATION_ERROR", "Booking details are required.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new DomainError("VALIDATION_ERROR", "Booking details must fit within 16 KiB."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("VALIDATION_ERROR", "Send valid JSON booking details.");
  } finally { reader.releaseLock(); }
}

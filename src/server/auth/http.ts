import "server-only";
import { NextResponse } from "next/server";
import { asStaffAuthError, StaffAuthError } from "./errors";
import { authEvent } from "./log";
import type { AdminResult } from "./types";

const MAX_BODY_BYTES = 16 * 1024;
export const ADMIN_RESPONSE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

type Env = Record<string, string | undefined>;

// The exact origin staff pages are served from. Missing or malformed fails closed.
export function appOrigin(env: Env = process.env): string | null {
  const raw = env.APP_ORIGIN;
  if (!raw) return null;
  try { return new URL(raw).origin === raw ? raw : null; } catch { return null; }
}

// Every unsafe /api/admin method, before the session is read.
export function checkSameOrigin(request: Request, env: Env = process.env): void {
  const expected = appOrigin(env);
  if (!expected) {
    authEvent("auth.config_invalid", { reason: "APP_ORIGIN missing or not an exact origin" });
    throw new StaffAuthError("FORBIDDEN");
  }
  if (request.headers.get("origin") !== expected) throw new StaffAuthError("FORBIDDEN");
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") throw new StaffAuthError("FORBIDDEN");
}

// A sent body must be application/json and at most 16 KiB (403 otherwise); malformed JSON is 400.
export async function readAdminJson(request: Request, { allowEmpty = false } = {}): Promise<unknown> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new StaffAuthError("FORBIDDEN"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  if (bytes === 0) {
    if (allowEmpty) return null;
    throw new StaffAuthError("VALIDATION_ERROR", "Send the request details as JSON.");
  }
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json\s*(;|$)/.test(type)) throw new StaffAuthError("FORBIDDEN");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new StaffAuthError("VALIDATION_ERROR", "Send the request details as valid JSON.");
  }
}

export function adminJson<T>(result: AdminResult<T>, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(result, { status, headers: { ...ADMIN_RESPONSE_HEADERS, ...headers } });
}

export function adminErrorResponse(error: unknown): NextResponse {
  const e = asStaffAuthError(error);
  const headers: Record<string, string> = e.retryAfterSeconds !== null ? { "Retry-After": String(e.retryAfterSeconds) } : {};
  return adminJson({ ok: false, error: e.toAdminError() }, e.status, headers);
}

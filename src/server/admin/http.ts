import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { assertStaff, getStaffSessionFromRequest } from "@/server/auth/guards";
import { ADMIN_RESPONSE_HEADERS, checkSameOrigin, readAdminJson } from "@/server/auth/http";
import { asStaffAuthError } from "@/server/auth/errors";
import type { AdminError, AdminResult } from "@/types/admin-contracts";
import type { StaffActor } from "./context";
import { AdminServiceError } from "./errors";

// Every /api/admin queue and booking route: unsafe methods check the exact origin, then the
// JSON body (16 KiB), before the session; then the service authorizes and validates. Responses
// are no-store and no-referrer. Parameters never carry PII (search and history use POST bodies).
export type RouteContext<P> = { params: Promise<P> };

export async function adminRoute<T>(request: NextRequest, run: (actor: StaffActor, body: unknown) => Promise<T>, status = 200): Promise<NextResponse> {
  try {
    let body: unknown = undefined;
    if (request.method !== "GET") {
      checkSameOrigin(request);
      body = await readAdminJson(request, { allowEmpty: request.method === "DELETE" });
    }
    const session = assertStaff(await getStaffSessionFromRequest(request));
    const data = await run({ staffId: session.subject, role: session.role, sessionId: session.sessionId }, body);
    return respond({ ok: true, data }, status);
  } catch (error) {
    const e = error instanceof AdminServiceError ? error : asStaffAuthError(error);
    const envelope: AdminError = error instanceof AdminServiceError ? error.toEnvelope() : { ...e.toAdminError(), currentBooking: null };
    return respond({ ok: false, error: envelope }, e.status, e.retryAfterSeconds !== null ? { "Retry-After": String(e.retryAfterSeconds) } : {});
  }
}

function respond<T>(result: AdminResult<T>, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(result, { status, headers: { ...ADMIN_RESPONSE_HEADERS, ...headers } });
}

// GET query: plain keys, repeated `status`, numeric `limit`. Unknown keys reach the strict schema.
export function queryObject(request: NextRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    out[key] = key === "status" ? values : key === "limit" && /^\d{1,3}$/.test(values[0]) ? Number(values[0]) : values.length === 1 ? values[0] : values;
  }
  return out;
}

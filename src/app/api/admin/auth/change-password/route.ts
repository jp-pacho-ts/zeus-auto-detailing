import { NextResponse, type NextRequest } from "next/server";
import { assertStaff, getStaffSessionFromRequest } from "@/server/auth/guards";
import { ADMIN_RESPONSE_HEADERS, checkSameOrigin, readAdminJson } from "@/server/auth/http";
import { asStaffAuthError } from "@/server/auth/errors";
import { staffSessionCookieName } from "@/server/auth/session";
import { changeOwnPassword } from "@/server/auth/change-password";
import { AdminServiceError } from "@/server/admin/errors";
import type { AdminError, AdminResult } from "@/types/admin-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    checkSameOrigin(request);
    const body = await readAdminJson(request);
    const session = assertStaff(await getStaffSessionFromRequest(request));
    const token = request.cookies.get(staffSessionCookieName())?.value;
    if (!token) {
      throw new AdminServiceError("UNAUTHENTICATED", "Session token missing");
    }

    const data = await changeOwnPassword(session.subject, token, body);
    return respond({ ok: true, data }, 200);
  } catch (error) {
    const e = error instanceof AdminServiceError ? error : asStaffAuthError(error);
    const envelope: AdminError = error instanceof AdminServiceError ? error.toEnvelope() : { ...e.toAdminError(), currentBooking: null };
    return respond({ ok: false, error: envelope }, e.status, e.retryAfterSeconds !== null ? { "Retry-After": String(e.retryAfterSeconds) } : {});
  }
}

function respond<T>(result: AdminResult<T>, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(result, { status, headers: { ...ADMIN_RESPONSE_HEADERS, ...headers } });
}

import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, checkSameOrigin, readAdminJson } from "@/server/auth/http";
import { revokeStaffSession, sessionCookieAttributes, staffSessionCookieName } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Idempotent: with no valid session it still clears the cookie and returns 204.
export async function POST(request: NextRequest) {
  try {
    checkSameOrigin(request);
    await readAdminJson(request, { allowEmpty: true });
    const cookieName = staffSessionCookieName();
    await revokeStaffSession(request.cookies.get(cookieName)?.value, { signal: request.signal });
    const response = new NextResponse(null, { status: 204, headers: ADMIN_RESPONSE_HEADERS });
    response.cookies.set(cookieName, "", sessionCookieAttributes(0));
    return response;
  } catch (error) {
    // A failed revocation keeps the cookie so the staff member can retry.
    return adminErrorResponse(error);
  }
}

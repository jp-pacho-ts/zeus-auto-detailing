import type { NextRequest } from "next/server";
import { requestClientKey } from "@/server/auth/guards";
import { adminErrorResponse, adminJson, checkSameOrigin, readAdminJson } from "@/server/auth/http";
import { loginStaff } from "@/server/auth/login";
import { sessionCookieAttributes, staffSessionCookieName } from "@/server/auth/session";
import { toSessionView } from "@/server/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  try {
    checkSameOrigin(request);
    const body = await readAdminJson(request);
    const cookieName = staffSessionCookieName();
    const outcome = await loginStaff(body, {
      clientKey: requestClientKey(request.headers),
      carriedToken: request.cookies.get(cookieName)?.value ?? null,
      startedAt,
      signal: request.signal,
    });
    if (!outcome.ok) return adminErrorResponse(outcome.error);
    const response = adminJson({ ok: true, data: toSessionView(outcome.session) }, 200);
    response.cookies.set(cookieName, outcome.token, sessionCookieAttributes(outcome.maxAgeSeconds));
    return response;
  } catch (error) {
    return adminErrorResponse(error);
  }
}

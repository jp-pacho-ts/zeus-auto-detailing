import type { NextRequest } from "next/server";
import { assertStaff, getStaffSessionFromRequest } from "@/server/auth/guards";
import { adminErrorResponse, adminJson } from "@/server/auth/http";
import { toSessionView } from "@/server/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = assertStaff(await getStaffSessionFromRequest(request));
    return adminJson({ ok: true, data: toSessionView(session) }, 200);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

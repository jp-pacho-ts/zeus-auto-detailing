import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// P1-78: one test email to the configured shop address. The body is {}; adminRoute checks the same origin first.
export async function POST(request: NextRequest) {
  return adminRoute(request, (actor, body) => admin.sendTestEmail(actor, body));
}

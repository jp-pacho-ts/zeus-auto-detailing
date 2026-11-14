import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, queryObject } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// P1-78: a fixed synthetic booking rendered by the customer email builders; ADMIN only (checked in the service).
export async function GET(request: NextRequest) {
  return adminRoute(request, (actor) => admin.previewEmail(actor, queryObject(request)));
}

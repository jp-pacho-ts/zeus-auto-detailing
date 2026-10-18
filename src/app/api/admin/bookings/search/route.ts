import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return adminRoute(request, (actor, body) => admin.searchBookings(actor, body));
}

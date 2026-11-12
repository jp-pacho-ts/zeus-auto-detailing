import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, type RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recalculate this finished booking's commission (ADMIN, from Booking details).
export async function POST(request: NextRequest, context: RouteContext<{ id: string }>) {
  const p = await context.params;
  return adminRoute(request, (actor) => admin.recalculateCommission(actor, p.id));
}

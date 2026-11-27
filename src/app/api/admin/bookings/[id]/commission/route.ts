import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, type RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recalculate this finished booking's commission (ADMIN, from Booking details).
export async function POST(request: NextRequest, context: RouteContext<{ id: string }>) {
  const p = await context.params;
  return adminRoute<Awaited<ReturnType<typeof admin.recalculateCommission>> | Awaited<ReturnType<typeof admin.correctBookingDeduction>>>(request, (actor, body) => {
    if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0) return admin.recalculateCommission(actor, p.id);
    return admin.correctBookingDeduction(actor, p.id, body);
  });
}

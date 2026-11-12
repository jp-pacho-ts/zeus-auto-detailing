import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, type RouteContext } from "@/server/admin/http";
import { sendCarReady } from "@/server/notifications/bookings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: RouteContext<{ id: string }>) {
  const p = await context.params;
  return adminRoute(request, async (actor, body) => {
    const result = await admin.finishBooking(actor, p.id, body);
    // After the commit and outside the request's wait: a slow or failed email never undoes or delays the finish.
    if (!result.noChange) void sendCarReady(p.id);
    return result;
  });
}

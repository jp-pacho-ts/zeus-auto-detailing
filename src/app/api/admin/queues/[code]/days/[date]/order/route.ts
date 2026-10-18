import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, type RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: RouteContext<{ code: string; date: string }>) {
  const p = await context.params;
  return adminRoute(request, (actor, body) => admin.reorderQueueDay(actor, p.code, p.date, body));
}

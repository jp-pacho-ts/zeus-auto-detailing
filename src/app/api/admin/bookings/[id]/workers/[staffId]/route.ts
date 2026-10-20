import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, type RouteContext } from "@/server/admin/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = RouteContext<{ id: string; staffId: string }>;
export async function PUT(request: NextRequest, context: Context) {
  const p = await context.params;
  return adminRoute(request, (actor, body) =>
    admin.assignWorker(actor, p.id, p.staffId, body),
  );
}
export async function DELETE(request: NextRequest, context: Context) {
  const p = await context.params;
  return adminRoute(request, (actor, body) =>
    admin.unassignWorker(actor, p.id, p.staffId, body),
  );
}

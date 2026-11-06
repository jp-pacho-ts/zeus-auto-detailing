import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, queryObject, type RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<{ id: string }>) {
  const p = await context.params;
  const query = queryObject(request);
  if (Array.isArray(query.cursor) && query.cursor.length === 1) query.cursor = query.cursor[0];
  return adminRoute(request, (actor) => admin.listMovements(actor, p.id, query));
}

import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, type RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST, not DELETE, so the request carries the expected revision in its JSON body like every other admin write.
export async function POST(request: NextRequest, context: RouteContext<{ id: string }>) {
  const p = await context.params;
  return adminRoute(request, (actor, body) => admin.removePerson(actor, p.id, body));
}

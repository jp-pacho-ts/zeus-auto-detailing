import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, queryObject } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = queryObject(request);
  // queryObject keeps `status` as a list; the schema wants one value (a repeated status stays a list and is refused).
  if (Array.isArray(query.status) && query.status.length === 1) query.status = query.status[0];
  return adminRoute(request, (actor) => admin.listCommissions(actor, query));
}

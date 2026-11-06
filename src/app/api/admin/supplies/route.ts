import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, queryObject } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = queryObject(request);
  // queryObject keeps repeated keys as a list; a single includeArchived is one value (a repeated key stays a list and is refused).
  if (Array.isArray(query.includeArchived) && query.includeArchived.length === 1) query.includeArchived = query.includeArchived[0];
  return adminRoute(request, (actor) => admin.listSupplies(actor, query));
}

export async function POST(request: NextRequest) {
  return adminRoute(request, (actor, body) => admin.addSupply(actor, body), 201);
}

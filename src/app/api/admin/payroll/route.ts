import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, queryObject } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = queryObject(request);
  if (Array.isArray(query.weekStart)) query.weekStart = query.weekStart[0];
  return adminRoute(request, (actor) => admin.getWeeklyPayroll(actor, query));
}

export async function POST(request: NextRequest) {
  return adminRoute(request, (actor, body) =>
    admin.savePayrollAdjustment(actor, body),
  );
}

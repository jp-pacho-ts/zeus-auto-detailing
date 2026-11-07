import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, queryObject } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return adminRoute(request, (actor) => admin.getExpenseMonth(actor, queryObject(request)));
}

export async function POST(request: NextRequest) {
  return adminRoute(request, (actor, body) => admin.addExpense(actor, body), 201);
}

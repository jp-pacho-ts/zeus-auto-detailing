import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return adminRoute(request, (actor) => admin.listBays(actor));
}

export async function POST(request: NextRequest) {
  return adminRoute(request, (actor, body) => admin.createBay(actor, body));
}

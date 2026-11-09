import type { NextRequest } from "next/server";
import * as admin from "@/server/admin";
import { adminRoute, type RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: RouteContext<{ id: string }>) {
  const { id } = await params;
  return adminRoute(request, (actor, body) => admin.updateAdminService(actor, id, body));
}

export async function POST(request: NextRequest, { params }: RouteContext<{ id: string }>) {
  const { id } = await params;
  return adminRoute(request, (actor) => admin.toggleAdminService(actor, id, true));
}

export async function DELETE(request: NextRequest, { params }: RouteContext<{ id: string }>) {
  const { id } = await params;
  return adminRoute(request, (actor) => admin.toggleAdminService(actor, id, false));
}

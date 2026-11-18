import type { NextRequest } from "next/server";
import { deleteAdminService } from "@/server/admin/services";
import { adminRoute, type RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: RouteContext<{ id: string }>) {
  const { id } = await params;
  return adminRoute(request, (actor) => deleteAdminService(actor, id));
}

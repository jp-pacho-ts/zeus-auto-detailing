import type { NextRequest } from "next/server";
import { depositProofRoute } from "@/server/admin/deposit";
import type { RouteContext } from "@/server/admin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// P1-18: the only route that returns a stored deposit proof; staff session required.
export async function GET(request: NextRequest, context: RouteContext<{ id: string; proofId: string }>) {
  const p = await context.params;
  return depositProofRoute(request, p.id, p.proofId);
}

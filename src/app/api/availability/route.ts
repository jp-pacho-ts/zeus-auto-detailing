import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/server/availability";
import { contractError, DomainError } from "@/server/errors";
import { httpStatus, rateLimit, responseHeaders } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    rateLimit(request.headers, "availability", 180);
    const query = request.nextUrl.searchParams;
    const allowed = ["date", "vehicleCategoryId", "serviceId"];
    for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw new DomainError("VALIDATION_ERROR", "Use date, vehicleCategoryId and serviceId exactly once.");
    const result = await getAvailableSlots({ date: query.get("date") ?? "", vehicleCategoryId: query.get("vehicleCategoryId") ?? "", serviceId: query.get("serviceId") ?? "" });
    return NextResponse.json(result, { status: result.ok ? 200 : httpStatus(result.error), headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = contractError(error);
    return NextResponse.json({ ok: false, error: safe }, { status: httpStatus(safe), headers: safe.code === "RATE_LIMITED" ? responseHeaders : { "Cache-Control": "no-store" } });
  }
}

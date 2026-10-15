import { NextRequest, NextResponse } from "next/server";
import { getBookingCatalog } from "@/server/catalog";
import { contractError } from "@/server/errors";
import { httpStatus, rateLimit, responseHeaders } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    rateLimit(request.headers, "catalog", 60);
    const result = await getBookingCatalog();
    return NextResponse.json(result, { status: result.ok ? 200 : httpStatus(result.error), headers: { "Cache-Control": "no-store" } });
  } catch (error) { const safe = contractError(error); return NextResponse.json({ ok: false, error: safe }, { status: httpStatus(safe), headers: responseHeaders }); }
}

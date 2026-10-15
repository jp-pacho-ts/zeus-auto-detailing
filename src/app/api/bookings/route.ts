import { NextRequest, NextResponse } from "next/server";
import { commitBooking } from "@/server/bookings";
import { contractError } from "@/server/errors";
import { httpStatus, rateLimit, readBookingJson, responseHeaders } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    rateLimit(request.headers, "booking", 15);
    const { result, created } = await commitBooking(await readBookingJson(request));
    return NextResponse.json(result, { status: result.ok ? (created ? 201 : 200) : httpStatus(result.error), headers: { "Cache-Control": "no-store" } });
  } catch (error) { const safe = contractError(error); return NextResponse.json({ ok: false, error: safe }, { status: httpStatus(safe), headers: safe.code === "RATE_LIMITED" ? responseHeaders : { "Cache-Control": "no-store" } }); }
}

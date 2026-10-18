import { NextRequest, NextResponse } from "next/server";
import { getBookingCatalog } from "@/server/catalog";
import { catalogError, catalogHttpStatus } from "@/server/catalog-errors";
import { DomainError } from "@/server/errors";
import { rateLimit } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// BookingCatalogResponse (ADR-004), public no-store. Every catalog read goes through the
// read seam inside getBookingCatalog().
export async function GET(request: NextRequest) {
  try {
    rateLimit(request.headers, "catalog", 60);
  } catch (error) {
    const limited = error instanceof DomainError && error.code === "RATE_LIMITED";
    const safe = limited ? catalogError("RATE_LIMITED", error.message, { retryAfterSeconds: 60 }) : catalogError("RETRYABLE_ERROR", "The service list is temporarily unavailable. Please try again shortly.");
    return NextResponse.json({ ok: false, error: safe }, { status: catalogHttpStatus(safe), headers: { "Cache-Control": "no-store", "Retry-After": String(safe.retryAfterSeconds) } });
  }
  const result = await getBookingCatalog();
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (!result.ok && result.error.retryAfterSeconds) headers["Retry-After"] = String(result.error.retryAfterSeconds);
  return NextResponse.json(result, { status: result.ok ? 200 : catalogHttpStatus(result.error), headers });
}

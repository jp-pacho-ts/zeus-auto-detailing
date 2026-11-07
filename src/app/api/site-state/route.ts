import { NextResponse } from "next/server";
import { readSiteState } from "@/server/site-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readSiteState(), { headers: { "Cache-Control": "no-store" } });
}

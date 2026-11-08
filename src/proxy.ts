import { NextResponse, type NextRequest } from "next/server";
import { cachedFor, maintenanceResponse, parseSiteState } from "@/lib/maintenance";

// P1-42 maintenance mode, in front of the prerendered pages too, so no redeploy is needed. It asks the app's own route over loopback because this
// bundle may not share memory or a Prisma client with the app, and a second pool would eat the production connection budget.
// shortcut: a change reaches customers within about 6 s (3 s here, 3 s in the route). A CDN that stores HTML would serve around this: see P1-42.md.
const readSiteState = cachedFor(async () => {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? "3000"}/api/site-state`, { cache: "no-store", signal: AbortSignal.timeout(1_000) });
  if (!response.ok) throw new Error("Site state unavailable");
  return parseSiteState(await response.json());
}, 3_000);

export async function proxy(request: NextRequest) {
  const forceOff = process.env.MAINTENANCE_FORCE_OFF === "1";
  const answer = forceOff ? null : maintenanceResponse(request.nextUrl.pathname, await readSiteState(), false);
  return answer ? new NextResponse(answer.body, { status: answer.status, headers: answer.headers }) : NextResponse.next();
}

// Only what can close. /admin, /api/admin, /api/site-state and static files never reach this function.
export const config = { matcher: ["/", "/book", "/book/:path*", "/api/bookings/:path*", "/api/availability/:path*", "/api/catalog/:path*"] };

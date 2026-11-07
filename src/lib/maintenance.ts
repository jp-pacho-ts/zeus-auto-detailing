// P1-42: what maintenance mode closes and what it answers. No React, no database, no network, so the proxy stays thin and this is unit tested.
import { brandConfig } from "@/config/brand";

export interface SiteState { maintenance: boolean; message: string | null }
export const LIVE: SiteState = { maintenance: false, message: null };

/** A closed list of what closes: the admin, sign-in, the state route and static files can never match. */
export function maintenanceTarget(pathname: string): "PAGE" | "API" | null {
  if (pathname === "/" || pathname === "/book" || pathname.startsWith("/book/")) return "PAGE";
  if (["/api/bookings", "/api/availability", "/api/catalog"].some((api) => pathname === api || pathname.startsWith(`${api}/`))) return "API";
  return null;
}

const NO_CACHE = { "Retry-After": "600", "Cache-Control": "no-store" };
const API_MESSAGE = "The website is under maintenance, so online booking is closed for now. Please call the shop.";
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** One self-contained page: no script and no external request, so it holds under the site's CSP whatever else is down. */
export function maintenancePage(message: string | null): string {
  const phone = brandConfig.contactPhone.replace(/\s/g, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(brandConfig.businessName)}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#09090b;color:#f5f5f4;font:16px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:32rem;text-align:center}h1{font-size:1.5rem;margin:0 0 12px}p{margin:0 0 12px;color:#a1a1aa}a{color:#c08818;font-weight:700}</style></head><body><main><h1>${escapeHtml(brandConfig.businessName)} is under maintenance</h1>${message ? `<p>${escapeHtml(message)}</p>` : "<p>We will be back soon.</p>"}<p>To book or ask about your booking, call <a href="tel:${phone}">${escapeHtml(brandConfig.displayPhone)}</a>.</p></main></body></html>`;
}

export interface MaintenanceResponse { status: 503; headers: Record<string, string>; body: string }

/** The answer for this request, or null to let it through. */
export function maintenanceResponse(pathname: string, state: SiteState, forceOff: boolean): MaintenanceResponse | null {
  const target = maintenanceTarget(pathname);
  if (!target || forceOff || !state.maintenance) return null;
  if (target === "PAGE") return { status: 503, headers: { ...NO_CACHE, "Content-Type": "text/html; charset=utf-8" }, body: maintenancePage(state.message) };
  return {
    status: 503,
    headers: { ...NO_CACHE, "Content-Type": "application/json" },
    // The customer error shape, so the booking screens show this sentence as they show any refusal. Nothing was saved.
    body: JSON.stringify({ ok: false, error: { code: "ONLINE_BOOKING_UNAVAILABLE", message: API_MESSAGE, fieldErrors: {}, retryable: true, commitState: "NOT_COMMITTED", currentQuote: null, currentBooking: null, retryAfterSeconds: 600 } }),
  };
}

export function parseSiteState(value: unknown): SiteState {
  const v = value as Partial<SiteState> | null;
  if (typeof v?.maintenance !== "boolean" || !(v.message === null || typeof v.message === "string")) throw new Error("Bad site state");
  return { maintenance: v.maintenance, message: v.message };
}

/** One answer for `ms`, one read at a time. Any failure means live, held for the same time: the site is never taken down by its own check. */
export function cachedFor(load: () => Promise<SiteState>, ms: number, now: () => number = Date.now): () => Promise<SiteState> {
  let held: { until: number; value: Promise<SiteState> } | null = null;
  return () => {
    if (held && now() < held.until) return held.value;
    held = { until: now() + ms, value: load().catch(() => LIVE) };
    return held.value;
  };
}

import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIdentityConfig, trustedClientKey } from "./client-identity";
import { StaffAuthError } from "./errors";
import { authEvent } from "./log";
import { resolveStaffSession, staffSessionCookieName } from "./session";
import type { StaffSession } from "./types";

// Authorization lives here and in the services that call these guards; a protected
// layout or proxy alone is never sufficient (layouts do not re-run on client navigation).

export function requestClientKey(requestHeaders: Headers): string {
  try { return trustedClientKey(requestHeaders, clientIdentityConfig()); } catch (error) {
    authEvent("auth.config_invalid", { reason: (error as Error).message });
    throw new StaffAuthError("RETRYABLE_ERROR");
  }
}

// Server Components and Server Actions: the cookie comes from cookies(). Memoized per request.
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  return resolveStaffSession(store.get(staffSessionCookieName())?.value, requestClientKey(requestHeaders));
});

// Route Handlers: the same lookup from the request itself. A client abort cancels the lookup.
export function getStaffSessionFromRequest(request: Request & { cookies: { get(name: string): { value: string } | undefined } }): Promise<StaffSession | null> {
  return resolveStaffSession(request.cookies.get(staffSessionCookieName())?.value, requestClientKey(request.headers), { signal: request.signal });
}

export function assertStaff(session: StaffSession | null): StaffSession {
  if (!session) throw new StaffAuthError("UNAUTHENTICATED");
  return session; // STAFF and ADMIN
}
export function assertAdmin(session: StaffSession): StaffSession {
  if (session.role !== "ADMIN") throw new StaffAuthError("FORBIDDEN");
  return session;
}

export async function requireStaff(): Promise<StaffSession> {
  return assertStaff(await getStaffSession());
}
export async function requireAdmin(): Promise<StaffSession> {
  return assertAdmin(await requireStaff());
}

// Every /admin page except the login page. RETRYABLE_ERROR reaches the route's error boundary.
export async function requireStaffPage(path: string): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect(safeNextPath(path) ? `/admin/login?next=${path}` : "/admin/login");
  return session;
}

// ?next= is honored only for admin paths, which rules out open redirects.
export function safeNextPath(value: unknown): string | null {
  return typeof value === "string" && /^\/admin(\/[a-z-]+)*$/.test(value) && value !== "/admin/login" ? value : null;
}

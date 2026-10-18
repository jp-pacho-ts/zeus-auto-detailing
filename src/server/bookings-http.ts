import "server-only";
import { CreateBookingSchema } from "@/lib/validation";
import { commitBooking } from "./bookings";
import { createDayBooking, checkBookingOrigin, type CreateDayBookingOptions } from "./bookings-create";
import { parseBookingConfiguration } from "./bookings-credentials";
import { BookingFailure, bookingError, lifecycleHttpStatus, unavailable } from "./bookings-errors";
import { readBookingJson } from "./http";
import { DomainError } from "./errors";
import { parseBookingQuoteQuery, getBookingQuote } from "./catalog-quote";
import { createAdmission, enterBooking, publicReadAdmission } from "./bookings-admission";
import { trustedClientKey } from "./auth/client-identity";
import { sha256 } from "./bookings-hash";
import { getDayAvailability } from "./availability-public";
export function bookingJson(body: unknown, status: number, retry: number | null = null, session?: {
    token: string;
    expiresAt: string;
}): Response {
    const headers = new Headers({
        "Cache-Control": "no-store", "content-type": "application/json", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"
    });
    if (retry !== null)
        headers.set("Retry-After", String(retry));
    if (session) {
        const secure = process.env.NODE_ENV === "production", name = secure ? "__Host-booking-management" : "booking-management";
        headers.set("Set-Cookie", name + "=" + session.token + "; Path=/; HttpOnly; SameSite=Strict; Expires=" + new Date(session.expiresAt).toUTCString() + (secure ? "; Secure" : ""));
    }
    return new Response(JSON.stringify(body), { status, headers });
}
export async function bookingPost(request: Request, options: CreateDayBookingOptions = {}): Promise<Response> {
    try {
        const config = options.config ?? parseBookingConfiguration(), headers = request.headers;
        if (!checkBookingOrigin(headers, config))
            return bookingJson({ ok: false, error: bookingError("FORBIDDEN", "This booking request could not be accepted.") }, 403);
        const input = await readBookingJson(request);
        if (input && typeof input === "object" && !("contractVersion" in input)) {
            const legacy = CreateBookingSchema.safeParse(input);
            if (legacy.success) {
                const leave = enterBooking(createAdmission, sha256(trustedClientKey(headers, config.identity)));
                try {
                    const result = await commitBooking(input, options.db);
                    if (result.result.ok)
                        return bookingJson(result.result, 200);
                    const error = bookingError(result.result.error.code === "VALIDATION_ERROR" ? "CLIENT_UPGRADE_REQUIRED" : result.result.error.code, result.result.error.message);
                    return bookingJson({ ok: false, error }, lifecycleHttpStatus(error));
                }
                finally {
                    leave();
                }
            }
        }
        const commit = await createDayBooking(input, {
            ...options, config, headers, signal: request.signal
        });
        if (commit.result.ok)
            return bookingJson(commit.result, commit.created ? 201 : 200, null, commit.session);
        return bookingJson(commit.result, lifecycleHttpStatus(commit.result.error), commit.result.error.retryAfterSeconds);
    }
    catch (error) {
        const e = error instanceof BookingFailure ? error.error : error instanceof DomainError ? bookingError("VALIDATION_ERROR", error.message) : unavailable();
        return bookingJson({ ok: false, error: e }, lifecycleHttpStatus(e), e.retryAfterSeconds);
    }
}
export async function bookingQuoteGet(request: Request): Promise<Response> {
    let leave: (() => void) | undefined;
    try {
        const c = parseBookingConfiguration();
        leave = enterBooking(publicReadAdmission, sha256(trustedClientKey(request.headers, c.identity)));
        const parsed = parseBookingQuoteQuery(new URL(request.url).searchParams);
        const result = parsed.ok ? await getBookingQuote(parsed.data, { ring: c.quote }) : parsed;
        return bookingJson(result, result.ok ? 200 : lifecycleHttpStatus(result.error), result.ok ? null : result.error.retryAfterSeconds);
    }
    catch (cause) {
        const error = { ...(cause instanceof BookingFailure ? cause.error : unavailable()), commitState: "NOT_APPLICABLE" as const };
        return bookingJson({ ok: false, error }, lifecycleHttpStatus(error), error.retryAfterSeconds);
    }
    finally {
        leave?.();
    }
}
export async function availabilityGet(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams, keys = [...params.keys()], required = ["vehicleCategoryId", "lines", "fromDate", "days"];
    if (keys.length !== 4 || required.some(k => keys.filter(v => v === k).length !== 1) || !/^([1-9]|[12][0-9]|3[01])$/.test(params.get("days") ?? ""))
        return bookingJson({ ok: false, error: bookingError("CLIENT_UPGRADE_REQUIRED", "Refresh the booking page and check the selected services and days.", { commitState: "NOT_APPLICABLE" }) }, 400);
    const selection = parseBookingQuoteQuery(new URLSearchParams({ vehicleCategoryId: params.get("vehicleCategoryId")!, lines: params.get("lines")! }));
    if (!selection.ok)
        return bookingJson(selection, 400);
    const result = await getDayAvailability({
        ...selection.data as object, fromDate: params.get("fromDate"), days: Number(params.get("days"))
    }, { headers: request.headers, signal: request.signal });
    return bookingJson(result, result.ok ? 200 : lifecycleHttpStatus(result.error), result.ok ? null : result.error.retryAfterSeconds);
}

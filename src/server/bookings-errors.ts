import "server-only";
import type { LifecycleError, LifecycleErrorCode } from "@/types/catalog-contracts";
export function bookingError(code: LifecycleErrorCode, message: string, options: Partial<Omit<LifecycleError, "code" | "message">> = {}): LifecycleError {
    return {
        code, message, fieldErrors: {}, retryable: false, commitState: "UNKNOWN", currentQuote: null, currentBooking: null, retryAfterSeconds: null, ...options
    };
}
export class BookingFailure extends Error {
    constructor(public error: LifecycleError) { super(error.code); }
}
export const unavailable = (seconds = 10) => bookingError("RETRYABLE_ERROR", "We could not confirm the outcome. Check this submission before trying another booking.", { retryable: true, retryAfterSeconds: seconds });
export const paused = (seconds: number) => bookingError("ONLINE_BOOKING_UNAVAILABLE", "Online booking is unavailable right now. Please call the shop.", { retryable: true, retryAfterSeconds: seconds });
export function lifecycleHttpStatus(e: LifecycleError): number {
    if (["VALIDATION_ERROR", "CLIENT_UPGRADE_REQUIRED", "CHALLENGE_FAILED", "SERVICE_NOT_OFFERED", "UNSUPPORTED_FILE"].includes(e.code))
        return 400;
    if (e.code === "FILE_TOO_LARGE")
        return 413;
    if (["UNAUTHENTICATED", "RECOVERY_EXPIRED"].includes(e.code))
        return 401;
    if (e.code === "FORBIDDEN")
        return 403;
    if (e.code === "NOT_FOUND")
        return 404;
    if (e.code === "RATE_LIMITED")
        return 429;
    if (["RETRYABLE_ERROR", "ONLINE_BOOKING_UNAVAILABLE"].includes(e.code))
        return 503;
    if (e.code === "INTERNAL_ERROR")
        return 500;
    return 409;
}

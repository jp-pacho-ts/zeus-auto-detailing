import "server-only";
import { bookingJson } from "./bookings-http";
import { readBookingJson } from "./http";
import {
  bookingError,
  BookingFailure,
  lifecycleHttpStatus,
  unavailable,
} from "./bookings-errors";
import { DomainError } from "./errors";
import { checkBookingOrigin } from "./bookings-create";
import { parseBookingConfiguration } from "./bookings-credentials";
import {
  cancelManagedBooking,
  rescheduleManagedBooking,
  recoverBookingOperation,
  readManagedBooking,
  exchangeManagementAccess,
  getManagedDayAvailability,
  forgetManagementSession,
  managementCookieName,
  type ManagementOptions,
} from "./bookings-management";
type Action =
  | "read"
  | "exchange"
  | "forget"
  | "recovery"
  | "cancel"
  | "reschedule"
  | "availability";
export async function managementHttp(
  request: Request,
  action: Action,
  options: ManagementOptions = {},
): Promise<Response> {
  try {
    const config = options.config ?? parseBookingConfiguration(),
      method =
        action === "read" ? "GET" : action === "forget" ? "DELETE" : "POST";
    if (request.method !== method)
      return bookingJson(
        {
          ok: false,
          error: bookingError(
            "VALIDATION_ERROR",
            "Use the expected request method.",
            { commitState: "NOT_APPLICABLE" },
          ),
        },
        405,
      );
    if (new URL(request.url).search)
      return bookingJson(
        {
          ok: false,
          error: bookingError(
            "VALIDATION_ERROR",
            "Management requests do not accept URL parameters.",
            { commitState: "NOT_APPLICABLE" },
          ),
        },
        400,
      );
    if (action !== "read" && !checkBookingOrigin(request.headers, config))
      return bookingJson(
        {
          ok: false,
          error: bookingError(
            "FORBIDDEN",
            "This management request could not be accepted.",
            { commitState: "NOT_APPLICABLE" },
          ),
        },
        403,
      );
    if (action === "forget") {
      const result = await forgetManagementSession({
        ...options,
        config,
        headers: request.headers,
        signal: request.signal,
      });
      if (!result.result.ok)
        return bookingJson(
          result.result,
          lifecycleHttpStatus(result.result.error),
          result.result.error.retryAfterSeconds,
        );
      const secure = process.env.NODE_ENV === "production";
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Set-Cookie":
            managementCookieName() +
            "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" +
            (secure ? "; Secure" : ""),
        },
      });
    }
    const opts = {
      ...options,
      config,
      headers: request.headers,
      signal: request.signal,
    };
    if (action === "read") {
      const result = await readManagedBooking(opts);
      return bookingJson(
        result.result,
        result.result.ok ? 200 : lifecycleHttpStatus(result.result.error),
        result.result.ok ? null : result.result.error.retryAfterSeconds,
      );
    }
    const input = await readBookingJson(request);
    const result =
      action === "exchange"
        ? await exchangeManagementAccess(input, opts)
        : action === "recovery"
          ? await recoverBookingOperation(input, opts)
          : action === "cancel"
            ? await cancelManagedBooking(input, opts)
            : action === "reschedule"
              ? await rescheduleManagedBooking(input, opts)
              : await getManagedDayAvailability(input, opts);
    return bookingJson(
      result.result,
      result.result.ok ? 200 : lifecycleHttpStatus(result.result.error),
      result.result.ok ? null : result.result.error.retryAfterSeconds,
      result.result.ok ? result.session : undefined,
    );
  } catch (cause) {
    const error =
      cause instanceof BookingFailure
        ? cause.error
        : cause instanceof DomainError
          ? bookingError(
              "VALIDATION_ERROR",
              "Send valid JSON management details.",
              { commitState: "NOT_APPLICABLE" },
            )
          : unavailable();
    return bookingJson(
      { ok: false, error },
      lifecycleHttpStatus(error),
      error.retryAfterSeconds,
    );
  }
}

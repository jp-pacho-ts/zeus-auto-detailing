import "server-only";
import type { AdminErrorCode } from "@/types/admin-contracts";
import type { LifecycleError } from "@/types/catalog-contracts";
import type { DayBookingView } from "@/types/contracts";
import { createAdminDayBooking } from "@/server/bookings-create";
import type { BookingConfiguration } from "@/server/bookings-credentials";
import { authorize, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import { adminEvent } from "./log";

// Walk-in and phone bookings (2026-11-27). ADMIN only: the engine's admin mode skips the online checks (challenge, per-client
// and shop budgets, the pause), so the permission is checked before anything else runs.
export type CreateBookingOptions = AdminOptions & { bookingConfig?: BookingConfiguration };

const CODE: Partial<Record<LifecycleError["code"], AdminErrorCode>> = {
  VALIDATION_ERROR: "VALIDATION_ERROR", CLIENT_UPGRADE_REQUIRED: "VALIDATION_ERROR",
  FULLY_BOOKED: "SCHEDULE_CONFLICT", DAY_CLOSED: "SCHEDULE_CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  CATALOG_UPDATED: "CATALOG_UPDATED", QUOTE_EXPIRED: "CATALOG_UPDATED", QUOTE_REQUIRED: "CATALOG_UPDATED", SERVICE_NOT_OFFERED: "CATALOG_UPDATED",
  RETRYABLE_ERROR: "RETRYABLE_ERROR", RATE_LIMITED: "RETRYABLE_ERROR",
};
// The form field each refusal is about, so the dialog shows it in place.
const FIELD: Partial<Record<LifecycleError["code"], string>> = { FULLY_BOOKED: "bookingDate", DAY_CLOSED: "bookingDate", BOOKING_LIMIT_REACHED: "customerPhone" };

export async function createBooking(actor: StaffActor, input: unknown, options: CreateBookingOptions = {}): Promise<{ booking: DayBookingView; replayed: boolean }> {
  authorize(actor, "BOOKING_CREATE");
  const { result } = await createAdminDayBooking(input, { db: options.db, config: options.bookingConfig, signal: options.signal });
  if (!result.ok) {
    const e = result.error, field = FIELD[e.code];
    throw new AdminServiceError(CODE[e.code] ?? "NOT_ALLOWED", e.message, { fieldErrors: field ? { ...e.fieldErrors, [field]: [e.message] } : e.fieldErrors });
  }
  const { booking, replayed } = result.data;
  adminEvent("admin.booking.created", { bookingId: booking.id, actorStaffId: actor.staffId, replayed });
  return { booking, replayed };
}

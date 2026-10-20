import "server-only";
import type { Prisma } from "@prisma/client";
import type { AdminBookingDetail } from "@/types/admin-contracts";
import { withStaffPermit, type StaffTx } from "@/server/auth/db-admission";
import { StaffAuthError } from "@/server/auth/errors";
import { lockShop, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, isGuardViolation } from "./errors";
import { adminEvent } from "./log";
import { loadDetail } from "./views";
import { lockBookingDates } from "@/server/bookings-locks";

// One STAFF_MUTATION permit and one READ COMMITTED transaction (ARCHITECTURE T-019 staff
// mutation algorithm). The shop lock is the first statement (ADR-005 §10, D3). Deferred P1-02
// guards are forced to run before the work returns, so a guard that fires is caught here and
// reported as a service defect (500 + admin.guard_violation), never as a user outcome. No
// external call ever runs inside.
export async function mutate<T>(options: AdminOptions, action: string, work: (tx: StaffTx) => Promise<T>): Promise<T> {
  return withStaffPermit("STAFF_MUTATION", (permit) => permit.write(async (tx) => {
    try {
      await lockShop(tx);
      const result = await work(tx);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      return result;
    } catch (error) {
      if (error instanceof StaffAuthError) throw error;
      if (isGuardViolation(error)) {
        adminEvent("admin.guard_violation", { action });
        throw new AdminServiceError("INTERNAL_ERROR");
      }
      throw error;
    }
  }), { db: options.db });
}

type BookingWithLines = Prisma.BookingGetPayload<{ include: { lineItems: true } }>;

export async function conflict(tx: StaffTx, code: "VERSION_CONFLICT" | "BOOKING_NOT_MANAGEABLE" | "SCHEDULE_CONFLICT" | "FORBIDDEN" | "VALIDATION_ERROR",
  bookingId: string, message?: string, fieldErrors?: Record<string, string[]>): Promise<never> {
  throw new AdminServiceError(code, message, { currentBooking: await loadDetail(tx, bookingId), fieldErrors });
}

// Steps 3-4: read the booking (404), refuse legacy rows where the day-queue model is needed,
// then the revision check before any legality or role check.
export async function loadForWrite(tx: StaffTx, bookingId: string, expectedRevision: number, opts: { v3?: boolean; dates?: readonly string[] } = {}): Promise<BookingWithLines> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { lineItems: { orderBy: { order: "asc" } } } });
  if (!booking) throw new AdminServiceError("NOT_FOUND");
  if (opts.v3 && booking.snapshotVersion !== "QUEUE_V3") await conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId, "This is a legacy booking. Only its status can change.");
  if (booking.revision !== expectedRevision) await conflict(tx, "VERSION_CONFLICT", bookingId);
  // mutate() already holds the shop lock; take every source/target date together in sorted order.
  await lockBookingDates(tx, [booking.bookingDate.toISOString().slice(0, 10), ...(opts.dates ?? [])]);
  return booking;
}

// Step 9: the revision bump comes first, conditioned on the expected revision.
export async function bump(tx: StaffTx, bookingId: string, expectedRevision: number, data: Prisma.BookingUncheckedUpdateManyInput = {}): Promise<void> {
  const { count } = await tx.booking.updateMany({ where: { id: bookingId, revision: expectedRevision }, data: { ...data, revision: expectedRevision + 1 } });
  if (count !== 1) await conflict(tx, "VERSION_CONFLICT", bookingId);
}

export async function audit(tx: StaffTx, actor: StaffActor, row: Omit<Prisma.BookingAuditEventUncheckedCreateInput, "actorStaffId">): Promise<void> {
  await tx.bookingAuditEvent.create({ data: { ...row, actorStaffId: actor.staffId } });
}

export async function detailOrThrow(tx: StaffTx, bookingId: string): Promise<AdminBookingDetail> {
  const detail = await loadDetail(tx, bookingId);
  if (!detail) throw new AdminServiceError("NOT_FOUND");
  return detail;
}

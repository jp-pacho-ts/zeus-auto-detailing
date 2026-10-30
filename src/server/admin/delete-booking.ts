import "server-only";
import type { AdminDeleteResult } from "@/types/admin-contracts";
import { DeleteBookingSchema, AdminIdSchema } from "@/lib/admin-validation";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import { loadForWrite, mutate } from "./mutation";

// P1-29: an ADMIN deletes any booking after typing its reference code. Everything that hangs off
// it goes in the same transaction through the audited delete_booking() function (the runtime role
// has no DELETE on those tables); the staff audit trail keeps its rows and gains one
// BOOKING_DELETED record with no customer details. The service checks first so a stale screen or a
// wrong code gets the normal answers; the function repeats every check (fail closed).
export async function deleteBooking(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminDeleteResult> {
  authorize(actor, "DELETE_BOOKING");
  const bookingId = parse(AdminIdSchema, id), v = parse(DeleteBookingSchema, input);
  return mutate(options, "delete_booking", async (tx) => {
    const booking = await loadForWrite(tx, bookingId, v.expectedRevision);
    if (booking.referenceCode !== v.reference) throw fieldError("reference", "The reference code does not match.");
    try {
      await tx.$queryRaw`SELECT delete_booking(${bookingId}, ${actor.staffId}, ${v.expectedRevision}::integer, ${v.reference})`;
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (text.includes("ZD005")) throw new AdminServiceError("BOOKING_NOT_MANAGEABLE", "A payout, assignment or stock record still points at this booking, so it can't be deleted.");
      if (text.includes("ZD004")) throw new AdminServiceError("FORBIDDEN");
      if (text.includes("ZD003")) throw fieldError("reference", "The reference code does not match.");
      if (text.includes("ZD002")) throw new AdminServiceError("VERSION_CONFLICT");
      if (text.includes("ZD001")) throw new AdminServiceError("NOT_FOUND");
      throw error;
    }
    adminEvent("admin.booking.deleted", { bookingId, actorStaffId: actor.staffId });
    return { deleted: true as const, reference: booking.referenceCode };
  });
}

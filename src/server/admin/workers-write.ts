import "server-only";
import { AdminIdSchema, WorkerAssignSchema } from "@/lib/admin-validation";
import {
  authorize,
  parse,
  type AdminOptions,
  type StaffActor,
} from "./context";
import { AdminServiceError } from "./errors";
import {
  audit,
  bump,
  conflict,
  detailOrThrow,
  loadForWrite,
  mutate,
} from "./mutation";

async function worker(
  actor: StaffActor,
  id: unknown,
  staffId: unknown,
  input: unknown,
  remove: boolean,
  options: AdminOptions,
) {
  authorize(actor, "WORKER_ASSIGN");
  const bookingId = parse(AdminIdSchema, id),
    targetStaffId = parse(AdminIdSchema, staffId),
    v = parse(WorkerAssignSchema, input);
  return mutate(options, "worker", async (tx) => {
    const b = await loadForWrite(tx, bookingId, v.expectedRevision, {
      v3: true,
    });
    if (!["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status))
      return conflict(tx, "BOOKING_NOT_MANAGEABLE", bookingId);
    const staff = await tx.staff.findUnique({
      where: { id: targetStaffId },
      select: { id: true, isActive: true },
    });
    if (!staff) throw new AdminServiceError("NOT_FOUND");
    const key = { bookingId_staffId: { bookingId, staffId: targetStaffId } };
    const current = await tx.bookingWorkerAssignment.findUnique({ where: key });
    if (!!current === !remove)
      return { booking: await detailOrThrow(tx, bookingId), noChange: true };
    if (!remove && !staff.isActive)
      return conflict(
        tx,
        "SCHEDULE_CONFLICT",
        bookingId,
        "Choose an active worker.",
      );
    await bump(tx, bookingId, v.expectedRevision);
    if (remove) await tx.bookingWorkerAssignment.delete({ where: key });
    else
      await tx.bookingWorkerAssignment.create({
        data: {
          bookingId,
          staffId: targetStaffId,
          assignedByStaffId: actor.staffId,
        },
      });
    await audit(tx, actor, {
      action: remove ? "WORKER_UNASSIGNED" : "WORKER_ASSIGNED",
      bookingId,
      targetStaffId,
      fromRevision: v.expectedRevision,
      toRevision: v.expectedRevision + 1,
    });
    return { booking: await detailOrThrow(tx, bookingId), noChange: false };
  });
}
export const assignWorker = (
  actor: StaffActor,
  id: unknown,
  staffId: unknown,
  input: unknown,
  options: AdminOptions = {},
) => worker(actor, id, staffId, input, false, options);
export const unassignWorker = (
  actor: StaffActor,
  id: unknown,
  staffId: unknown,
  input: unknown,
  options: AdminOptions = {},
) => worker(actor, id, staffId, input, true, options);

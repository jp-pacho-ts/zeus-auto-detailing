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
import type { StaffTx } from "@/server/auth/db-admission";

// The row and its audit row, inside a revision bump the caller already made: the database allows one bump per booking per transaction.
export async function dropAssignment(tx: StaffTx, actor: StaffActor, bookingId: string, targetStaffId: string, expectedRevision: number): Promise<void> {
  await tx.bookingWorkerAssignment.delete({ where: { bookingId_staffId: { bookingId, staffId: targetStaffId } } });
  await audit(tx, actor, {
    action: "WORKER_UNASSIGNED",
    bookingId,
    targetStaffId,
    fromRevision: expectedRevision,
    toRevision: expectedRevision + 1,
  });
}
export async function takeOff(tx: StaffTx, actor: StaffActor, bookingId: string, targetStaffId: string, expectedRevision: number): Promise<void> {
  await bump(tx, bookingId, expectedRevision);
  await dropAssignment(tx, actor, bookingId, targetStaffId, expectedRevision);
}

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
      select: { id: true, isActive: true, role: true },
    });
    if (!staff) throw new AdminServiceError("NOT_FOUND");
    const key = { bookingId_staffId: { bookingId, staffId: targetStaffId } };
    const current = await tx.bookingWorkerAssignment.findUnique({ where: key });
    if (!!current === !remove)
      return { booking: await detailOrThrow(tx, bookingId), noChange: true };
    // P1-61 (LE 2026-11-07): only an active staff name from the Team list can be newly assigned, so only such a name can be credited
    // commission. The admin and managers are not staff. Removing an assignment stays possible for anyone (clean-up of old data).
    if (!remove && (!staff.isActive || staff.role !== "DETAILER"))
      return conflict(
        tx,
        "SCHEDULE_CONFLICT",
        bookingId,
        "Choose an active staff member from the Team list.",
      );
    if (remove) {
      await takeOff(tx, actor, bookingId, targetStaffId, v.expectedRevision);
      return { booking: await detailOrThrow(tx, bookingId), noChange: false };
    }
    await bump(tx, bookingId, v.expectedRevision);
    await tx.bookingWorkerAssignment.create({
      data: {
        bookingId,
        staffId: targetStaffId,
        assignedByStaffId: actor.staffId,
      },
    });
    await audit(tx, actor, {
      action: "WORKER_ASSIGNED",
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

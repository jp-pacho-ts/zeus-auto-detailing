import "server-only";
import type { AdminBay, AdminCapDay } from "@/types/admin-contracts";
import {
  AdminDaySchema,
  AdminIdSchema,
  AdminQueueCodeSchema,
  BayCreateSchema,
  BayUpdateSchema,
  CapOverrideDeleteSchema,
  CapOverrideSchema,
  DefaultCapSchema,
} from "@/lib/admin-validation";
import type { StaffTx } from "@/server/auth/db-admission";
import {
  authorize,
  dateCarrier,
  manilaDate,
  parse,
  type AdminOptions,
  type StaffActor,
} from "./context";
import { futureCommitted } from "./capacity";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import { audit, mutate } from "./mutation";
import { toBay } from "./reads";

const today = (o: AdminOptions) => manilaDate(o.now?.() ?? new Date());
const nameKey = (name: string) => name.trim().toLowerCase();

// W10/W11: the bay list is ADMIN-only (A3). Bays have no revision column; updatedAt is the
// version token (PM decision D10).
export async function createBay(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminBay> {
  authorize(actor, "BAY_LIST");
  const v = parse(BayCreateSchema, input);
  return mutate(options, "bay_create", async (tx) => {
    if (await tx.bay.findUnique({ where: { nameKey: nameKey(v.name) } }))
      throw fieldError("name", "A bay with this name already exists.");
    const bay = await tx.bay.create({
      data: {
        bayType: v.bayType,
        name: v.name.trim(),
        nameKey: nameKey(v.name),
        sortOrder: v.sortOrder,
        updatedAt: new Date(),
      },
    });
    await audit(tx, actor, {
      action: "BAY_LIST_CHANGED",
      bayId: bay.id,
      newBayType: bay.bayType,
    });
    adminEvent("admin.bay.created", {
      bayId: bay.id,
      actorStaffId: actor.staffId,
    });
    return toBay(bay);
  });
}

export async function updateBay(
  actor: StaffActor,
  bayId: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminBay> {
  authorize(actor, "BAY_LIST");
  const id = parse(AdminIdSchema, bayId);
  const v = parse(BayUpdateSchema, input);
  return mutate(options, "bay_update", async (tx) => {
    const bay = await tx.bay.findUnique({ where: { id } });
    if (!bay) throw new AdminServiceError("NOT_FOUND");
    if (bay.updatedAt.toISOString() !== v.expectedUpdatedAt)
      throw new AdminServiceError(
        "VERSION_CONFLICT",
        "Someone else changed this bay. Reload and try again.",
      );
    if (
      v.name !== undefined &&
      nameKey(v.name) !== bay.nameKey &&
      (await tx.bay.findUnique({ where: { nameKey: nameKey(v.name) } }))
    ) {
      throw fieldError("name", "A bay with this name already exists.");
    }
    if (v.bayType !== undefined && v.bayType !== bay.bayType) {
      const allowed = (
        await tx.bayTypeQueue.findMany({ where: { bayType: v.bayType } })
      ).map((x) => x.queueCode);
      if (
        await tx.bookingBayAssignment.count({
          where: { bayId: id, booking: { queueCode: { notIn: allowed } } },
        })
      )
        throw fieldError(
          "bayType",
          "Release incompatible assignments before changing bay type.",
          "SCHEDULE_CONFLICT",
        );
    }
    const updated = await tx.bay.update({
      where: { id },
      data: {
        ...(v.bayType !== undefined ? { bayType: v.bayType } : {}),
        ...(v.name !== undefined
          ? { name: v.name.trim(), nameKey: nameKey(v.name) }
          : {}),
        ...(v.sortOrder !== undefined ? { sortOrder: v.sortOrder } : {}),
        ...(v.isActive !== undefined ? { isActive: v.isActive } : {}),
        updatedAt: new Date(Math.max(Date.now(), bay.updatedAt.getTime() + 1)),
      },
    });
    await audit(tx, actor, {
      action: "BAY_LIST_CHANGED",
      bayId: id,
      previousBayType: bay.bayType,
      newBayType: updated.bayType,
    });
    return toBay(updated);
  });
}

// W12-W14: caps are ADMIN-only. A cap never drops below committed bookings today or later
// (Manila); past days are history (P1-02 R34). Every change writes CAP_CHANGED.
async function loadQueue(tx: StaffTx, code: string) {
  const queue = await tx.bookingQueue.findUnique({ where: { code } });
  if (!queue) throw new AdminServiceError("NOT_FOUND");
  return queue;
}
const capConflict = (date: string) =>
  fieldError(
    "dailyCap",
    `${date} already has more bookings than that.`,
    "SCHEDULE_CONFLICT",
  );

export async function setDefaultCap(
  actor: StaffActor,
  code: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<{ code: string; dailyCap: number | null; revision: number }> {
  authorize(actor, "CAPS");
  const queueCode = parse(AdminQueueCodeSchema, code);
  const v = parse(DefaultCapSchema, input);
  return mutate(options, "cap_default", async (tx) => {
    const queue = await loadQueue(tx, queueCode);
    if (queue.revision !== v.expectedRevision)
      throw new AdminServiceError(
        "VERSION_CONFLICT",
        "Someone else changed this cap. Reload and try again.",
      );
    if (queue.dailyCap === v.dailyCap)
      return {
        code: queueCode,
        dailyCap: queue.dailyCap,
        revision: queue.revision,
      };
    const overridden = new Set(
      (
        await tx.queueCapOverride.findMany({
          where: { queueCode },
          select: { date: true },
        })
      ).map((o) => o.date.toISOString().slice(0, 10)),
    );
    const over = (await futureCommitted(tx, queueCode, today(options))).find(
      (d) => !overridden.has(d.date) && d.count > (v.dailyCap ?? Infinity),
    );
    if (over) throw capConflict(over.date);
    const updated = await tx.bookingQueue.update({
      where: { code: queueCode },
      data: {
        dailyCap: v.dailyCap,
        revision: queue.revision + 1,
        updatedAt: new Date(),
        updatedByStaffId: actor.staffId,
      },
    });
    await audit(tx, actor, {
      action: "CAP_CHANGED",
      queueCode,
      previousCap: queue.dailyCap,
      newCap: v.dailyCap,
    });
    adminEvent("admin.cap.changed", { queueCode, actorStaffId: actor.staffId });
    return {
      code: queueCode,
      dailyCap: updated.dailyCap,
      revision: updated.revision,
    };
  });
}

export async function setCapOverride(
  actor: StaffActor,
  code: unknown,
  date: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminCapDay> {
  authorize(actor, "CAPS");
  const queueCode = parse(AdminQueueCodeSchema, code);
  const day = parse(AdminDaySchema, date);
  const v = parse(CapOverrideSchema, input);
  return mutate(options, "cap_override", async (tx) => {
    await loadQueue(tx, queueCode);
    if (day < today(options))
      throw fieldError("date", "Past days can't be changed.");
    const key = { queueCode_date: { queueCode, date: dateCarrier(day) } };
    const existing = await tx.queueCapOverride.findUnique({ where: key });
    if ((existing?.revision ?? null) !== v.expectedRevision)
      throw new AdminServiceError(
        "VERSION_CONFLICT",
        "Someone else changed this day's cap. Reload and try again.",
      );
    if (existing && existing.dailyCap === v.dailyCap)
      return {
        date: day,
        dailyCap: existing.dailyCap,
        revision: existing.revision,
      };
    const [count] = await futureCommitted(tx, queueCode, day, day);
    if (count && count.count > v.dailyCap) throw capConflict(day);
    const row = existing
      ? await tx.queueCapOverride.update({
          where: key,
          data: {
            dailyCap: v.dailyCap,
            revision: existing.revision + 1,
            updatedAt: new Date(),
            updatedByStaffId: actor.staffId,
          },
        })
      : await tx.queueCapOverride.create({
          data: {
            queueCode,
            date: dateCarrier(day),
            dailyCap: v.dailyCap,
            updatedAt: new Date(),
            updatedByStaffId: actor.staffId,
          },
        });
    await audit(tx, actor, {
      action: "CAP_CHANGED",
      queueCode,
      capDate: dateCarrier(day),
      previousCap: existing?.dailyCap ?? null,
      newCap: v.dailyCap,
    });
    return { date: day, dailyCap: row.dailyCap, revision: row.revision };
  });
}

export async function deleteCapOverride(
  actor: StaffActor,
  code: unknown,
  date: unknown,
  input: unknown,
  options: AdminOptions = {},
): Promise<{ deleted: true }> {
  authorize(actor, "CAPS");
  const queueCode = parse(AdminQueueCodeSchema, code);
  const day = parse(AdminDaySchema, date);
  const v = parse(CapOverrideDeleteSchema, input);
  return mutate(options, "cap_override_delete", async (tx) => {
    const queue = await loadQueue(tx, queueCode);
    const key = { queueCode_date: { queueCode, date: dateCarrier(day) } };
    const existing = await tx.queueCapOverride.findUnique({ where: key });
    if (!existing) throw new AdminServiceError("NOT_FOUND");
    if (existing.revision !== v.expectedRevision)
      throw new AdminServiceError(
        "VERSION_CONFLICT",
        "Someone else changed this day's cap. Reload and try again.",
      );
    if (day >= today(options)) {
      const [count] = await futureCommitted(tx, queueCode, day, day);
      if (count && count.count > (queue.dailyCap ?? Infinity))
        throw capConflict(day);
    }
    await tx.queueCapOverride.delete({ where: key });
    await audit(tx, actor, {
      action: "CAP_CHANGED",
      queueCode,
      capDate: dateCarrier(day),
      previousCap: existing.dailyCap,
      newCap: null,
    });
    return { deleted: true };
  });
}

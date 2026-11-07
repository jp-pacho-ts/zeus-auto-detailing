import "server-only";
import type { BayContainer } from "@prisma/client";
import type { AdminBay, AdminContainer } from "@/types/admin-contracts";
import { AdminIdSchema, BayMoveSchema, ContainerCreateSchema, ContainerRemoveSchema, ContainerUpdateSchema } from "@/lib/admin-validation";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError, fieldError } from "./errors";
import { adminEvent } from "./log";
import { mutate } from "./mutation";
import { toBay } from "./reads";

// P1-62 A1: bay containers. ADMIN only (the bay list permission, BAY_LIST), enforced here and again inside every database function
// (admin_assert_actor). The app role can only read bay_containers: each write is an owner-run SECURITY DEFINER function that takes the shop
// lock, checks the version (updatedAt), writes the row and its audit row together, and returns an error code this file maps to a plain
// message. A container is a named group of bays; any car can go in any bay. The optional label ("usually for") is a list of queue codes.

function read<T>(options: AdminOptions, work: (tx: StaffTx) => Promise<T>): Promise<T> {
  return withStaffDb("STAFF_READ", work, { access: "read", db: options.db, signal: options.signal });
}

function mapContainerError(error: unknown): never {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("ZK001")) throw new AdminServiceError("NOT_FOUND");
  if (text.includes("ZK002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed this. Reload and try again.");
  if (text.includes("ZK004")) throw new AdminServiceError("NOT_ALLOWED", "Move or remove its bays first.");
  if (text.includes("ZK005")) throw new AdminServiceError("NOT_ALLOWED", "There must always be at least one container.");
  if (text.includes("ZK006")) throw new AdminServiceError("VALIDATION_ERROR");
  if (text.includes("ZK007")) throw fieldError("name", "A container or bay with that name already exists.");
  if (text.includes("ZK010")) throw new AdminServiceError("NOT_ALLOWED", "That container was removed.");
  if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
  throw error;
}

type Row = BayContainer & { _count: { bays: number } };
const withCount = { _count: { select: { bays: { where: { isActive: true } } } } } as const;
const toContainer = (r: Row): AdminContainer => ({
  id: r.id, name: r.name, sortOrder: r.sortOrder, isActive: r.isActive, usualQueues: r.usualQueues, updatedAt: r.updatedAt.toISOString(), bayCount: r._count.bays,
});
async function containerOrThrow(tx: StaffTx, id: string): Promise<AdminContainer> {
  const r = await tx.bayContainer.findUnique({ where: { id }, include: withCount });
  if (!r) throw new AdminServiceError("NOT_FOUND");
  return toContainer(r);
}

export async function listContainers(actor: StaffActor, options: AdminOptions = {}): Promise<AdminContainer[]> {
  authorize(actor, "BAY_LIST");
  return read(options, async (tx) => (await tx.bayContainer.findMany({ where: { isActive: true }, include: withCount, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })).map(toContainer));
}

export async function addContainer(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminContainer> {
  authorize(actor, "BAY_LIST");
  const v = parse(ContainerCreateSchema, input);
  return mutate(options, "container_add", async (tx) => {
    let replayed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { replayed: boolean } }[]>`SELECT admin_container_create(${actor.staffId}, ${v.id}, ${v.name}, ${v.usualQueues ?? []}::text[]) AS r`;
      replayed = row.r.replayed;
    } catch (error) { return mapContainerError(error); }
    adminEvent("admin.container.created", { actorStaffId: actor.staffId, targetId: v.id, replayed });
    return containerOrThrow(tx, v.id);
  });
}

export async function updateContainer(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminContainer> {
  authorize(actor, "BAY_LIST");
  const containerId = parse(AdminIdSchema, id), v = parse(ContainerUpdateSchema, input);
  return mutate(options, "container_update", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_container_update(${actor.staffId}, ${containerId}, ${new Date(v.expectedUpdatedAt)}::timestamptz, ${v.name ?? null}::text, ${v.usualQueues ?? []}::text[], ${v.usualQueues !== undefined}) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapContainerError(error); }
    adminEvent("admin.container.updated", { actorStaffId: actor.staffId, targetId: containerId, changed });
    return containerOrThrow(tx, containerId);
  });
}

// Remove = deactivate. Only a container with no active bay (so no car), never the last active one; the name stays reserved.
export async function removeContainer(actor: StaffActor, id: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminContainer> {
  authorize(actor, "BAY_LIST");
  const containerId = parse(AdminIdSchema, id), v = parse(ContainerRemoveSchema, input);
  return mutate(options, "container_remove", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_container_remove(${actor.staffId}, ${containerId}, ${new Date(v.expectedUpdatedAt)}::timestamptz) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapContainerError(error); }
    adminEvent("admin.container.removed", { actorStaffId: actor.staffId, targetId: containerId, changed });
    return containerOrThrow(tx, containerId);
  });
}

// Move a bay to any active container. A car in it stays in it.
export async function moveBay(actor: StaffActor, bayId: unknown, input: unknown, options: AdminOptions = {}): Promise<AdminBay> {
  authorize(actor, "BAY_LIST");
  const id = parse(AdminIdSchema, bayId), v = parse(BayMoveSchema, input);
  return mutate(options, "bay_move", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_bay_move(${actor.staffId}, ${id}, ${v.containerId}, ${new Date(v.expectedUpdatedAt)}::timestamptz) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapContainerError(error); }
    adminEvent("admin.bay.moved", { actorStaffId: actor.staffId, bayId: id, changed });
    const bay = await tx.bay.findUnique({ where: { id } });
    if (!bay) throw new AdminServiceError("NOT_FOUND");
    return toBay(bay);
  });
}

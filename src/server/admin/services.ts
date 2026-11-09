import "server-only";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import {
  AdminIdSchema,
  ServiceCreateSchema,
  ServiceUpdateSchema,
} from "@/lib/admin-validation";
import type {
  AdminServiceList,
} from "@/types/admin-contracts";

export async function listAdminServices(
  actor: StaffActor,
  options: AdminOptions = {},
): Promise<AdminServiceList> {
  authorize(actor, "SETTINGS_READ");
  return withStaffDb(
    "STAFF_READ",
    async (tx: StaffTx) => {
      const rows = await tx.$queryRaw<{ admin_service_list: AdminServiceList }[]>`
        SELECT admin_service_list(${actor.staffId})
      `;
      return rows[0]?.admin_service_list ?? { services: [], vehicleCategories: [] };
    },
    { access: "read", db: options.db, signal: options.signal },
  );
}

export async function updateAdminService(
  actor: StaffActor,
  rawServiceId: unknown,
  rawInput: unknown,
  options: AdminOptions = {},
): Promise<{ ok: true; serviceId: string }> {
  authorize(actor, "SETTINGS_WRITE");
  const serviceId = parse(AdminIdSchema, rawServiceId);
  const input = parse(ServiceUpdateSchema, rawInput);

  return withStaffDb(
    "STAFF_MUTATION",
    async (tx: StaffTx) => {
      try {
        await tx.$executeRawUnsafe(
          "SELECT admin_service_update($1, $2, $3, $4, $5, $6::jsonb)",
          actor.staffId,
          serviceId,
          input.name,
          input.description ?? null,
          input.category,
          JSON.stringify(input.offers),
        );
        return { ok: true, serviceId };
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
        throw error;
      }
    },
    { access: "write", db: options.db, signal: options.signal },
  );
}

export async function createAdminService(
  actor: StaffActor,
  rawInput: unknown,
  options: AdminOptions = {},
): Promise<{ ok: true; serviceId: string }> {
  authorize(actor, "SETTINGS_WRITE");
  const input = parse(ServiceCreateSchema, rawInput);

  return withStaffDb(
    "STAFF_MUTATION",
    async (tx: StaffTx) => {
      try {
        const rows = await tx.$queryRaw<{ admin_service_create: string }[]>`
          SELECT admin_service_create(
            ${actor.staffId},
            ${input.name},
            ${input.description ?? null},
            ${input.category},
            ${input.type},
            ${input.unit},
            ${JSON.stringify(input.offers)}::jsonb
          )
        `;
        const serviceId = rows[0]?.admin_service_create;
        if (!serviceId) throw new AdminServiceError("INTERNAL_ERROR", "Failed to create service");
        return { ok: true, serviceId };
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
        throw error;
      }
    },
    { access: "write", db: options.db, signal: options.signal },
  );
}

export async function toggleAdminService(
  actor: StaffActor,
  rawServiceId: unknown,
  active: boolean,
  options: AdminOptions = {},
): Promise<{ ok: true }> {
  authorize(actor, "SETTINGS_WRITE");
  const serviceId = parse(AdminIdSchema, rawServiceId);

  return withStaffDb(
    "STAFF_MUTATION",
    async (tx: StaffTx) => {
      try {
        await tx.$executeRawUnsafe(
          "SELECT admin_service_toggle_active($1, $2, $3::boolean)",
          actor.staffId,
          serviceId,
          active,
        );
        return { ok: true };
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
        throw error;
      }
    },
    { access: "write", db: options.db, signal: options.signal },
  );
}

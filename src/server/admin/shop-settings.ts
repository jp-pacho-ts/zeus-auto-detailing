import "server-only";
import { ShopSettingsUpdateSchema } from "@/lib/admin-validation";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { notificationConfiguration } from "@/server/notifications/bookings";
import { onlineBookingPaused } from "@/server/online-booking-mode";
import type { AdminShopSettings } from "@/types/admin-contracts";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import { adminEvent } from "./log";
import { mutate } from "./mutation";

// P1-42 Settings. ADMIN only, enforced here and again inside the database function (admin_assert_actor). The app role can only read the row: the one
// write is an owner-run SECURITY DEFINER function that locks the shop, writes the row and one audit row per setting changed. No secret, address or
// password ever reaches this file's answers: email is a yes or no and two counts.

const WEEK_MS = 7 * 86_400_000;

function mapError(error: unknown): never {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("ZT001")) throw new AdminServiceError("NOT_FOUND");
  if (text.includes("ZT002")) throw new AdminServiceError("VERSION_CONFLICT", "Someone else changed the settings. Reload and try again.");
  if (text.includes("ZT004")) throw new AdminServiceError("FORBIDDEN");
  if (text.includes("ZT006")) throw new AdminServiceError("VALIDATION_ERROR");
  throw error;
}

function emailConfigured(): boolean {
  try {
    return notificationConfiguration() !== null;
  } catch {
    return false;
  }
}

async function view(tx: StaffTx, options: AdminOptions): Promise<AdminShopSettings> {
  const row = await tx.shopSettings.findUnique({ where: { id: 1 } });
  if (!row) throw new AdminServiceError("NOT_FOUND");
  const since = new Date((options.now?.() ?? new Date()).getTime() - WEEK_MS);
  const [failedLast7Days, waitingLast7Days] = await Promise.all(["FAILED", "PENDING"].map((state) => tx.bookingNotificationOutbox.count({ where: { state, createdAt: { gte: since } } })));
  return {
    revision: row.revision,
    maintenance: row.maintenance,
    maintenanceMessage: row.maintenanceMessage,
    bookingPaused: row.bookingPaused,
    bookingPausedByServer: onlineBookingPaused(),
    updatedAt: row.updatedAt.toISOString(),
    email: { configured: emailConfigured(), failedLast7Days, waitingLast7Days },
  };
}

export async function getShopSettings(actor: StaffActor, options: AdminOptions = {}): Promise<AdminShopSettings> {
  authorize(actor, "SETTINGS_READ");
  return withStaffDb("STAFF_READ", (tx) => view(tx, options), { access: "read", db: options.db, signal: options.signal });
}

export async function setShopSettings(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminShopSettings> {
  authorize(actor, "SETTINGS_WRITE");
  const v = parse(ShopSettingsUpdateSchema, input);
  return mutate(options, "shop_settings", async (tx) => {
    let changed: boolean;
    try {
      const [row] = await tx.$queryRaw<{ r: { changed: boolean } }[]>`SELECT admin_shop_settings_set(${actor.staffId}, ${v.expectedRevision}::integer, ${v.maintenance}::boolean, ${v.maintenanceMessage}::text, ${v.bookingPaused}::boolean) AS r`;
      changed = row.r.changed;
    } catch (error) { return mapError(error); }
    adminEvent("admin.settings.changed", { actorStaffId: actor.staffId, changed });
    return view(tx, options);
  });
}

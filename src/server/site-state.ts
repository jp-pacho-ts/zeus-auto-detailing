import "server-only";
import { cachedFor } from "@/lib/maintenance";
import { withBookingDb } from "./bookings-admission";
import { prisma } from "./db";

// P1-42: the public answer the proxy asks for. Anyone can call this route, so one database read serves everyone for 3 seconds. A draft message
// stays private while the site is live. A failed read answers live (cachedFor): the site is never taken down by its own check.
export const readSiteState = cachedFor(async () => {
  try {
    const row = await withBookingDb(prisma, "READ", (tx) => tx.shopSettings.findUnique({ where: { id: 1 }, select: { maintenance: true, maintenanceMessage: true } }));
    return { maintenance: row?.maintenance ?? false, message: row?.maintenance ? row.maintenanceMessage : null };
  } catch (error) {
    console.warn(JSON.stringify({ event: "site_state.read_failed" }));
    throw error;
  }
}, 3_000);

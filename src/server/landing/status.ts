import "server-only";
import { prisma } from "@/server/db";
import { withBookingDb } from "@/server/bookings-admission";
import { databaseBookingPaused } from "@/server/online-booking-mode";

export type LandingStatus = "OPEN" | "PAUSED" | "UNKNOWN";
export async function resolveLandingStatus(mode: string | undefined, read: () => Promise<boolean>): Promise<LandingStatus> {
  if (mode === "PAUSED") return "PAUSED";
  try { return await read() ? "PAUSED" : "OPEN"; } catch { return "UNKNOWN"; }
}
export const getLandingStatus = () => resolveLandingStatus(process.env.ONLINE_BOOKING_MODE, () => withBookingDb(prisma, "READ", async (tx) => {
  await tx.$queryRaw`SELECT set_config('statement_timeout', '1000', true)`;
  return databaseBookingPaused(tx);
}, AbortSignal.timeout(1000)));

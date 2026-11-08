import "server-only";
import type { Prisma } from "@prisma/client";
// P1-19 W2: the home page's booking calls to action follow the server's pause switch. It is read
// when the page renders on the server (no API or contract change); Railway applies a changed
// ONLINE_BOOKING_MODE with a redeploy, so the built page always matches the running mode.
export const onlineBookingPaused = (env: Record<string, string | undefined> = process.env) => env.ONLINE_BOOKING_MODE === "PAUSED";

// P1-42: the database switch can only close. The server setting stays the floor, so a mistake on the screen cannot open what Railway closed.
export const effectiveBookingMode = (mode: "OPEN" | "PAUSED", databasePaused: boolean): "OPEN" | "PAUSED" => (mode === "PAUSED" || databasePaused ? "PAUSED" : "OPEN");
export async function databaseBookingPaused(tx: Pick<Prisma.TransactionClient, "shopSettings">): Promise<boolean> {
  return (await tx.shopSettings.findUnique({ where: { id: 1 }, select: { bookingPaused: true } }))?.bookingPaused ?? false;
}

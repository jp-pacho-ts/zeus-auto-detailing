import "server-only";
import type { Prisma } from "@prisma/client";
import { BookingFailure, bookingError, unavailable } from "./bookings-errors";

// Exact rolling DB-clock quotas. Every caller holds the canonical shop lock before insertion.
export async function admitManagementReceipt(
  tx: Prisma.TransactionClient,
  kind: "CREATE" | "CANCEL" | "RESCHEDULE",
  bookingId: string | null,
  clientHash: string,
  now: Date,
  fence: boolean,
): Promise<void> {
  const since = new Date(now.getTime() - 86400000),
    hour = now.getTime() - 3600000;
  const rows = await tx.bookingOperation.findMany({
    where: {
      createdAt: { gt: since },
      ...(kind === "CREATE"
        ? { kind: "CREATE", outcome: { not: "COMMITTED" } }
        : { kind: { in: ["CANCEL", "RESCHEDULE"] } }),
    },
    select: {
      createdAt: true,
      bookingId: true,
      clientHash: true,
      outcome: true,
    },
  });
  const hourly = (r: { createdAt: Date }) => r.createdAt.getTime() > hour;
  const wait = (r: typeof rows, ms: number) =>
    Math.max(
      60,
      Math.ceil(
        (Math.min(...r.map((x) => x.createdAt.getTime())) +
          ms -
          now.getTime()) /
          1000,
      ),
    );
  const refuse = (set: typeof rows, h: number, d: number, client: boolean) => {
    const recent = set.filter(hourly);
    if (recent.length < h && set.length < d) return;
    const seconds =
      recent.length >= h ? wait(recent, 3600000) : wait(set, 86400000);
    throw new BookingFailure(
      client
        ? bookingError("RATE_LIMITED", "Please wait before retrying.", {
            retryable: true,
            retryAfterSeconds: seconds,
          })
        : unavailable(seconds),
    );
  };
  if (kind === "CREATE") {
    refuse(
      rows.filter((r) => r.clientHash === clientHash),
      5,
      20,
      true,
    );
    refuse(rows, 100, 500, false);
    if (!fence)
      refuse(
        rows.filter((r) => r.outcome !== "CLOSED_WITHOUT_COMMIT"),
        50,
        250,
        false,
      );
  } else {
    refuse(
      rows.filter((r) => r.bookingId === bookingId),
      6,
      20,
      true,
    );
    refuse(rows, 100, 300, false);
    if (!fence)
      refuse(
        rows.filter((r) => r.outcome !== "CLOSED_WITHOUT_COMMIT"),
        80,
        250,
        false,
      );
  }
}

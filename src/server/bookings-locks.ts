import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
export async function lockBookingShop(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::int,$2::int)", 746001, 1);
}
// Call only AFTER lockBookingShop. Exported for P1-07/P1-04 to share lock ordering.
export async function lockBookingDates(tx: Prisma.TransactionClient, dates: readonly string[]): Promise<void> {
    for (const date of [...new Set(dates)].sort())
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::int,$2::int)", 746002, createHash("sha256").update(date).digest().readInt32BE(0));
}
export async function bookingDbNow(tx: Prisma.TransactionClient): Promise<Date> {
    return (await tx.$queryRaw<{
        now: Date;
    }[]> `SELECT statement_timestamp() AS now`)[0].now;
}

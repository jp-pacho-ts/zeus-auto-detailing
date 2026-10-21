import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AdmissionRefused, createSemaphore } from "./auth/semaphore";
import { createLoginLimiter } from "./auth/rate-limit";
import { BookingFailure, bookingError, unavailable } from "./bookings-errors";
// Per-client request admission. Only the minute window and concurrency limit these routes; the
// durable per-client and shop budgets live in the booking ledger (P1-10 M3).
export const CREATE_ADMISSION_POLICY = {
    perKeyPerMinute: 15, perKeyPerDay: null, maxConcurrentPerKey: 1
} as const;
export const PUBLIC_READ_ADMISSION_POLICY = {
    perKeyPerMinute: 60, perKeyPerDay: null, maxConcurrentPerKey: 2
} as const;
export const createAdmission = createLoginLimiter(CREATE_ADMISSION_POLICY);
export const publicReadAdmission = createLoginLimiter(PUBLIC_READ_ADMISSION_POLICY);
export const BOOKING_POOL_POLICY = {
    PREFLIGHT: { maxActive: 2, maxQueued: 10, maxWaitMs: 1000 },
    CREATE: { maxActive: 2, maxQueued: 20, maxWaitMs: 3000 },
    READ: { maxActive: 2, maxQueued: 10, maxWaitMs: 1000 },
    NOTIFICATION: { maxActive: 1, maxQueued: 4, maxWaitMs: 1000 },
} as const;
const pools = {
    PREFLIGHT: createSemaphore(BOOKING_POOL_POLICY.PREFLIGHT),
    CREATE: createSemaphore(BOOKING_POOL_POLICY.CREATE),
    READ: createSemaphore(BOOKING_POOL_POLICY.READ),
    NOTIFICATION: createSemaphore(BOOKING_POOL_POLICY.NOTIFICATION),
};
export async function withBookingDb<T>(db: PrismaClient, scope: keyof typeof pools, work: (tx: Prisma.TransactionClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let release: (() => void) | undefined;
    try {
        release = await pools[scope].acquire(signal);
        return await db.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT set_config('statement_timeout', ${scope === "PREFLIGHT" ? "1000" : "3000"},true),set_config('lock_timeout','2000',true)`;
            const read = scope === "READ" || scope === "PREFLIGHT";
            if (read && signal?.aborted)
                throw new AdmissionRefused("ABORTED");
            const result = await work(tx);
            if (read && signal?.aborted)
                throw new AdmissionRefused("ABORTED");
            return result;
        }, {
            isolationLevel: scope === "READ" || scope === "PREFLIGHT" ? Prisma.TransactionIsolationLevel.RepeatableRead : Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 15000
        });
    }
    finally {
        release?.();
    }
    // Once a statement starts, abort never cancels it or acquires another permit. Reads are
    // bounded by statement_timeout, and writes finish with their atomic receipt.
}
export function enterBooking(limiter: typeof createAdmission, key: string): () => void {
    const ticket = limiter.enter(key);
    if (!ticket.ok)
        throw new BookingFailure(bookingError("RATE_LIMITED", "Please wait before retrying.", { retryable: true, retryAfterSeconds: ticket.retryAfterSeconds }));
    return ticket.leave;
}
export const isAdmissionError = (error: unknown) => error instanceof BookingFailure ? error.error : unavailable();

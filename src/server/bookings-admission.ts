import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AdmissionRefused, createSemaphore } from "./auth/semaphore";
import { createLoginLimiter } from "./auth/rate-limit";
import { BookingFailure, bookingError, unavailable } from "./bookings-errors";
export const createAdmission = createLoginLimiter({
    perKeyPerMinute: 15, perKeyPerDay: 10000, maxConcurrentPerKey: 1
});
export const publicReadAdmission = createLoginLimiter({
    perKeyPerMinute: 60, perKeyPerDay: 10000, maxConcurrentPerKey: 2
});
const pools = {
    PREFLIGHT: createSemaphore({
        maxActive: 2, maxQueued: 10, maxWaitMs: 1000
    }),
    CREATE: createSemaphore({
        maxActive: 2, maxQueued: 20, maxWaitMs: 3000
    }),
    READ: createSemaphore({
        maxActive: 2, maxQueued: 10, maxWaitMs: 1000
    }),
    NOTIFICATION: createSemaphore({
        maxActive: 1, maxQueued: 4, maxWaitMs: 1000
    }),
    RECOVERY_LOOKUP: createSemaphore({maxActive:2,maxQueued:20,maxWaitMs:2000}),
    RECOVERY_FENCE: createSemaphore({maxActive:1,maxQueued:5,maxWaitMs:2000}),
    MANAGEMENT_EXCHANGE: createSemaphore({maxActive:2,maxQueued:10,maxWaitMs:2000}),
    MANAGEMENT_READ: createSemaphore({maxActive:4,maxQueued:20,maxWaitMs:2000}),
    MANAGEMENT_MUTATION: createSemaphore({maxActive:2,maxQueued:10,maxWaitMs:3000}),
};
export async function withBookingDb<T>(db: PrismaClient, scope: keyof typeof pools, work: (tx: Prisma.TransactionClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let release: (() => void) | undefined;
    try {
        release = await pools[scope].acquire(signal);
        return await db.$transaction(async (tx) => {
            const statement=scope==="PREFLIGHT"?"1000":["RECOVERY_LOOKUP","MANAGEMENT_EXCHANGE"].includes(scope)?"2000":scope==="MANAGEMENT_MUTATION"?"5000":"3000";
            const lock=scope==="MANAGEMENT_MUTATION"?"5000":"2000";
            await tx.$queryRaw `SELECT set_config('statement_timeout', ${statement},true),set_config('lock_timeout',${lock},true)`;
            const read = ["READ","PREFLIGHT","RECOVERY_LOOKUP","MANAGEMENT_READ","MANAGEMENT_EXCHANGE"].includes(scope);
            if (read && signal?.aborted)
                throw new AdmissionRefused("ABORTED");
            const result = await work(tx);
            if (read && signal?.aborted)
                throw new AdmissionRefused("ABORTED");
            return result;
        }, {
            isolationLevel: ["READ","PREFLIGHT","RECOVERY_LOOKUP","MANAGEMENT_READ","MANAGEMENT_EXCHANGE"].includes(scope) ? Prisma.TransactionIsolationLevel.RepeatableRead : Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 15000
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

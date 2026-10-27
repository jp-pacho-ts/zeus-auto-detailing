import "server-only";
import { DayAvailabilitySchema } from "@/lib/validation";
import type { DayAvailabilityResponse } from "@/types/contracts";
import { loadCurrentRelease } from "./catalog-read";
import { priceSelection } from "./catalog-pricing";
import { signQuote } from "./catalog-quote-token";
import { prisma } from "./db";
import { addDays, readDayStates, validDay } from "./availability-days";
import { manilaToday } from "./availability-core";
import { bookingDbNow } from "./bookings-locks";
import { bookingError, unavailable } from "./bookings-errors";
import { enterBooking, publicReadAdmission, withBookingDb } from "./bookings-admission";
import { parseBookingConfiguration } from "./bookings-credentials";
import { trustedClientKey } from "./auth/client-identity";
import { sha256 } from "./bookings-hash";
import type { CreateDayBookingOptions } from "./bookings-create";
export async function getDayAvailability(input: unknown, options: CreateDayBookingOptions = {}): Promise<DayAvailabilityResponse> {
    let leave: (() => void) | undefined;
    try {
        const c = options.config ?? parseBookingConfiguration();
        leave = enterBooking(publicReadAdmission, sha256(trustedClientKey(options.headers ?? new Headers(), c.identity)));
        const parsed = DayAvailabilitySchema.safeParse(input);
        if (!parsed.success)
            return { ok: false, error: bookingError("VALIDATION_ERROR", "Check the selected services and days.", { commitState: "NOT_APPLICABLE" }) };
        const r = parsed.data;
        return await withBookingDb(options.db ?? prisma, "READ", async (tx) => {
            const now = options.now ?? await bookingDbNow(tx);
            if (!validDay(r.fromDate, now))
                return { ok: false as const, error: bookingError("VALIDATION_ERROR", "Choose a day from today through the next 90 days.", { commitState: "NOT_APPLICABLE" }) };
            const release = await loadCurrentRelease(tx);
            if (!release)
                throw new Error("No catalog");
            const q = priceSelection(release, { vehicleCategoryId: r.vehicleCategoryId, lines: r.lines });
            if (q.kind === "REJECTED")
                return { ok: false as const, error: bookingError(q.error.code, q.error.message, { commitState: "NOT_APPLICABLE", fieldErrors: q.error.fieldErrors }) };
            const through = addDays(manilaToday(now), 90), days = await readDayStates(tx, q.quote.queueId, r.fromDate, through, now);
            return { ok: true as const, data: {
                    timezone: "Asia/Manila" as const, days: days.slice(0, r.days), nextAvailableDay: days.find(d => d.state === "AVAILABLE")?.date ?? null, searchedThrough: through, generatedAt: now.toISOString(), quote: signQuote(q.quote, c.quote, now), onlineBookingStatus: c.mode
                } };
        }, options.signal);
    }
    catch (error) {
        const e = error && typeof error === "object" && "error" in error ? error.error : unavailable();
        return { ok: false, error: { ...(e as ReturnType<typeof unavailable>), commitState: "NOT_APPLICABLE" } };
    }
    finally {
        leave?.();
    }
}

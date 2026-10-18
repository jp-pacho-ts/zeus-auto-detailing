import { pendingAlertLevel } from "./bookings-alerts";
import "server-only";
import { randomInt } from "node:crypto";
import { Prisma, type BookingOperation, type PrismaClient, type Booking, type BookingLineItem } from "@prisma/client";
import { CreateDayBookingSchema } from "@/lib/validation";
import type { CreateDayBookingRequest, DayBookingResponse, DayBookingView } from "@/types/contracts";
import type { LifecycleError } from "@/types/catalog-contracts";
import { checkAcceptedQuote } from "./catalog-quote";
import { prisma } from "./db";
import { trustedClientKey } from "./auth/client-identity";
import { bookingRequestHash, sha256 } from "./bookings-hash";
import { lockBookingDates, lockBookingShop, bookingDbNow } from "./bookings-locks";
import { BookingFailure, bookingError, paused, unavailable } from "./bookings-errors";
import { createAdmission, enterBooking, withBookingDb } from "./bookings-admission";
import { parseBookingConfiguration, grantExpiry, signManagementToken, type BookingConfiguration } from "./bookings-credentials";
import { verifyTurnstile, turnstileRemoteIp } from "./bookings-turnstile";
import { readDayStates, dayWindow, validDay } from "./availability-days";
import { drainShopNotifications, shopNotificationMessage, type NotificationConfiguration } from "./notifications/bookings";
export { lockBookingDates, lockBookingShop } from "./bookings-locks";
export interface CreateDayBookingOptions {
    db?: PrismaClient;
    config?: BookingConfiguration;
    headers?: Headers;
    signal?: AbortSignal;
    turnstileEndpoint?: string;
    notification?: NotificationConfiguration;
}
export interface BookingCommit {
    result: DayBookingResponse;
    created: boolean;
    session?: {
        token: string;
        expiresAt: string;
    };
}
const fail = (error: LifecycleError): BookingCommit => ({ result: { ok: false, error }, created: false });
const reject = (code: LifecycleError["code"], message: string) => bookingError(code, message, { commitState: "NOT_COMMITTED" });
const referenceCode = () => "ZEUS-" + Array.from({ length: 6 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[randomInt(36)]).join("");
export function publicDayBooking(b: Booking & {
    lineItems: BookingLineItem[];
}): DayBookingView {
    const lines = b.lineItems.filter(l => !l.removedAt).sort((a, c) => a.order - c.order).map(l => ({
        serviceId: l.serviceId, name: l.nameSnapshot, quantity: l.quantity, priceStatus: (l.staffPriceCentavos !== null || l.priceStatus === "PRICED" ? "PRICED" : "FOR_QUOTE") as "PRICED" | "FOR_QUOTE", subtotalCentavos: l.staffPriceCentavos ?? l.subtotalCentavos, referenceSubtotalCentavos: l.referenceSubtotalCentavos
    }));
    const total = lines.reduce((s, l) => s + (l.subtotalCentavos ?? 0), 0), pending = lines.filter(l => l.priceStatus === "FOR_QUOTE");
    return {
        id: b.id, referenceCode: b.referenceCode, status: b.status, revision: b.revision, bookingDate: b.bookingDate.toISOString().slice(0, 10), timezone: "Asia/Manila", vehicleCategoryId: b.vehicleCategoryId, vehicleCategoryName: b.vehicleCategoryNameSnapshot, lines, totalPriceCentavos: total, estimatedTotalCentavos: pending.some(l => l.referenceSubtotalCentavos === null) ? null : total + pending.reduce((s, l) => s + (l.referenceSubtotalCentavos ?? 0), 0), currency: "PHP"
    };
}
type Counts = {
    committed: {
        createdAt: Date;
        clientHash: string | null;
    }[];
    anonymous: {
        createdAt: Date;
        clientHash: string | null;
        outcome: string;
    }[];
};
async function counts(tx: Prisma.TransactionClient, now: Date): Promise<Counts> {
    const since = new Date(now.getTime() - 86400000);
    const rows = await tx.bookingOperation.findMany({ where: { kind: "CREATE", createdAt: { gt: since } }, select: {
            outcome: true, createdAt: true, clientHash: true
        } });
    return { committed: rows.filter(r => r.outcome === "COMMITTED"), anonymous: rows.filter(r => r.outcome !== "COMMITTED") };
}
function waitFor(rows: {
    createdAt: Date;
}[], now: Date, windowMs: number): number {
    return Math.max(60, Math.ceil((Math.min(...rows.map(r => r.createdAt.getTime())) + windowMs - now.getTime()) / 1000));
}
export function newEffectBudget(c: Counts, clientHash: string, cap: number, now: Date): LifecycleError | null {
    const hour = (r: {
        createdAt: Date;
    }) => r.createdAt.getTime() > now.getTime() - 3600000, recent = c.committed.filter(r => r.createdAt.getTime() > now.getTime() - 86400000), mine = recent.filter(r => r.clientHash === clientHash), h = mine.filter(hour);
    if (h.length >= 3 || mine.length >= 6)
        return bookingError("RATE_LIMITED", "Please wait before making another booking.", { retryable: true, retryAfterSeconds: h.length >= 3 ? waitFor(h, now, 3600000) : waitFor(mine, now, 86400000) });
    const shopHour = recent.filter(hour);
    if (shopHour.length >= 5 || (cap > 0 && recent.length >= cap))
        return paused(shopHour.length >= 5 ? waitFor(shopHour, now, 3600000) : recent.length ? waitFor(recent, now, 86400000) : 60);
    return null;
}
function rejectionBudget(c: Counts, clientHash: string, now: Date): boolean {
    const hour = (r: {
        createdAt: Date;
    }) => r.createdAt.getTime() > now.getTime() - 3600000, all = c.anonymous, rejected = all.filter(r => r.outcome === "REJECTED"), mine = all.filter(r => r.clientHash === clientHash);
    return all.filter(hour).length < 100 && all.length < 500 && rejected.filter(hour).length < 50 && rejected.length < 250 && mine.filter(hour).length < 5 && mine.length < 20;
}
async function credentials(tx: Prisma.TransactionClient, b: Booking, now: Date, c: BookingConfiguration, write: boolean): Promise<Pick<BookingCommit, "session"> & {
    managementAccess: {
        accessToken: string;
        expiresAt: string;
    } | null;
} | null> {
    // Credential rows are retained by key provenance. Normal replays are read-only; a newly
    // activated/retired signer may require a separately admitted short write to mint a new row.
    let grant = await tx.bookingManagementGrant.findFirst({ where: {
            bookingId: b.id, credentialVersion: b.managementTokenVersion, kid: c.grant.activeKid, revokedAt: null
        }, orderBy: { issuedAt: "desc" } });
    const original = await tx.bookingManagementGrant.findFirst({ where: { bookingId: b.id, credentialVersion: b.managementTokenVersion }, orderBy: { issuedAt: "asc" } });
    const end = grantExpiry(now, b.endsAt, b.terminalAt), expires = new Date(Math.min(end.getTime(), original?.expiresAt.getTime() ?? Infinity));
    if (expires <= now)
        return { managementAccess: null };
    if (!grant) {
        if (!write)
            return null;
        grant = await tx.bookingManagementGrant.create({ data: {
                bookingId: b.id, credentialVersion: b.managementTokenVersion, kid: c.grant.activeKid, issuedAt: now, expiresAt: expires
            } });
    }
    if (grant.expiresAt <= now)
        return { managementAccess: null };
    let session = await tx.bookingManagementSession.findFirst({ where: {
            grantId: grant.id, kid: c.session.activeKid, grantKid: grant.kid, revokedAt: null, expiresAt: { gt: now }
        }, orderBy: { issuedAt: "desc" } });
    if (!session) {
        if (!write)
            return null;
        session = await tx.bookingManagementSession.create({ data: {
                bookingId: b.id, grantId: grant.id, credentialVersion: b.managementTokenVersion, kid: c.session.activeKid, grantKid: grant.kid, issuedAt: now, expiresAt: new Date(Math.min(now.getTime() + 86400000, grant.expiresAt.getTime()))
            } });
    }
    const claims = {
        id: grant.id, bookingId: b.id, credentialVersion: b.managementTokenVersion, issuedAt: grant.issuedAt.toISOString(), expiresAt: grant.expiresAt.toISOString(), grantKid: grant.kid
    };
    return { managementAccess: { accessToken: signManagementToken("BOOKING_MANAGEMENT", claims, c.grant), expiresAt: claims.expiresAt }, session: { token: signManagementToken("BOOKING_MANAGEMENT_SESSION", {
                ...claims, id: session.id, issuedAt: session.issuedAt.toISOString(), expiresAt: session.expiresAt.toISOString()
            }, c.session), expiresAt: session.expiresAt.toISOString() } };
}
type Replay = BookingCommit | {
    refresh: true;
} | null;
async function replay(tx: Prisma.TransactionClient, op: BookingOperation | null, r: CreateDayBookingRequest, hash: string, now: Date, c: BookingConfiguration, write = false): Promise<Replay> {
    if (!op)
        return null;
    if (op.kind !== "CREATE" || (op.requestHash !== null && op.requestHash !== hash))
        return fail(bookingError("IDEMPOTENCY_CONFLICT", "This retry key belongs to different booking details."));
    if (op.outcome === "CLOSED_WITHOUT_COMMIT")
        return fail(reject("OPERATION_CLOSED", "This submission is closed. Start a new submission."));
    if (op.outcome === "REJECTED")
        return fail(op.rejectionData as unknown as LifecycleError);
    if (now >= op.recoveryExpiresAt)
        return fail(bookingError("RECOVERY_EXPIRED", "This submission can no longer be recovered. Please contact the shop."));
    const b = op.bookingId ? await tx.booking.findUnique({ where: { id: op.bookingId }, include: { lineItems: true } }) : null;
    if (!b || b.managementTokenVersion !== op.credentialVersion)
        return fail(bookingError("UNAUTHENTICATED", "This submission can no longer be recovered. Please contact the shop."));
    const authority = await credentials(tx, b, now, c, write);
    if (!authority)
        return { refresh: true };
    return {
        result: { ok: true, data: {
                booking: publicDayBooking(b), managementAccess: authority.managementAccess, commitState: "COMMITTED", replayed: true
            } }, created: false, ...(authority.session ? { session: authority.session } : {})
    };
}
export function checkBookingOrigin(headers: Headers, c: BookingConfiguration): boolean {
    return headers.get("origin") === c.origin && headers.get("x-zeus-booking") === "1" && headers.get("sec-fetch-site") !== "cross-site";
}
export async function createDayBooking(input: unknown, options: CreateDayBookingOptions = {}): Promise<BookingCommit> {
    let leave: (() => void) | undefined;
    const db = options.db ?? prisma;
    try {
        const c = options.config ?? parseBookingConfiguration(), headers = options.headers ?? new Headers();
        if (!checkBookingOrigin(headers, c))
            return fail(bookingError("FORBIDDEN", "This booking request could not be accepted.", { commitState: "UNKNOWN" }));
        const client = trustedClientKey(headers, c.identity), clientHash = sha256(client);
        leave = enterBooking(createAdmission, clientHash);
        let text: string | undefined;
        try {
            text = JSON.stringify(input);
        }
        catch { /* reject unserializable input */ }
        if (!text || Buffer.byteLength(text) > 16384)
            return fail(bookingError("VALIDATION_ERROR", "Booking details must fit within 16 KiB."));
        const parsed = CreateDayBookingSchema.safeParse(input);
        if (!parsed.success)
            return fail(bookingError(input && typeof input === "object" && "contractVersion" in input && input.contractVersion === 4 ? "VALIDATION_ERROR" : "CLIENT_UPGRADE_REQUIRED", "Refresh the booking page and check the booking details."));
        const r = parsed.data, hash = bookingRequestHash(r), keyHash = sha256(r.idempotencyKey);
        const preflight = await withBookingDb(db, "PREFLIGHT", async (tx) => {
            const now = await bookingDbNow(tx), op = await tx.bookingOperation.findUnique({ where: { keyHash } });
            const prior = await replay(tx, op, r, hash, now, c);
            if (prior)
                return { prior };
            if (await tx.booking.findFirst({ where: { idempotencyKey: { equals: r.idempotencyKey, mode: "insensitive" } }, select: { id: true } }))
                return { prior: fail(bookingError("IDEMPOTENCY_CONFLICT", "This retry key belongs to a previous submission.")) };
            return { budget: newEffectBudget(await counts(tx, now), clientHash, c.shopDailyBudget, now) };
        }, options.signal);
        if ("prior" in preflight && preflight.prior && !("refresh" in preflight.prior))
            return preflight.prior;
        const refresh = "prior" in preflight && preflight.prior && "refresh" in preflight.prior;
        if (!refresh) {
            if (c.mode === "PAUSED")
                return fail(paused(300));
            if ("budget" in preflight && preflight.budget)
                return fail(preflight.budget);
            const verification = await verifyTurnstile(r.turnstileToken, c.challenge, {
                endpoint: options.turnstileEndpoint, remoteip: turnstileRemoteIp(client), signal: options.signal
            });
            if (verification !== "VERIFIED")
                return fail(verification === "INVALID" ? bookingError("CHALLENGE_FAILED", "Complete the security check again.", { retryable: true, fieldErrors: { turnstileToken: ["Complete the security check again."] } }) : paused(60));
        }
        const committed = await withBookingDb(db, "CREATE", async (tx) => {
            await lockBookingShop(tx);
            await lockBookingDates(tx, [r.bookingDate]);
            const now = await bookingDbNow(tx);
            const prior = await replay(tx, await tx.bookingOperation.findUnique({ where: { keyHash } }), r, hash, now, c, true);
            if (prior && !("refresh" in prior))
                return prior;
            if (await tx.booking.findFirst({ where: { idempotencyKey: { equals: r.idempotencyKey, mode: "insensitive" } }, select: { id: true } }))
                return fail(bookingError("IDEMPOTENCY_CONFLICT", "This retry key belongs to a previous submission."));
            const cts = await counts(tx, now), budget = newEffectBudget(cts, clientHash, Infinity, now);
            if (budget)
                return fail(budget);
            if (await tx.bookingTurnstileUse.findUnique({ where: { tokenHash: sha256(r.turnstileToken) } }))
                return fail(bookingError("CHALLENGE_FAILED", "Complete the security check again.", { retryable: true, fieldErrors: { turnstileToken: ["Complete the security check again."] } }));
            async function terminal(error: LifecycleError): Promise<BookingCommit> {
                if (!rejectionBudget(cts, clientHash, now))
                    return fail(unavailable());
                const op = await tx.bookingOperation.create({ data: {
                        keyHash, kind: "CREATE", requestHash: hash, outcome: "REJECTED", rejectionCode: error.code, rejectionData: JSON.parse(JSON.stringify(error)) as Prisma.InputJsonValue, clientHash, recoveryExpiresAt: new Date(now.getTime() + 86400000)
                    } });
                await tx.bookingTurnstileUse.create({ data: {
                        tokenHash: sha256(r.turnstileToken), operationId: op.id, createdAt: now, expiresAt: new Date(now.getTime() + 300000)
                    } });
                return fail(error);
            }
            const accepted = await checkAcceptedQuote(tx, r.acceptedQuote, { ring: c.quote, now: () => now });
            if (!accepted.ok)
                return terminal(accepted.error);
            if (!validDay(r.bookingDate, now))
                return terminal(reject("VALIDATION_ERROR", "Choose a day from today through the next 90 days."));
            const phone = await tx.booking.count({ where: {
                    customerPhone: r.customerPhone, status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] }, endsAt: { gt: now }
                } });
            if (phone >= 2)
                return terminal(reject("BOOKING_LIMIT_REACHED", "We can't take another online booking for these details. Please call the shop."));
            const state = (await readDayStates(tx, accepted.priced.queueId, r.bookingDate, r.bookingDate))[0].state;
            if (state !== "AVAILABLE")
                return terminal(reject(state === "CLOSED" ? "DAY_CLOSED" : "FULLY_BOOKED", state === "CLOSED" ? "The shop is closed on this day. Choose another day." : "This day is fully booked. Choose another day."));
            // A full/closed selected day has the fixed terminal business outcome, including a last-unit race.
            const dailyBudget = newEffectBudget(cts, clientHash, c.shopDailyBudget, now);
            if (dailyBudget)
                return fail(dailyBudget);
            const q = accepted.priced, size = accepted.release.sizes.find(s => s.id === q.vehicleCategoryId)!;
            const last = await tx.booking.aggregate({ where: { bookingDate: new Date(r.bookingDate + "T00:00:00Z"), queueCode: q.queueId }, _max: { queuePosition: true } });
            const b = await tx.booking.create({ data: {
                    referenceCode: referenceCode(), customerName: r.customerName, customerPhone: r.customerPhone, customerEmail: r.customerEmail ?? null, vehicleModel: r.vehicleModel, vehiclePlate: r.vehiclePlate ?? null, notes: r.specialRequests ?? null, vehicleCategoryId: q.vehicleCategoryId, serviceId: q.primaryServiceId, bookingDate: new Date(r.bookingDate + "T00:00:00Z"), ...dayWindow(r.bookingDate), status: "PENDING", priceSnapshot: new Prisma.Decimal(q.totalPriceCentavos).div(100), serviceNameSnapshot: q.lines[0].name, vehicleCategoryNameSnapshot: size.name, idempotencyKey: keyHash, requestHash: hash, snapshotVersion: "QUEUE_V3", catalogReleaseId: q.catalogReleaseId, vehicleSizeCodeSnapshot: size.code, catalogFingerprint: q.catalogFingerprint, pricingAlgorithm: q.pricingAlgorithm, queueCode: q.queueId, queuePosition: (last._max.queuePosition ?? 0) + 1, receiptTotalCentavos: q.totalPriceCentavos, receiptEstimatedCentavos: q.estimatedTotalCentavos, lineItems: { create: q.lines.map((l, order) => ({
                            order, releaseId: q.catalogReleaseId, serviceId: l.serviceId, vehicleCategoryId: q.vehicleCategoryId, offerId: l.offerId, type: l.kind, nameSnapshot: l.name, unit: l.unit, quantity: l.quantity, unitPriceCentavos: l.unitPriceCentavos, subtotalCentavos: l.subtotalCentavos, lineVersion: "QUEUE_V3", priceStatus: l.priceStatus, referenceUnitPriceCentavos: l.referenceUnitPriceCentavos, referenceSubtotalCentavos: l.referenceSubtotalCentavos
                        })) }
                }, include: { lineItems: true } });
            const op = await tx.bookingOperation.create({ data: {
                    keyHash, kind: "CREATE", bookingId: b.id, requestHash: hash, outcome: "COMMITTED", resultingRevision: b.revision, credentialVersion: b.managementTokenVersion, clientHash, committedAt: now, recoveryExpiresAt: new Date(now.getTime() + 86400000)
                } });
            await tx.bookingTurnstileUse.create({ data: {
                    tokenHash: sha256(r.turnstileToken), operationId: op.id, createdAt: now, expiresAt: new Date(now.getTime() + 300000)
                } });
            await tx.bookingNotificationOutbox.create({ data: { bookingId: b.id, ...shopNotificationMessage(b, c.origin) } });
            const authority = await credentials(tx, b, now, c, true);
            if (!authority)
                throw new Error("Credential mint failed");
            const pending = await tx.booking.count({where:{bookingDate:b.bookingDate,status:"PENDING",snapshotVersion:"QUEUE_V3"}});
            const level = pendingAlertLevel(r.bookingDate,now,pending,c.pendingAlertThreshold);
            if (level) console.warn(JSON.stringify({event:"booking.pending_count",level}));

            return {
                result: { ok: true as const, data: {
                        booking: publicDayBooking(b), managementAccess: authority.managementAccess, commitState: "COMMITTED" as const, replayed: false
                    } }, created: true, ...(authority.session ? { session: authority.session } : {})
            };
        }, options.signal);
        if (committed.created && committed.result.ok) {
            // Committed transaction and its permit are finished before any mail-provider call.
            try {
                await drainShopNotifications({
                    ...options, db, bookingId: committed.result.data.booking.id
                });
            }
            catch {
                console.warn(JSON.stringify({ event: "booking.notification_deferred" }));
            }
        }
        return committed;
    }
    catch (error) {
        return fail(error instanceof BookingFailure ? error.error : unavailable());
    }
    finally {
        leave?.();
    }
}

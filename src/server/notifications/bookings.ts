import "server-only";
import { randomUUID } from "node:crypto";
import type { Booking, BookingLineItem, PrismaClient } from "@prisma/client";
import { brandConfig } from "@/config/brand";
import { prisma } from "../db";
import { withBookingDb } from "../bookings-admission";
import { bookingDbNow } from "../bookings-locks";
import { readProviderJson } from "../bookings-provider";
export interface NotificationConfiguration {
    endpoint?: string;
    apiKey: string;
    from: string;
    shopEmail: string;
    origin: string;
}
interface Options {
    db?: PrismaClient;
    notification?: NotificationConfiguration;
    bookingId?: string;
}
export function notificationConfiguration(env: Record<string, string | undefined> = process.env): NotificationConfiguration | null {
    const { RESEND_API_KEY: apiKey, BOOKING_EMAIL_FROM: from, SHOP_NOTIFY_EMAIL: shopEmail, APP_ORIGIN: origin } = env;
    if (!apiKey || !from || !shopEmail || !origin)
        return null;
    if (/[\r\n]/.test(from) || !/^\S+@\S+\.\S+$/.test(shopEmail))
        return null;
    return {
        apiKey, from, shopEmail, origin
    };
}
export function shopNotificationMessage(b: Booking & {
    lineItems: BookingLineItem[];
}, origin: string): {
    subject: string;
    text: string;
} {
    const services = b.lineItems.filter(l => l.addedByStaffId === null).sort((a, c) => a.order - c.order).map(l => l.nameSnapshot + (l.quantity > 1 ? " × " + l.quantity : "")).join(", ");
    return { subject: "New booking " + b.referenceCode, text: [
            b.referenceCode, services, b.vehicleCategoryNameSnapshot, b.bookingDate.toISOString().slice(0, 10) + " (" + brandConfig.timezone + ")", "PHP " + ((b.receiptTotalCentavos ?? 0) / 100).toFixed(2) + " priced; other lines may require a quote.", origin + "/admin/bookings?bookingId=" + encodeURIComponent(b.id)
        ].join("\n") };
}
async function send(config: NotificationConfiguration, to: string, message: {
    subject: string;
    text: string;
}, key: string): Promise<boolean> {
    try {
        const response = await fetch(config.endpoint ?? "https://api.resend.com/emails", {
            method: "POST", headers: {
                "content-type": "application/json", authorization: "Bearer " + config.apiKey, "Idempotency-Key": key
            }, body: JSON.stringify({
                from: config.from, to: [to], ...message
            }), signal: AbortSignal.timeout(3000), redirect: "error"
        });
        if (!response.ok)
            return false;
        const data = await readProviderJson(response);
        return !!data && typeof data === "object" && "id" in data && typeof data.id === "string" && data.id.length > 0;
    }
    catch {
        return false;
    }
}
// One durable outbox per committed create; no replay path calls this for its booking.
// Claim and finalize each own a short DB permit; provider I/O holds neither permit nor lock.
export async function drainShopNotifications(options: Options = {}): Promise<void> {
    const config = options.notification ?? notificationConfiguration(), db = options.db ?? prisma;
    if (!config) {
        console.warn(JSON.stringify({ event: "booking.notification_unconfigured" }));
        return;
    }
    for (let n = 0; n < (options.bookingId ? 1 : 5); n++) {
        const item = await withBookingDb(db, "NOTIFICATION", async (tx) => {
            const now = await bookingDbNow(tx);
            const rows = await tx.$queryRaw<{
                id: string;
            }[]> `SELECT id FROM booking_notification_outbox WHERE state IN ('PENDING','SENDING') AND attempts<3 AND "nextAttemptAt"<=${now} AND (${options.bookingId ?? null}::text IS NULL OR "bookingId"=${options.bookingId ?? null}) ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
            if (!rows.length)
                return null;
            return tx.bookingNotificationOutbox.update({ where: { id: rows[0].id }, data: {
                    state: "SENDING", attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 30000)
                } });
        });
        if (!item)
            return;
        const sent = await send(config, config.shopEmail, { subject: item.subject, text: item.text }, "booking-shop/" + item.bookingId);
        await withBookingDb(db, "NOTIFICATION", async (tx) => {
            const now = await bookingDbNow(tx);
            await tx.bookingNotificationOutbox.update({ where: { id: item.id }, data: {
                    state: sent ? "SENT" : item.attempts >= 3 ? "FAILED" : "PENDING", sentAt: sent ? now : null, nextAttemptAt: new Date(now.getTime() + 30000)
                } });
        });
        if (!sent)
            console.warn(JSON.stringify({
                event: "booking.notification_not_sent", outboxId: item.id, exhausted: item.attempts >= 3
            }));
    }
}
// Authorization, audit and the per-booking attempt limit belong to P1-07's action.
// This server-only adapter matches TurnNoticeSender; it exposes no customer HTTP route.
export async function sendTurnNotice(bookingId: string, options: Options = {}): Promise<"SENT" | "NOT_SENT"> {
    try {
        const config = options.notification ?? notificationConfiguration();
        if (!config)
            return "NOT_SENT";
        const booking = await withBookingDb(options.db ?? prisma, "NOTIFICATION", tx => tx.booking.findUnique({ where: { id: bookingId }, select: { customerEmail: true } }));
        if (!booking?.customerEmail)
            return "NOT_SENT";
        const message = { subject: "Your turn is coming at " + brandConfig.businessName, text: "Your turn is coming at " + brandConfig.businessName + ". Please be ready to visit the shop. Contact the shop if you need help." };
        return await send(config, booking.customerEmail, message, "booking-turn/" + bookingId + "/" + randomUUID()) ? "SENT" : "NOT_SENT";
    }
    catch {
        return "NOT_SENT";
    }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startBookingNotifications(): void {
    if (timer)
        return;
    if (!notificationConfiguration()) {
        console.warn(JSON.stringify({ event: "booking.notification_unconfigured" }));
        return;
    }
    timer = setInterval(() => { void drainShopNotifications().catch(() => console.warn(JSON.stringify({ event: "booking.notification_deferred" }))); }, 30000);
    timer.unref();
}

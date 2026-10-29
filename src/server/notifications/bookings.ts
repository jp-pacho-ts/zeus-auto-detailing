import "server-only";
import { randomUUID } from "node:crypto";
import type { Booking, BookingLineItem, PrismaClient } from "@prisma/client";
import { brandConfig } from "@/config/brand";
import type { DayBookingView } from "@/types/contracts";
import { prisma } from "../db";
import { withBookingDb } from "../bookings-admission";
import { bookingDbNow } from "../bookings-locks";
import nodemailer from "nodemailer";
export interface NotificationConfiguration {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  shopEmail: string;
  origin: string;
  ca?: string; // Explicit trust for the loopback TLS simulator; never disables verification.
}
interface Options {
  db?: PrismaClient;
  notification?: NotificationConfiguration;
  bookingId?: string;
}
export function notificationConfiguration(
  env: Record<string, string | undefined> = process.env,
): NotificationConfiguration | null {
  const {
    SMTP_HOST: host,
    SMTP_PORT: rawPort,
    SMTP_USER: user,
    SMTP_APP_PASSWORD: password,
    SMTP_FROM: from,
    SMTP_SHOP_NOTIFY_EMAIL: shopEmail,
    APP_ORIGIN: origin,
  } = env;
  const email =
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (
    host !== "smtp.gmail.com" ||
    (rawPort !== "465" && rawPort !== "587") ||
    !user ||
    !password ||
    !from ||
    !shopEmail ||
    !origin
  )
    return null;
  if (
    !email.test(user) ||
    !email.test(from) ||
    !email.test(shopEmail) ||
    /[\r\n]/.test(password)
  )
    return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol))
      return null;
  } catch {
    return null;
  }
  return {
    host,
    port: Number(rawPort),
    secure: rawPort === "465",
    user,
    password,
    from,
    shopEmail,
    origin,
  };
}
export function shopNotificationMessage(
  b: Booking & {
    lineItems: BookingLineItem[];
  },
  origin: string,
): {
  subject: string;
  text: string;
} {
  const services = b.lineItems
    .filter((l) => l.addedByStaffId === null)
    .sort((a, c) => a.order - c.order)
    .map((l) => l.nameSnapshot + (l.quantity > 1 ? " × " + l.quantity : ""))
    .join(", ");
  return {
    subject: "New booking " + b.referenceCode,
    text: [
      b.referenceCode,
      services,
      b.vehicleCategoryNameSnapshot,
      b.bookingDate.toISOString().slice(0, 10) +
        " (" +
        brandConfig.timezone +
        ")",
      "PHP " +
        ((b.receiptTotalCentavos ?? 0) / 100).toFixed(2) +
        " priced; other lines may require a quote.",
      origin + "/admin/bookings?bookingId=" + encodeURIComponent(b.id),
    ].join("\n"),
  };
}
// P1-24: only the first committed create calls this with its captured customer receipt.
// Whitelist public receipt fields: no later staff edits, notes, contact details or bearer links.
export function customerConfirmationMessage(
  booking: DayBookingView,
  origin: string,
): { subject: string; text: string } {
  const forQuote = booking.lines.some((line) => line.priceStatus === "FOR_QUOTE");
  const services = booking.lines.map((line) =>
    "- " + line.name + (line.quantity > 1 ? " × " + line.quantity : "") +
    (line.priceStatus === "FOR_QUOTE" ? " (for quote)" : ""),
  );
  const estimate = booking.estimatedTotalCentavos === null
    ? "To be quoted by the shop."
    : brandConfig.currency + " " + (booking.estimatedTotalCentavos / 100).toFixed(2);
  return {
    subject: "Booking received " + booking.referenceCode,
    text: [
      brandConfig.businessName,
      "Booking reference: " + booking.referenceCode,
      "Your request is sent. The shop will text or call you to confirm.",
      "Drop-off day: " + booking.bookingDate + " (" + brandConfig.timezone + ")",
      "Opening hours: " + brandConfig.operatingSchedule,
      "Vehicle size: " + booking.vehicleCategoryName,
      "Selected services:",
      ...services,
      "Estimated total: " + estimate,
      ...(forQuote ? ["Some services are for quote. The shop will confirm the final price."] : []),
      "Manage your booking: " + origin + "/book/manage",
      "Phone: " + brandConfig.supportPhone,
      "Messenger: " + brandConfig.facebookMessengerUrl,
    ].join("\n"),
  };
}
// Simple send now: no outbox/retry, including after SMTP rejection/timeout. Never throws
// into the committed booking response. sendSmtpMessage retains its existing 3 s bound.
export async function sendCustomerConfirmation(
  booking: DayBookingView,
  customerEmail: string | undefined,
  notification?: NotificationConfiguration,
): Promise<void> {
  if (!customerEmail) return;
  try {
    const config = notification ?? notificationConfiguration();
    if (!config) return;
    if (await sendSmtpMessage(
      config,
      customerEmail,
      customerConfirmationMessage(booking, config.origin),
      `<booking-confirm.${booking.id}@${new URL(config.origin).hostname}>`,
    )) return;
  } catch { /* Keep the committed result even if configuration or provider code fails. */ }
  console.warn(JSON.stringify({ event: "booking.customer_confirmation_not_sent", bookingId: booking.id }));
}
export async function sendSmtpMessage(
  config: NotificationConfiguration,
  to: string,
  message: { subject: string; text: string },
  messageId: string,
): Promise<boolean> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    auth: { user: config.user, pass: config.password },
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(config.ca ? { ca: config.ca } : {}),
    },
    connectionTimeout: 1000,
    greetingTimeout: 1000,
    socketTimeout: 1500,
    pool: false,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      transport
        .sendMail({
          from: config.from,
          to,
          subject: message.subject,
          text: message.text,
          messageId,
        })
        .then((info) =>
          info.accepted.some(
            (address) => String(address).toLowerCase() === to.toLowerCase(),
          ),
        ),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          transport.close();
          resolve(false);
        }, 3000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
    transport.close();
  }
}
function shopMessageId(outboxId: string, origin: string): string {
  return `<booking-shop.${outboxId}@${new URL(origin).hostname}>`;
}
// One durable outbox per committed create; no replay path calls this for its booking.
// Claim and finalize each own a short DB permit; provider I/O holds neither permit nor lock.
// SMTP has no idempotency key: acceptance followed by a crash/finalize failure can resend
// after the lease. The stable Message-ID aids recognition, not guaranteed deduplication.
// One such failure permits one duplicate; repeated failures remain capped at 3 sends.
export async function drainShopNotifications(
  options: Options = {},
): Promise<void> {
  const config = options.notification ?? notificationConfiguration(),
    db = options.db ?? prisma;
  if (!config) {
    console.warn(
      JSON.stringify({ event: "booking.notification_unconfigured" }),
    );
    return;
  }
  for (let n = 0; n < (options.bookingId ? 1 : 5); n++) {
    const item = await withBookingDb(db, "NOTIFICATION", async (tx) => {
      const now = await bookingDbNow(tx);
      const rows = await tx.$queryRaw<
        {
          id: string;
        }[]
      >`SELECT id FROM booking_notification_outbox WHERE state IN ('PENDING','SENDING') AND attempts<3 AND "nextAttemptAt"<=${now} AND (${options.bookingId ?? null}::text IS NULL OR "bookingId"=${options.bookingId ?? null}) ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return null;
      return tx.bookingNotificationOutbox.update({
        where: { id: rows[0].id },
        data: {
          state: "SENDING",
          attempts: { increment: 1 },
          nextAttemptAt: new Date(now.getTime() + 30000),
        },
      });
    });
    if (!item) return;
    const sent = await sendSmtpMessage(
      config,
      config.shopEmail,
      { subject: item.subject, text: item.text },
      shopMessageId(item.id, config.origin),
    );
    await withBookingDb(db, "NOTIFICATION", async (tx) => {
      const now = await bookingDbNow(tx);
      await tx.bookingNotificationOutbox.update({
        where: { id: item.id },
        data: {
          state: sent ? "SENT" : item.attempts >= 3 ? "FAILED" : "PENDING",
          sentAt: sent ? now : null,
          nextAttemptAt: new Date(now.getTime() + 30000),
        },
      });
    });
    if (!sent)
      console.warn(
        JSON.stringify({
          event: "booking.notification_not_sent",
          outboxId: item.id,
          exhausted: item.attempts >= 3,
        }),
      );
  }
}
// P1-18: the shop hears that a deposit proof arrived for a reference code. No image, no file
// details and no customer fields; staff open the booking to see the proof.
export function depositNoticeMessage(
  referenceCode: string,
  bookingId: string,
  origin: string,
): { subject: string; text: string } {
  return {
    subject: "Deposit proof sent for " + referenceCode,
    text: [
      referenceCode,
      "The customer sent a deposit proof. Check it against the shop account, then mark the deposit received or rejected.",
      origin + "/admin/bookings?bookingId=" + encodeURIComponent(bookingId),
    ].join("\n"),
  };
}
// The same claim/send/finalize lease as drainShopNotifications, on each proof row's delivery
// state (one email per committed proof, at most 3 attempts).
export async function drainDepositNotices(options: Options = {}): Promise<void> {
  const config = options.notification ?? notificationConfiguration(),
    db = options.db ?? prisma;
  if (!config) {
    console.warn(JSON.stringify({ event: "booking.notification_unconfigured" }));
    return;
  }
  for (let n = 0; n < 5; n++) {
    const item = await withBookingDb(db, "NOTIFICATION", async (tx) => {
      const now = await bookingDbNow(tx);
      const rows = await tx.$queryRaw<{ id: string; attempts: number; referenceCode: string; bookingId: string }[]>`SELECT p.id, p."notifyAttempts" AS attempts, b."referenceCode", b.id AS "bookingId" FROM booking_deposit_proofs p JOIN bookings b ON b.id=p."bookingId" WHERE p."notifyState" IN ('PENDING','SENDING') AND p."notifyAttempts"<3 AND p."notifyNextAttemptAt"<=${now} AND (${options.bookingId ?? null}::text IS NULL OR p."bookingId"=${options.bookingId ?? null}) ORDER BY p."createdAt",p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`;
      if (!rows.length) return null;
      await tx.bookingDepositProof.update({
        where: { id: rows[0].id },
        data: { notifyState: "SENDING", notifyAttempts: { increment: 1 }, notifyNextAttemptAt: new Date(now.getTime() + 30000) },
        select: { id: true },
      });
      return { ...rows[0], attempts: rows[0].attempts + 1 };
    });
    if (!item) return;
    const sent = await sendSmtpMessage(
      config,
      config.shopEmail,
      depositNoticeMessage(item.referenceCode, item.bookingId, config.origin),
      `<booking-deposit.${item.id}@${new URL(config.origin).hostname}>`,
    );
    await withBookingDb(db, "NOTIFICATION", async (tx) => {
      const now = await bookingDbNow(tx);
      await tx.bookingDepositProof.update({
        where: { id: item.id },
        data: {
          notifyState: sent ? "SENT" : item.attempts >= 3 ? "FAILED" : "PENDING",
          notifySentAt: sent ? now : null,
          notifyNextAttemptAt: new Date(now.getTime() + 30000),
        },
        select: { id: true },
      });
    });
    if (!sent)
      console.warn(JSON.stringify({ event: "booking.deposit_notice_not_sent", proofId: item.id, exhausted: item.attempts >= 3 }));
  }
}
// Authorization, audit and the per-booking attempt limit belong to P1-07's action.
// This server-only adapter matches TurnNoticeSender; it exposes no customer HTTP route.
export async function sendTurnNotice(
  bookingId: string,
  options: Options = {},
): Promise<"SENT" | "NOT_SENT"> {
  try {
    const config = options.notification ?? notificationConfiguration();
    if (!config) return "NOT_SENT";
    const booking = await withBookingDb(
      options.db ?? prisma,
      "NOTIFICATION",
      (tx) =>
        tx.booking.findUnique({
          where: { id: bookingId },
          select: { customerEmail: true },
        }),
    );
    if (!booking?.customerEmail) return "NOT_SENT";
    const message = {
      subject: "Your turn is coming at " + brandConfig.businessName,
      text:
        "Your turn is coming at " +
        brandConfig.businessName +
        ". Please be ready to visit the shop. Contact the shop if you need help.",
    };
    return (await sendSmtpMessage(
      config,
      booking.customerEmail,
      message,
      `<booking-turn.${randomUUID()}@${new URL(config.origin).hostname}>`,
    ))
      ? "SENT"
      : "NOT_SENT";
  } catch {
    return "NOT_SENT";
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startBookingNotifications(): void {
  if (timer) return;
  if (!notificationConfiguration()) {
    console.warn(
      JSON.stringify({ event: "booking.notification_unconfigured" }),
    );
    return;
  }
  timer = setInterval(() => {
    void drainShopNotifications().catch(() =>
      console.warn(JSON.stringify({ event: "booking.notification_deferred" })),
    );
    void drainDepositNotices().catch(() =>
      console.warn(JSON.stringify({ event: "booking.deposit_notice_deferred" })),
    );
  }, 30000);
  timer.unref();
}

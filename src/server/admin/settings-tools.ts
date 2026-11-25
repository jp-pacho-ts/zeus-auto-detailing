import "server-only";
import { randomUUID } from "node:crypto";
import { brandConfig } from "@/config/brand";
import { EmailPreviewQuerySchema, TestEmailSchema } from "@/lib/admin-validation";
import { appOrigin } from "@/server/auth/http";
import { createWindowCounter } from "@/server/auth/rate-limit";
import {
  customerCarReadyMessage,
  customerConfirmationMessage,
  customerReminderMessage,
  customerTurnNoticeMessage,
  notificationConfiguration,
  sendSmtpClassified,
  type NotificationConfiguration,
} from "@/server/notifications/bookings";
import type { AdminEmailPreview, AdminTestEmail, AdminTestEmailResult } from "@/types/admin-contracts";
import type { DayBookingView } from "@/types/contracts";
import { authorize, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import { adminEvent } from "./log";

// P1-78 Settings tools. ADMIN only, checked here. Neither tool reads or writes the database.

// The preview's only booking: made-up values, never a real row. The view has no name, phone, email, plate or notes, and the builders
// link only to /book/manage, never a token link (Security C5).
function previewBooking(now: Date): DayBookingView {
  const tomorrow = new Date(now.getTime() + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10); // Manila is UTC+8
  return {
    id: "00000000-0000-4000-8000-000000000000",
    referenceCode: "ZEUS-PREVIEW",
    status: "CONFIRMED",
    revision: 1,
    bookingDate: tomorrow,
    timezone: "Asia/Manila",
    vehicleCategoryId: "00000000-0000-4000-8000-000000000001",
    vehicleCategoryName: "Sedan (sample)",
    lines: [
      { serviceId: "00000000-0000-4000-8000-000000000002", name: "Sample Wash", quantity: 1, priceStatus: "PRICED", subtotalCentavos: 50_000, referenceSubtotalCentavos: 50_000 },
      { serviceId: "00000000-0000-4000-8000-000000000003", name: "Sample Interior Clean", quantity: 1, priceStatus: "PRICED", subtotalCentavos: 100_000, referenceSubtotalCentavos: 100_000 },
    ],
    totalPriceCentavos: 150_000,
    estimatedTotalCentavos: 150_000,
    currency: "PHP",
  };
}

export async function previewEmail(actor: StaffActor, input: unknown, options: Pick<AdminOptions, "now"> = {}): Promise<AdminEmailPreview> {
  authorize(actor, "SETTINGS_READ");
  const { kind } = parse(EmailPreviewQuerySchema, input);
  const origin = appOrigin();
  if (!origin) throw new AdminServiceError("RETRYABLE_ERROR");
  const booking = previewBooking(options.now?.() ?? new Date());
  const message: { subject: string; text: string; html?: string } =
    kind === "confirmation" ? customerConfirmationMessage(booking, origin)
    : kind === "reminder" ? customerReminderMessage(booking, origin)
    : kind === "car_ready" ? customerCarReadyMessage(booking, origin)
    : customerTurnNoticeMessage();
  adminEvent("admin.settings.email_preview", { actorStaffId: actor.staffId, kind });
  return { kind, subject: message.subject, text: message.text, html: message.html ?? null };
}

// shortcut: counts live in this process only, move to the database if the app runs more than one instance
let testEmailLimit = createWindowCounter(3, 600_000);
const SHOP_KEY = "shop"; // one limit for the shop, not per admin
/** Tests only: start the limit from zero. */
export function resetTestEmailLimit(): void { testEmailLimit = createWindowCounter(3, 600_000); }

function testEmailMessage(at: Date): { subject: string; text: string } {
  const time = at.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
  return {
    subject: "Test email from " + brandConfig.businessName + " Settings",
    text: "This is a test email sent from the admin Settings page at " + time + " (Asia/Manila). No action is needed.",
  };
}

// Always to the configured shop address: the body is an empty object, so no input can name a recipient. The answer and the log carry
// only the result class, never the address, the provider's text or a secret.
export async function sendTestEmail(
  actor: StaffActor,
  input: unknown,
  options: Pick<AdminOptions, "now"> & { notification?: NotificationConfiguration | null } = {},
): Promise<AdminTestEmail> {
  authorize(actor, "SETTINGS_WRITE");
  parse(TestEmailSchema, input);
  // Security C1: the check and the count run back to back, before any I/O, so every attempt counts, failed ones included.
  if (testEmailLimit.blocked(SHOP_KEY)) {
    adminEvent("admin.settings.test_email", { actorStaffId: actor.staffId, result: "rate_limited" });
    throw new AdminServiceError("RATE_LIMITED", undefined, { retryAfterSeconds: 600 });
  }
  testEmailLimit.record(SHOP_KEY);
  const at = options.now?.() ?? new Date();
  let config: NotificationConfiguration | null;
  try {
    config = options.notification !== undefined ? options.notification : notificationConfiguration();
  } catch {
    config = null;
  }
  let result: AdminTestEmailResult = "config_missing";
  if (config) {
    try {
      // sendSmtpClassified applies the daily shop cap (allowSend), the hard backstop behind this limit.
      result = await sendSmtpClassified(config, config.shopEmail, testEmailMessage(at), `<settings-test.${randomUUID()}@${new URL(config.origin).hostname}>`);
    } catch {
      result = "error";
    }
  }
  adminEvent("admin.settings.test_email", { actorStaffId: actor.staffId, result });
  return { result, at: at.toISOString() };
}

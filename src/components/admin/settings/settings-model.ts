// P1-42: the plain words of the Settings screen and what a save sends. No React, no network, so they are unit tested.
import type { AdminShopSettings } from "@/types/admin-contracts";

export const WEBSITE_INTRO = "Takes the whole customer site offline: home, booking and manage booking. The admin and sign-in keep working.";
export const BOOKING_INTRO = "Paused stops new bookings only. Customers can still look up and manage the bookings they have.";
export const LIMITS_INTRO = "How many cars the shop accepts each day, for each line of work. A change never cancels a booking that already exists.";
export const EMAIL_INTRO = "Emails to customers and the shop inbox. No password is ever shown here.";
export const CONFIRM_MAINTENANCE = "Customers will see a maintenance page and cannot book or look up a booking. You can still use the admin.";
export const MAINTENANCE_BANNER = "The customer website is under maintenance. Customers see a maintenance page. Turn it off in Settings.";

type Change = Partial<Pick<AdminShopSettings, "maintenance" | "maintenanceMessage" | "bookingPaused">>;

/** Every value each time, so a retry is the same request and the other card's value is kept. */
export function updateBody(current: AdminShopSettings, change: Change) {
  const message = ("maintenanceMessage" in change ? change.maintenanceMessage : current.maintenanceMessage)?.trim() || null;
  return { expectedRevision: current.revision, maintenance: change.maintenance ?? current.maintenance, maintenanceMessage: message, bookingPaused: change.bookingPaused ?? current.bookingPaused };
}

/** The same limits as ShopSettingsUpdateSchema. */
export function messageProblem(text: string): string | null {
  if (text.trim().length > 200) return "Keep the message to 200 characters.";
  return /^\P{Cc}*$/u.test(text.trim()) ? null : "The message can only be one line of plain text.";
}

export const websiteLine = (s: AdminShopSettings): string => (s.maintenance ? "Under maintenance. Customers see a maintenance page." : "Live. Customers can see every page.");
export function bookingLine(s: AdminShopSettings): string {
  if (s.bookingPausedByServer) return "Paused by the server setting. Change ONLINE_BOOKING_MODE in Railway to open it.";
  return s.bookingPaused ? "Paused. New bookings are refused; customers can still manage the bookings they have." : "Open. Customers can book online.";
}
export const emailStatus = (s: AdminShopSettings): string =>
  s.email.configured ? "Set up. The server has what it needs to send booking emails." : "Not set up. Customers do not get an email. Whoever manages the website has to add the shop's mail account in the hosting settings.";
export const emailCounts = (s: AdminShopSettings): string => `Shop emails in the last 7 days: ${s.email.failedLast7Days} failed, ${s.email.waitingLast7Days} waiting.`;

export function savedText(before: AdminShopSettings, after: AdminShopSettings): string {
  if (before.maintenance !== after.maintenance) return `${after.maintenance ? "The website is under maintenance." : "The website is live again."} Customers see it within a few seconds.`;
  if (before.bookingPaused !== after.bookingPaused) return after.bookingPaused ? "Online booking is paused." : "Online booking is open.";
  return before.maintenanceMessage !== after.maintenanceMessage ? "The message was saved." : "Nothing needed changing.";
}

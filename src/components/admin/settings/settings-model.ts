// P1-42: the plain words of the Settings screen and what a save sends. No React, no network, so they are unit tested.
import type { AdminEmailPreviewKind, AdminLastChanged, AdminShopSettings, AdminTestEmail } from "@/types/admin-contracts";

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
  if (s.bookingPausedByServer) return "Paused by the website host. Ask whoever manages the website to open it.";
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

// Side tabs (2026-11-24): the sections in list order, Danger zone last. The chosen one lives in ?section=.
export type SettingsSection = "overview" | "hours" | "limits" | "email" | "danger";
export const SETTINGS_SECTIONS: readonly [SettingsSection, string][] = [
  ["overview", "Overview"],
  ["hours", "Hours & closed days"],
  ["limits", "Daily limits"],
  ["email", "Email"],
  ["danger", "Danger zone"],
];
export function sectionFromSearch(search: string): SettingsSection {
  const id = new URLSearchParams(search).get("section");
  return SETTINGS_SECTIONS.find(([s]) => s === id)?.[0] ?? "overview";
}

// The Overview's status lines: plain when healthy, amber or red only when something needs action.
export type OverviewRow = { label: string; value: string; tone: "ok" | "warn" | "bad"; section: SettingsSection | null };
export const overviewRows = (s: AdminShopSettings): OverviewRow[] => [
  { label: "Customer website", value: s.maintenance ? "Under maintenance" : "Live", tone: s.maintenance ? "warn" : "ok", section: "danger" },
  { label: "Email", value: s.email.configured ? "Set up" : "Not set up", tone: s.email.configured ? "ok" : "warn", section: "email" },
  { label: "Failed emails, 7 days", value: String(s.email.failedLast7Days), tone: s.email.failedLast7Days > 0 ? "bad" : "ok", section: "email" },
];

// The address after choosing a section: only `section` changes. On /admin the portal picks its tab from ?tab=, so name Settings
// there too; otherwise a refresh or a shared link would open the Dashboard.
export function settingsUrl(pathname: string, search: string, section: SettingsSection): string {
  const params = new URLSearchParams(search);
  if (pathname === "/admin") params.set("tab", "System Settings");
  if (section === "overview") params.delete("section");
  else params.set("section", section);
  const query = params.toString();
  return pathname + (query ? "?" + query : "");
}

// Ported 2026-11-25 from the P1-78 UI/UX draft (ZEUS-CODEX-UIUX) when the LE moved the screens to Claude.
// P1-78: when and who, in shop time. The server sends no name to a non-admin, and nothing when it does not know.
const shopTime = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", ...opts });
export function lastChangedLine(lc: AdminLastChanged | null, prefix = "Last changed"): string | null {
  if (!lc) return null;
  const when = shopTime(lc.at, { dateStyle: "medium", timeStyle: "short" });
  return (prefix === "Last changed" ? prefix + " " : prefix + ": ") + when + (lc.by ? " by " + lc.by : "");
}

// P1-78 (item 1): plain words for each result. Only the shop inbox ever gets a test email, so no address is shown.
const TEST_EMAIL_FAILED: Record<Exclude<AdminTestEmail["result"], "sent">, string> = {
  config_missing: "Not sent: email is not set up on the server.",
  auth_rejected: "Not sent: the mail server refused the shop's sign-in.",
  timeout: "Not sent: the mail server did not answer. Try again later.",
  unreachable: "Not sent: the mail server did not answer. Try again later.",
  tls_failed: "Not sent: a secure connection to the mail server failed.",
  refused: "Not sent: the mail server refused the message.",
  error: "Not sent: something went wrong. Try again later.",
};
export function testEmailText(r: AdminTestEmail): { ok: boolean; text: string } {
  if (r.result === "sent") return { ok: true, text: "Test email sent to the shop inbox at " + shopTime(r.at, { timeStyle: "short" }) + ". Check the inbox (and spam)." };
  return { ok: false, text: TEST_EMAIL_FAILED[r.result] };
}
export const TEST_EMAIL_LIMIT_TEXT = "Three test emails in 10 minutes is the limit. Try again in 10 minutes.";

export const PREVIEW_KINDS: [AdminEmailPreviewKind, string][] = [
  ["confirmation", "Booking confirmation"],
  ["reminder", "Reminder"],
  ["turn_notice", "Turn notice"],
  ["car_ready", "Car ready"],
];

import type * as React from "react";
import type { AdminBookingDetail } from "@/types/admin-contracts";
import type { BookingStatus, UserRole } from "@/types/contracts";
import { statusActions } from "../model";

// P1-68: what every Booking details section shares. State and the write calls stay in booking-detail.tsx.
export type Write = (path: string, body: Record<string, unknown>, method?: string) => Promise<boolean>;

export const panel = "rounded-xl border border-border bg-panel";
export const panelHead = "flex min-h-[48px] items-center justify-between gap-3 border-b border-border px-4 sm:px-5";
export const sectionTitle = "text-sm font-semibold text-foreground";
export const label = "text-xs text-muted-foreground";
export const primary = "bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400";
export const doneButton = "bg-emerald-600 font-semibold text-white hover:bg-emerald-500";
export const quiet = "text-xs font-medium text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-400";
export const dangerText = "text-rose-700 dark:text-rose-400";

export function submit(e: React.FormEvent<HTMLFormElement>, run: (form: FormData) => void) {
  e.preventDefault();
  run(new FormData(e.currentTarget));
}

export const sentAt = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
// A shop calendar day (YYYY-MM-DD) as "Thu, 12 Nov 2026".
export const shopDay = (date: string) =>
  new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// One meaning per colour: amber = in progress, green = done, rose = cancelled, sky = confirmed.
export function statusPill(status: string) {
  const tone =
    status === "COMPLETED" || status === "DONE"
      ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : status === "IN_PROGRESS"
        ? "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : status === "CONFIRMED"
          ? "border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-400"
          : status === "CANCELLED"
            ? "border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
            : "border-border bg-raised text-muted-foreground";
  return `inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`;
}

// The header's next status step. Reinstate (PENDING) is not here: it needs a reason, so it has its own banner.
// While services are still open, Mark done shows disabled with the reason instead of disappearing.
export function nextStep(b: AdminBookingDetail, role: UserRole): { actions: BookingStatus[]; reason: string | null } | null {
  const actions = statusActions(b, role).filter((s) => s !== "PENDING");
  if (actions.length) return { actions, reason: null };
  if (b.status !== "IN_PROGRESS" || b.snapshot !== "QUEUE_V3") return null;
  const open = b.lines.filter((l) => !l.removed && l.workStatus !== "DONE").length;
  return { actions: [], reason: open ? `${open} ${open === 1 ? "service" : "services"} still open` : "Add a service first" };
}

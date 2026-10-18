import "server-only";
import { manilaToday } from "./availability-core";
import { addDays } from "./availability-days";
// ADR-005 Amendment 3: an absolute count across queues, independent of optional limits.
export function pendingAlertLevel(day: string, now: Date, pending: number, threshold = 20): "WARN" | null {
  const today = manilaToday(now);
  return day >= today && day <= addDays(today, 13) && pending > threshold ? "WARN" : null;
}

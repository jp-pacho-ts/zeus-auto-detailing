import "server-only";
import { manilaToday } from "./availability-core";
import { addDays } from "./availability-days";
export function pendingAlertLevel(day: string, now: Date, pending: number, cap: number): "WARN" | "INCIDENT" | null {
  const today = manilaToday(now);
  if (day < today || day > addDays(today, 13) || cap <= 0 || pending / cap <= 0.6) return null;
  return pending / cap > 0.85 ? "INCIDENT" : "WARN";
}

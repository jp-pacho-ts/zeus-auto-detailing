// The New booking dialog's pure rules (walk-in and phone bookings, 2026-11-27).
import type { DayAvailabilityData } from "@/types/contracts";
import { AdminRequestError } from "./client";

// The admin books while online booking is paused, so the picker never gets the pause flag (it would show the paused panel).
export const pickerData = (data: DayAvailabilityData | null) => data && { days: data.days, nextAvailableDay: data.nextAvailableDay };

// Keep the retry key only while the outcome is unknown (the server was unavailable, or no answer came), so a retry replays a
// booking that may have been saved. Any definite answer means the next save is a new request: edited details under the old
// key would be refused as an idempotency conflict.
export const nextKey = (error: unknown, key: string, makeKey: () => string) =>
  error instanceof AdminRequestError && error.detail.code !== "RETRYABLE_ERROR" ? makeKey() : key;

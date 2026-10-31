import "server-only";
// ADR-005: strictly before 18:00 Manila on the day before the visit.
export const CUSTOMER_CUTOFF_HOUR = 18;
export function customerCutoff(day: string): Date {
  return new Date(
    Date.parse(day + "T00:00:00+08:00") - (24 - CUSTOMER_CUTOFF_HOUR) * 3600000,
  );
}
export const beforeCustomerCutoff = (day: string, now: Date) =>
  now < customerCutoff(day);
export function recoveryAuthority(
  operation: { recoveryExpiresAt: Date; credentialVersion: number | null },
  version: number,
  now: Date,
): "RECOVERY_EXPIRED" | "UNAUTHENTICATED" | null {
  if (now >= operation.recoveryExpiresAt) return "RECOVERY_EXPIRED";
  return operation.credentialVersion === version ? null : "UNAUTHENTICATED";
}

// The exact policies used by the six management limiters. Only recovery has a real day cap.
export const MANAGEMENT_ADMISSION_POLICIES = {
  exchange: { perKeyPerMinute: 10, perKeyPerDay: null, maxConcurrentPerKey: 2 },
  recovery: { perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 2 },
  readClient: {
    perKeyPerMinute: 60,
    perKeyPerDay: null,
    maxConcurrentPerKey: 2,
  },
  mutationClient: {
    perKeyPerMinute: 15,
    perKeyPerDay: null,
    maxConcurrentPerKey: 2,
  },
  readBooking: {
    perKeyPerMinute: 30,
    perKeyPerDay: null,
    maxConcurrentPerKey: 2,
  },
  mutationBooking: {
    perKeyPerMinute: 5,
    perKeyPerDay: null,
    maxConcurrentPerKey: 2,
  },
} as const;

// P1-32: the public "reference code + last name" lookup. A reference code is 31 bits, so the caps are
// tight: per reference (counted for every attempt, found or not, from any IP) and per client.
export const LOOKUP_POLICIES = {
  client: { perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 2 },
  reference: { perKeyPerMinute: 5, perKeyPerDay: 10, maxConcurrentPerKey: 2 },
} as const;
// Failed lookups across the whole shop per hour: past this, answers are slowed and one alert is logged.
export const LOOKUP_CEILING = { failedPerHour: 200, delayMs: 2000 } as const;

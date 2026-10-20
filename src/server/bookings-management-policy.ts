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

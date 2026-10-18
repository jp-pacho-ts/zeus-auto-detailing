import "server-only";
import { QueueCodeSchema } from "@/types/catalog-contracts";
import { CatalogIntegrityError } from "./catalog-errors";
import type { ReleaseSnapshot } from "./catalog-pricing";

// ADR-005 §7 (working assumption, pending the shop owner): the service-to-queue mapping is
// release data. Each release's service rows carry a booking_queues code, verified by
// publish_catalog, so a mapping change is a new catalog release, never a code change.
export type QueueId = string;

// Fails closed: a service without a valid queue (a release published before the queue model)
// cannot be booked into any queue.
export function queueOfService(service: { queueCode: string | null }): QueueId {
  if (service.queueCode === null || !QueueCodeSchema.safeParse(service.queueCode).success) throw new CatalogIntegrityError("service has no queue");
  return service.queueCode;
}

// ADR-005 §8 (working assumption): the primary service is the first base (non-add-on) line in
// the customer's order. Add-ons never decide the queue. Staff may later move a booking (P1-07).
export function primaryServiceLine<T extends { serviceId: string }>(release: ReleaseSnapshot, lines: readonly T[]): T {
  const line = lines.find((l) => release.services.find((s) => s.id === l.serviceId)?.type === "BASE");
  if (!line) throw new CatalogIntegrityError("selection has no base service");
  return line;
}

export function bookingQueue(release: ReleaseSnapshot, lines: readonly { serviceId: string }[]): QueueId {
  const primary = primaryServiceLine(release, lines);
  return queueOfService(release.services.find((s) => s.id === primary.serviceId)!);
}

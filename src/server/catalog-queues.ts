import "server-only";
import { CatalogIntegrityError } from "./catalog-errors";
import type { ReleaseSnapshot } from "./catalog-pricing";

// ADR-005 §7 (working assumption, pending the shop owner): four queues following shared staff
// and bays. The service-to-queue mapping is catalog data, keyed by the stable service slug.
// Interim home: this table, until the booking-model migration (after P1-06 merges) moves the
// queue onto each release's service rows, so a mapping change becomes a catalog release.
export const CATALOG_QUEUES = [
  { id: "WASH", name: "Wash" },
  { id: "DETAILING_COATING", name: "Detailing + Coating" },
  { id: "TINT_PPF", name: "Tint + PPF" },
  { id: "REPAINT", name: "Repaint" },
] as const;
export type QueueId = (typeof CATALOG_QUEUES)[number]["id"];

export const SERVICE_QUEUE_BY_SLUG: Readonly<Record<string, QueueId>> = {
  "basic-wash": "WASH", "signature-wash": "WASH", "premium-wash": "WASH",
  "glass-acid-rain-removal": "WASH", "bac-to-zero": "WASH",
  "interior-detailing": "DETAILING_COATING", "exterior-detailing": "DETAILING_COATING", "engine-detailing": "DETAILING_COATING",
  "full-detailing": "DETAILING_COATING", "headlight-restoration": "DETAILING_COATING",
  "eclipse-graphene": "DETAILING_COATING", "arcane-graphene": "DETAILING_COATING", "kenzo-graphene": "DETAILING_COATING",
  "motorcycle-graphene": "DETAILING_COATING",
  "nano-ceramic-tint": "TINT_PPF", "sputtered-tint": "TINT_PPF", "regular-tint": "TINT_PPF",
  "ppf-7-5-mil": "TINT_PPF", "ppf-8-0-mil": "TINT_PPF",
  "panel-repaint": "REPAINT", "washover-repaint": "REPAINT",
};

// Fails closed: a service without a queue cannot be booked into any queue.
export function queueOfService(service: { slug: string }): QueueId {
  const queue = Object.hasOwn(SERVICE_QUEUE_BY_SLUG, service.slug) ? SERVICE_QUEUE_BY_SLUG[service.slug] : undefined;
  if (!queue) throw new CatalogIntegrityError("service has no queue");
  return queue;
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

// Prices, sizes, durations and booking modes come only from the published catalog release
// (ADR-004): GET /api/catalog and the server catalog services. This file keeps no price table.

// Admin analytics placeholder names (fixture text shown by the analytics tab until P1-08
// replaces the admin fixtures). Labels only: no price, duration or multiplier.
export const services: readonly { id: string; name: string }[] = [
  { id: "signature-9h-graphene", name: "Signature 9H Graphene Ceramic Coating" },
  { id: "three-year-ceramic-shield", name: "3-Year Commercial Ceramic Shield" },
  { id: "multi-stage-paint-correction", name: "Multi-Stage Paint Correction & Polish" },
];

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours > 0 && remainingMins > 0) {
    return `${hours}h ${remainingMins}m`;
  }
  if (hours > 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${remainingMins} mins`;
}

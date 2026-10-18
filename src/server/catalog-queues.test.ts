// Service-to-queue mapping and the primary-service rule (ADR-005 §7 and §8, working assumptions).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogIntegrityError, priceSelection } from "./catalog-pricing";
import { CATALOG_QUEUES, SERVICE_QUEUE_BY_SLUG, bookingQueue, primaryServiceLine, queueOfService } from "./catalog-queues";
import { bySlug, readManifest, releaseFromManifest } from "./catalog.fixture";

const release = releaseFromManifest();
const lines = (...slugs: string[]) => slugs.map((s) => ({ serviceId: bySlug(release, s).id, quantity: 1 }));

test("every catalog service maps to exactly the ADR-005 working-assumption queue", () => {
  assert.deepEqual(CATALOG_QUEUES.map((q) => q.id), ["WASH", "DETAILING_COATING", "TINT_PPF", "REPAINT"]);
  const expected: Record<string, string[]> = {
    WASH: ["basic-wash", "signature-wash", "premium-wash", "glass-acid-rain-removal", "bac-to-zero"],
    DETAILING_COATING: ["interior-detailing", "exterior-detailing", "engine-detailing", "full-detailing", "headlight-restoration",
      "eclipse-graphene", "arcane-graphene", "kenzo-graphene", "motorcycle-graphene"],
    TINT_PPF: ["nano-ceramic-tint", "sputtered-tint", "regular-tint", "ppf-7-5-mil", "ppf-8-0-mil"],
    REPAINT: ["panel-repaint", "washover-repaint"],
  };
  for (const [queue, slugs] of Object.entries(expected)) for (const slug of slugs) assert.equal(SERVICE_QUEUE_BY_SLUG[slug], queue, slug);
  // The mapping covers the 21 reviewed services and nothing else.
  const manifestSlugs = readManifest().services.map((s: { slug: string }) => s.slug).sort();
  assert.deepEqual(Object.keys(SERVICE_QUEUE_BY_SLUG).sort(), manifestSlugs);
  for (const service of release.services) assert.equal(queueOfService(service), SERVICE_QUEUE_BY_SLUG[service.slug]);
});

test("the booking joins the queue of its first base line; add-ons never decide it", () => {
  assert.equal(bookingQueue(release, lines("basic-wash")), "WASH");
  assert.equal(bookingQueue(release, lines("interior-detailing", "basic-wash")), "DETAILING_COATING");
  assert.equal(bookingQueue(release, lines("basic-wash", "interior-detailing")), "WASH");
  assert.equal(bookingQueue(release, lines("bac-to-zero", "ppf-8-0-mil", "basic-wash")), "TINT_PPF"); // the add-on comes first, the base decides
  assert.equal(primaryServiceLine(release, lines("bac-to-zero", "panel-repaint")).serviceId, bySlug(release, "panel-repaint").id);
  // No base line, an unknown service or an unmapped service fails closed.
  assert.throws(() => bookingQueue(release, lines("bac-to-zero")), CatalogIntegrityError);
  assert.throws(() => bookingQueue(release, [{ serviceId: "11111111-1111-4111-8111-111111111111" }]), CatalogIntegrityError);
  const renamed = structuredClone(release);
  bySlug(renamed, "basic-wash").slug = "basic-wash-2027";
  assert.throws(() => bookingQueue(renamed, lines("basic-wash").map((l) => ({ ...l }))), CatalogIntegrityError);
  // Pricing fails closed too (503 at the surface): no quote without a queue for its primary service.
  assert.throws(() => priceSelection(renamed, { vehicleCategoryId: renamed.sizes[1].id, lines: lines("basic-wash") }), CatalogIntegrityError);
});

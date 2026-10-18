// Service-to-queue mapping as release data and the primary-service rule (ADR-005 §7 and §8,
// working assumptions; Revision 3 §5).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogIntegrityError, priceSelection } from "./catalog-pricing";
import { bookingQueue, primaryServiceLine, queueOfService } from "./catalog-queues";
import { bySlug, readManifest, releaseFromManifest } from "./catalog.fixture";

const release = releaseFromManifest();
const lines = (...slugs: string[]) => slugs.map((s) => ({ serviceId: bySlug(release, s).id, quantity: 1 }));

test("the reviewed manifest maps every service to exactly the ADR-005 working-assumption queue", () => {
  const expected: Record<string, string[]> = {
    WASH: ["basic-wash", "signature-wash", "premium-wash", "glass-acid-rain-removal", "bac-to-zero"],
    DETAILING_COATING: ["interior-detailing", "exterior-detailing", "engine-detailing", "full-detailing", "headlight-restoration",
      "eclipse-graphene", "arcane-graphene", "kenzo-graphene", "motorcycle-graphene"],
    TINT_PPF: ["nano-ceramic-tint", "sputtered-tint", "regular-tint", "ppf-7-5-mil", "ppf-8-0-mil"],
    REPAINT: ["panel-repaint", "washover-repaint"],
  };
  const manifest = readManifest();
  const mapped = Object.fromEntries(manifest.services.map((s: { slug: string; queueCode: string }) => [s.slug, s.queueCode]));
  assert.equal(Object.keys(mapped).length, 21);
  assert.deepEqual(Object.values(expected).flat().sort(), Object.keys(mapped).sort());
  for (const [queue, slugs] of Object.entries(expected)) for (const slug of slugs) assert.equal(mapped[slug], queue, slug);
  // The release snapshot carries the mapping, and the queue is read from it.
  for (const service of release.services) assert.equal(queueOfService(service), mapped[service.slug]);
});

test("the booking joins the queue of its first base line; add-ons never decide it", () => {
  assert.equal(bookingQueue(release, lines("basic-wash")), "WASH");
  assert.equal(bookingQueue(release, lines("interior-detailing", "basic-wash")), "DETAILING_COATING");
  assert.equal(bookingQueue(release, lines("basic-wash", "interior-detailing")), "WASH");
  assert.equal(bookingQueue(release, lines("bac-to-zero", "ppf-8-0-mil", "basic-wash")), "TINT_PPF"); // the add-on comes first, the base decides
  assert.equal(primaryServiceLine(release, lines("bac-to-zero", "panel-repaint")).serviceId, bySlug(release, "panel-repaint").id);
  // No base line or an unknown service fails closed.
  assert.throws(() => bookingQueue(release, lines("bac-to-zero")), CatalogIntegrityError);
  assert.throws(() => bookingQueue(release, [{ serviceId: "11111111-1111-4111-8111-111111111111" }]), CatalogIntegrityError);
  // A remap is a new release: the queue follows the release data, not the slug.
  const remapped = structuredClone(release);
  bySlug(remapped, "basic-wash").queueCode = "REPAINT";
  assert.equal(bookingQueue(remapped, lines("basic-wash")), "REPAINT");
});

test("a release published before the queue model (no queue on the primary) is never quoted", () => {
  const unmapped = structuredClone(release);
  bySlug(unmapped, "basic-wash").queueCode = null;
  assert.throws(() => bookingQueue(unmapped, lines("basic-wash")), CatalogIntegrityError);
  // Pricing fails closed too (503 at the surface); a non-primary line without a queue decides nothing.
  assert.throws(() => priceSelection(unmapped, { vehicleCategoryId: unmapped.sizes[1].id, lines: lines("basic-wash") }), CatalogIntegrityError);
  assert.equal(priceSelection(unmapped, { vehicleCategoryId: unmapped.sizes[1].id, lines: lines("interior-detailing", "basic-wash") }).kind, "QUOTED");
  for (const bad of ["wash", "", "WASH-1"]) {
    const malformed = structuredClone(release);
    bySlug(malformed, "basic-wash").queueCode = bad;
    assert.throws(() => bookingQueue(malformed, lines("basic-wash")), CatalogIntegrityError, bad);
  }
});

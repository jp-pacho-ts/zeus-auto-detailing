// Public catalog projection: exact allowlists at every level (T-040 P-02, T-043 C-02 / T-046
// cases 6 and 8), the quote query adapter and the C-02 read seam boundary. No database.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ServiceSizeOfferSchema } from "@/types/catalog-contracts";
import type { ReleaseSnapshot } from "./catalog-pricing";
import { projectPublicCatalog } from "./catalog";
import { parseBookingQuoteQuery } from "./catalog-quote";
import { releaseFromManifest } from "./catalog.fixture";

const CATALOG_KEYS = ["catalogReleaseId", "catalogVersion", "vehicleCategories", "services", "addOnCompatibility"];
const SIZE_KEYS = ["id", "code", "name", "description", "sortOrder"];
const SERVICE_KEYS = ["id", "slug", "name", "description", "category", "type", "unit", "inclusions", "productName", "hardness",
  "warrantyMonths", "referenceUnitPriceCentavos", "offers"];
const OFFER_KEYS = ["id", "vehicleCategoryId", "duration", "state", "bookingMode", "unitPriceCentavos", "compareAtCentavos"];
const CANARIES = ["bayCapacityRequired", "maxVehicleCapacity", "remainingCapacity", "bayHoldPolicy", "segments", "sizeMultiplier",
  "sourceCompareAtCentavos", "compareAtVerified", "provenance", "sourceName", "rating", "costCentavos", "privateNote", "manifestSha256", "CANARY"];

// The internal snapshot with private fields injected at every level, as a careless model spread would carry them.
function poisoned(): ReleaseSnapshot {
  const r = releaseFromManifest() as unknown as Record<string, unknown> & ReleaseSnapshot;
  const extra = { bayCapacityRequired: 1, maxVehicleCapacity: 3, remainingCapacity: 2, bayHoldPolicy: "CONTINUOUS", segments: [{ dayOffset: 0 }],
    sizeMultiplier: 1.35, sourceCompareAtCentavos: 2883300, compareAtVerified: false, compareAtCentavos: 999999, provenance: { CANARY: 1 },
    sourceName: "CANARY source", rating: 5, costCentavos: 1, privateNote: "CANARY note" };
  Object.assign(r, extra);
  for (const s of r.sizes) Object.assign(s, extra);
  for (const s of r.services) { Object.assign(s, extra); for (const o of s.offers) Object.assign(o, extra); }
  for (const c of r.compatibility) Object.assign(c, extra);
  return r;
}

test("the public catalog is an explicit allowlist: five sizes, 21 services, 105 offers, no private field", () => {
  const catalog = projectPublicCatalog(poisoned());
  assert.deepEqual(Object.keys(catalog), CATALOG_KEYS);
  assert.deepEqual(catalog.vehicleCategories.map((v) => v.code), ["MOTOR", "S", "M", "L", "XL"]);
  for (const v of catalog.vehicleCategories) assert.deepEqual(Object.keys(v), SIZE_KEYS);
  assert.equal(catalog.services.length, 21);
  for (const s of catalog.services) {
    assert.deepEqual(Object.keys(s), SERVICE_KEYS, s.slug);
    assert.deepEqual(s.offers.map((o) => o.vehicleCategoryId), catalog.vehicleCategories.map((v) => v.id), s.slug);
    for (const o of s.offers) {
      assert.deepEqual(Object.keys(o), OFFER_KEYS, s.slug);
      assert.ok(ServiceSizeOfferSchema.safeParse(o).success, `${s.slug} offer fails the contract schema`);
      assert.equal(o.compareAtCentavos, null); // comparison prices are never public by default
    }
  }
  for (const c of catalog.addOnCompatibility) assert.deepEqual(Object.keys(c), ["baseServiceId", "addOnServiceId"]);
  assert.equal(catalog.addOnCompatibility.length, 6);
  const wire = JSON.stringify(catalog);
  for (const canary of CANARIES) assert.equal(wire.includes(canary), false, canary);
  assert.equal(wire.includes("2883300"), false); // Arcane S printed regular price stays internal
});

test("offer states and durations project exactly; labels pass through as text", () => {
  const release = releaseFromManifest();
  const catalog = projectPublicCatalog(release);
  const find = (slug: string, code: string) => {
    const s = catalog.services.find((x) => x.slug === slug)!;
    return s.offers.find((o) => o.vehicleCategoryId === catalog.vehicleCategories.find((v) => v.code === code)!.id)!;
  };
  assert.deepEqual({ ...find("basic-wash", "MOTOR"), id: "x" }, { id: "x", vehicleCategoryId: catalog.vehicleCategories[0].id,
    duration: { kind: "TIMED", minutes: 30 }, state: "OFFERED", bookingMode: "FIXED_ONLINE", unitPriceCentavos: 10000, compareAtCentavos: null });
  assert.deepEqual(find("premium-wash", "MOTOR").duration, { kind: "UNKNOWN" });
  assert.equal(find("premium-wash", "MOTOR").state, "NOT_OFFERED");
  assert.equal(find("premium-wash", "MOTOR").unitPriceCentavos, null);
  assert.deepEqual([find("headlight-restoration", "M").state, find("headlight-restoration", "M").unitPriceCentavos], ["UNCONFIRMED", null]);
  assert.deepEqual([find("arcane-graphene", "S").unitPriceCentavos, find("arcane-graphene", "S").bookingMode], [1310000, "QUOTE_REQUIRED"]);
  const panel = catalog.services.find((s) => s.slug === "panel-repaint")!;
  assert.deepEqual([panel.unit, panel.referenceUnitPriceCentavos], ["PANEL", 350000]);
  // A hostile label is returned verbatim as JSON text; rendering is text, never HTML.
  const hostile = structuredClone(release);
  hostile.services[0].name = "<img src=x onerror=alert(1)>";
  assert.equal(projectPublicCatalog(hostile).services[0].name, "<img src=x onerror=alert(1)>");
});

test("the quote query adapter takes exactly four keys, canonical numbers and one comma list", () => {
  const ids = ["0b8b3b3e-2b1a-4e5c-9f00-000000000001", "0b8b3b3e-2b1a-4e5c-9f00-000000000002"];
  const q = (s: string) => parseBookingQuoteQuery(new URLSearchParams(s));
  const base = `serviceId=${ids[0]}&vehicleCategoryId=${ids[1]}`;
  assert.deepEqual(q(`${base}&quantity=1&addOnServiceIds=`), { ok: true, data: { serviceId: ids[0], vehicleCategoryId: ids[1], quantity: 1, addOnServiceIds: [] } });
  assert.deepEqual(q(`${base}&quantity=20&addOnServiceIds=${ids[0]},${ids[1]}`), { ok: true, data: { serviceId: ids[0], vehicleCategoryId: ids[1], quantity: 20, addOnServiceIds: ids } });
  for (const bad of [
    `${base}&quantity=1`, `${base}&addOnServiceIds=`, `${base}&quantity=1&addOnServiceIds=&extra=1`, `${base}&quantity=1&quantity=1&addOnServiceIds=`,
    `${base}&${base}&quantity=1&addOnServiceIds=`, ...["0", "21", "01", "1.0", "+1", " 1", "1e1", "", "abc", "-1"].map((n) => `${base}&quantity=${encodeURIComponent(n)}&addOnServiceIds=`),
    `${base}&quantity=1&addOnServiceIds=${ids[0]},`, `${base}&quantity=1&addOnServiceIds=,${ids[0]}`,
  ]) assert.equal(q(bad).ok, false, bad);
  // Duplicate, unsorted and over-limit add-on lists reach the schema, which rejects them.
});

test("C-02: only the read seam touches the database in the catalog modules", () => {
  const dir = path.join(process.cwd(), "src", "server");
  const files = fs.readdirSync(dir).filter((f) => /^catalog.*\.ts$/.test(f) && !/\.test\.ts$|\.fixture\.ts$/.test(f));
  assert.ok(files.includes("catalog-read.ts") && files.includes("catalog.ts") && files.includes("catalog-quote.ts"), files.join());
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    const touchesDb = /from "\.\/db"|\$transaction|\$queryRaw|\$executeRaw|\bprisma\./.test(source);
    assert.equal(touchesDb, file === "catalog-read.ts", `${file} must read the catalog only through readPublicCatalog/loadCurrentRelease`);
  }
  const route = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "catalog", "route.ts"), "utf8");
  assert.doesNotMatch(route, /@\/server\/db|\$transaction|\$queryRaw|prisma/);
  assert.match(route, /getBookingCatalog\(/);
});

// Test support: the reviewed P1-01 manifest as the internal release snapshot that
// loadCurrentRelease() returns for a published release. Not imported by application code.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ReleaseSnapshot } from "./catalog-pricing";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Manifest = any;
export const readManifest = (): Manifest =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "prisma", "catalog", "manifest.json"), "utf8"));

// Same canonical form and hash as prisma/catalog/catalog.mjs (seed and publish_catalog).
const sortKeys = (value: any): any => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])])) : value;
export const canonicalManifest = (manifest: Manifest) => JSON.stringify(sortKeys(manifest));
export const manifestSha256 = (manifest: Manifest) => createHash("sha256").update(canonicalManifest(manifest)).digest("hex");

export function releaseFromManifest(manifest: Manifest = readManifest(), releaseId = "0e5d1c7e-3b0a-4c8e-9d61-0a8f1b2c3d4e"): ReleaseSnapshot {
  return {
    releaseId,
    version: manifest.version,
    manifestSha256: manifestSha256(manifest),
    sizes: manifest.sizes.map((s: any) => ({ id: s.id, code: s.code, name: s.name, description: null, sortOrder: s.sortOrder })),
    services: manifest.services.map((s: any) => ({
      id: s.id, slug: s.slug, name: s.name, description: s.description, group: s.group, type: s.type, unit: s.unit,
      inclusions: s.inclusions, productName: s.productName, hardness: s.hardness, warrantyMonths: s.warrantyMonths,
      referenceUnitPriceCentavos: s.referenceUnitPriceCentavos, sortOrder: s.sortOrder, queueCode: s.queueCode ?? null,
      offers: s.offers.map((o: any) => ({
        id: o.id, vehicleCategoryId: o.vehicleCategoryId, sizeCode: o.sizeCode, state: o.state, bookingMode: o.bookingMode,
        unitPriceCentavos: o.unitPriceCentavos, durationKind: o.durationKind, durationMinutes: o.durationMinutes, elapsedDays: o.elapsedDays,
      })),
    })),
    compatibility: manifest.compatibility.map((c: any) => ({ baseServiceId: c.baseServiceId, addOnServiceId: c.addOnServiceId, sizeCodes: c.sizeCodes })),
  };
}

export const bySlug = (release: ReleaseSnapshot, slug: string) => {
  const service = release.services.find((s) => s.slug === slug);
  if (!service) throw new Error(`no service ${slug}`);
  return service;
};
export const sizeId = (release: ReleaseSnapshot, code: string) => {
  const size = release.sizes.find((s) => s.code === code);
  if (!size) throw new Error(`no size ${code}`);
  return size.id;
};

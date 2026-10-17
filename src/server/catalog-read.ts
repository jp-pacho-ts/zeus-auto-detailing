import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { VehicleCategoryCodeSchema } from "@/types/catalog-contracts";
import { CatalogIntegrityError, type ReleaseOffer, type ReleaseSnapshot } from "./catalog-pricing";
import { prisma } from "./db";

// C-02 (T-043): the one named read seam for public catalog reads. GET /api/catalog,
// getBookingCatalog(), getBookingQuote() and any public page or Action read the current release
// only through readPublicCatalog, so P1-10 can take the QUOTE admission permit here, before
// the first query. It is one connection: a single REPEATABLE READ, read-only transaction with
// the QUOTE statement timeout, whose sequential queries all see the same release (no mixing of
// head, offers or compatibility across a concurrent publication).
export type CatalogTx = Prisma.TransactionClient;
export interface CatalogReadOptions { db?: PrismaClient }
export const PUBLIC_CATALOG_READ_POLICY = { statementTimeoutMs: 2000, maxWaitMs: 2000, transactionTimeoutMs: 8000 } as const;

export async function readPublicCatalog<T>(work: (release: ReleaseSnapshot | null, tx: CatalogTx) => T | Promise<T>, options: CatalogReadOptions = {}): Promise<T> {
  const policy = PUBLIC_CATALOG_READ_POLICY;
  return (options.db ?? prisma).$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(policy.statementTimeoutMs)}, true),
      set_config('transaction_read_only', 'on', true)`;
    return work(await loadCurrentRelease(tx), tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: policy.maxWaitMs, timeout: policy.transactionTimeoutMs });
}

// The published head and all of its rows, read in the caller's transaction (the seam above, or
// a create transaction that rechecks an accepted quote under the shop lock). Null with no head.
// A release that breaks the five-sizes-per-service shape fails closed.
export async function loadCurrentRelease(tx: CatalogTx): Promise<ReleaseSnapshot | null> {
  const head = await tx.catalogHead.findUnique({ where: { shopId: 1 }, select: { release: { select: { id: true, version: true, state: true, manifestSha256: true } } } });
  if (!head) return null;
  const { release } = head;
  if (release.state !== "PUBLISHED") throw new CatalogIntegrityError("catalog head is not a published release");
  const versions = await tx.catalogServiceVersion.findMany({
    where: { releaseId: release.id }, orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
    select: { serviceId: true, slug: true, name: true, description: true, group: true, type: true, unit: true, inclusions: true,
      productName: true, hardness: true, warrantyMonths: true, referenceUnitPriceCentavos: true, sortOrder: true },
  });
  const offers = await tx.serviceSizeOffer.findMany({
    where: { releaseId: release.id },
    select: { id: true, serviceId: true, vehicleCategoryId: true, sizeCode: true, state: true, bookingMode: true, unitPriceCentavos: true,
      workPlan: { select: { kind: true, durationMinutes: true, elapsedDays: true } } },
  });
  const sizes = await tx.vehicleCategory.findMany({
    where: { id: { in: [...new Set(offers.map((o) => o.vehicleCategoryId))] } }, orderBy: { sortOrder: "asc" },
    select: { id: true, slug: true, name: true, description: true, sortOrder: true },
  });
  const compatibility = await tx.addOnCompatibility.findMany({ where: { releaseId: release.id }, select: { baseServiceId: true, addOnServiceId: true, sizeCodes: true } });

  const sizeCodes = sizes.map((s) => VehicleCategoryCodeSchema.safeParse(s.slug));
  if (sizes.length !== VehicleCategoryCodeSchema.options.length || sizeCodes.some((c) => !c.success)) throw new CatalogIntegrityError("release sizes are not the five codes");
  const byService = new Map<string, ReleaseOffer[]>();
  for (const o of offers) {
    if (!o.workPlan) throw new CatalogIntegrityError("offer without a work plan");
    const list = byService.get(o.serviceId) ?? [];
    list.push({ id: o.id, vehicleCategoryId: o.vehicleCategoryId, sizeCode: o.sizeCode, state: o.state, bookingMode: o.bookingMode,
      unitPriceCentavos: o.unitPriceCentavos, durationKind: o.workPlan.kind, durationMinutes: o.workPlan.durationMinutes, elapsedDays: o.workPlan.elapsedDays });
    byService.set(o.serviceId, list);
  }
  const sizeOrder = new Map(sizes.map((s, i) => [s.id, i]));
  return {
    releaseId: release.id, version: release.version, manifestSha256: release.manifestSha256,
    sizes: sizes.map((s, i) => ({ id: s.id, code: sizeCodes[i].data!, name: s.name, description: s.description, sortOrder: s.sortOrder })),
    services: versions.map((v) => {
      const own = (byService.get(v.serviceId) ?? []).sort((a, b) => sizeOrder.get(a.vehicleCategoryId)! - sizeOrder.get(b.vehicleCategoryId)!);
      if (own.length !== sizes.length || new Set(own.map((o) => o.vehicleCategoryId)).size !== sizes.length) throw new CatalogIntegrityError("service without five size offers");
      return { id: v.serviceId, slug: v.slug, name: v.name, description: v.description, group: v.group, type: v.type, unit: v.unit,
        inclusions: [...v.inclusions], productName: v.productName, hardness: v.hardness, warrantyMonths: v.warrantyMonths,
        referenceUnitPriceCentavos: v.referenceUnitPriceCentavos, sortOrder: v.sortOrder, offers: own };
    }),
    compatibility: compatibility.map((c) => ({ baseServiceId: c.baseServiceId, addOnServiceId: c.addOnServiceId, sizeCodes: [...c.sizeCodes] })),
  };
}

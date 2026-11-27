import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { readManifest } from "../catalog.fixture";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "../catalog-db.fixture";
import type { StaffActor } from "./context";
import * as services from "./services";

const rootUrl = process.env.T007_TEST_DATABASE_URL;
const skip = !rootUrl;
const url = rootUrl ? siblingDatabaseUrl(rootUrl, "service_delete") : "postgresql://unused@localhost/zeus_t007_unused";
const root = new PrismaClient({ datasources: { db: { url: rootUrl ?? url } } });
const owner = new PrismaClient({ datasources: { db: { url } } });
let app: PrismaClient;
let actor: StaffActor;
let staff: StaffActor;

before(async () => {
  if (skip) return;
  await createAndMigrate(root, url);
  provisionRuntimeRole(url);
  app = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(url) } } });
  actor = { staffId: await mapPublisher(owner, "delete-admin@example.test"), role: "ADMIN", sessionId: randomUUID() };
  const person = await owner.staff.create({ data: { name: "Synthetic Detailer", phone: "", email: "delete-staff@example.test", role: "DETAILER" } });
  staff = { staffId: person.id, role: "STAFF", sessionId: randomUUID() };
  const tooling = await import(path.join(process.cwd(), "prisma/catalog/catalog.mjs")) as { stableId(k: string): string };
  await publish(owner, readManifest(), tooling.stableId);
});
after(async () => { await app?.$disconnect(); await owner.$disconnect(); await root.$disconnect(); });

const create = async () => services.createAdminService(actor, {
  name: `Synthetic Delete ${randomUUID()}`, category: "WASH", type: "BASE", unit: "VEHICLE",
  offers: ["MOTOR", "S", "M", "L", "XL"].map((sizeCode) => ({ sizeCode, state: "OFFERED", unitPriceCentavos: 15000, compareAtCentavos: null })),
}, { db: app });
const remove = (who: StaffActor, id: string) => {
  assert.ok("deleteAdminService" in services, "The service must expose permanent deletion separately from deactivation");
  return (services as typeof services & { deleteAdminService(actor: StaffActor, id: string, options: { db: PrismaClient }): Promise<{ ok: true }> }).deleteAdminService(who, id, { db: app });
};

test("unused active and inactive services are permanently deleted, including prices and commission rows", { skip }, async () => {
  for (const active of [true, false]) {
    const { serviceId } = await create();
    if (!active) await services.toggleAdminService(actor, serviceId, false, { db: app });
    await owner.serviceSizeCommission.create({ data: { serviceId, sizeCode: "S", fixedCentavos: 100 } });
    const offers = await owner.serviceSizeOffer.findMany({ where: { serviceId } });
    assert.ok(offers.length > 0);
    assert.deepEqual(await remove(actor, serviceId), { ok: true });
    assert.equal(await owner.service.count({ where: { id: serviceId } }), 0);
    assert.equal(await owner.catalogServiceVersion.count({ where: { serviceId } }), 0);
    assert.equal(await owner.serviceSizeOffer.count({ where: { serviceId } }), 0);
    assert.equal(await owner.serviceWorkPlan.count({ where: { offerId: { in: offers.map((o) => o.id) } } }), 0);
    assert.equal(await owner.serviceSizeCommission.count({ where: { serviceId } }), 0);
    assert.ok(!(await services.listAdminServices(actor, { db: app })).services.some((s) => s.id === serviceId));
  }
});

test("staff, forged admin actors, missing and invalid ids cannot delete", { skip }, async () => {
  const { serviceId } = await create();
  await assert.rejects(async () => remove(staff, serviceId), { adminCode: "FORBIDDEN" });
  await assert.rejects(async () => remove({ ...staff, role: "ADMIN" }, serviceId), { adminCode: "FORBIDDEN" });
  await assert.rejects(async () => remove(actor, randomUUID()), { adminCode: "NOT_FOUND" });
  await assert.rejects(async () => remove(actor, ""), { adminCode: "VALIDATION_ERROR" });
  assert.equal(await owner.service.count({ where: { id: serviceId } }), 1);
  await assert.rejects(app.$executeRawUnsafe("DELETE FROM services WHERE id=$1", serviceId), /permission denied/i);
});

test("a catalog compatibility dependency refuses deletion atomically and keeps deactivation available", { skip }, async () => {
  const link = await owner.addOnCompatibility.findFirstOrThrow();
  const before = await owner.serviceSizeOffer.findMany({ where: { serviceId: link.baseServiceId } });
  await assert.rejects(async () => remove(actor, link.baseServiceId), { adminCode: "NOT_ALLOWED" });
  assert.deepEqual(await owner.serviceSizeOffer.findMany({ where: { serviceId: link.baseServiceId } }), before);
  await services.toggleAdminService(actor, link.baseServiceId, false, { db: app });
  assert.equal((await owner.service.findUniqueOrThrow({ where: { id: link.baseServiceId } })).isActive, false);
});

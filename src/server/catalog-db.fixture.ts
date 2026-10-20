// Test support: create, migrate and publish into an isolated sibling database of the T007 test
// database (<T007 name>_<suffix>) on the same loopback server. Not imported by application code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { canonicalManifest, manifestSha256, type Manifest } from "./catalog.fixture";

// The sibling database URL, after checking the T007 URL is an isolated local test database.
export function siblingDatabaseUrl(t007Url: string, suffix: string): string {
  const parsed = new URL(t007Url);
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname) && /^\/zeus_t007_[A-Za-z0-9_]+$/.test(parsed.pathname), "Use only an isolated local test database");
  parsed.pathname = parsed.pathname + "_" + suffix;
  return parsed.toString();
}

export async function createAndMigrate(admin: PrismaClient, url: string): Promise<void> {
  const name = new URL(url).pathname.slice(1);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`).catch((error: unknown) => {
    throw new Error(`Could not create ${name} (use a fresh T007 database; the role needs CREATEDB): ${(error as Error).message}`);
  });
  const migrate = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
}

// P1-10 M1: provision the runtime role in a test database exactly as an operator does, with the
// owner running prisma/sql/runtime-role.sql. The loopback test cluster lets zeus_app log in
// without a password; a deployed role gets one interactively.
export function provisionRuntimeRole(ownerUrl: string): void {
  const run = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "db", "execute",
    "--file", path.join(process.cwd(), "prisma", "sql", "runtime-role.sql"), "--url", ownerUrl], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
}
export function runtimeRoleUrl(ownerUrl: string): string {
  const parsed = new URL(ownerUrl);
  parsed.username = "zeus_app";
  parsed.password = "";
  return parsed.toString();
}
// With T007_SERVICE_ROLE=zeus_app (set by runtime-role.integration.test.ts), a suite runs its
// service calls as the provisioned runtime role while its fixtures keep the owner client.
export async function serviceClient(ownerUrl: string, owner: PrismaClient): Promise<PrismaClient> {
  if (process.env.T007_SERVICE_ROLE !== "zeus_app") return owner;
  provisionRuntimeRole(ownerUrl);
  const { PrismaClient: Client } = await import("@prisma/client");
  return new Client({ datasources: { db: { url: runtimeRoleUrl(ownerUrl) } } });
}

// Reruns one service suite with T007_SERVICE_ROLE=zeus_app on a fresh sibling database
// (<T007 name>_rr_<name>); it must pass with nothing skipped. Returns the runner's summary.
export async function runSuiteAsRuntimeRole(admin: PrismaClient, t007Url: string, name: string, file: string, servicesUseDatabaseUrl = false): Promise<string> {
  const suiteUrl = siblingDatabaseUrl(t007Url, "rr_" + name);
  await createAndMigrate(admin, suiteUrl);
  if (servicesUseDatabaseUrl) provisionRuntimeRole(suiteUrl);
  // NODE_TEST_CONTEXT would make the nested runner report in the parent's child protocol.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  void _context;
  const run = spawnSync(process.execPath, ["--require", path.join(process.cwd(), "src", "server", "__tests__", "register.cjs"), "--test", file], {
    cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...env, T007_SERVICE_ROLE: "zeus_app", T007_TEST_DATABASE_URL: suiteUrl, DATABASE_URL: servicesUseDatabaseUrl ? runtimeRoleUrl(suiteUrl) : suiteUrl },
  });
  const summary = (run.stdout.match(/^ℹ (tests|pass|fail|cancelled|skipped) \d+$/gm) ?? []).join("; ");
  const failures = run.stdout.split("\n").filter((l) => /^✖|permission denied/i.test(l)).slice(0, 40).join("\n");
  assert.equal(run.status, 0, `${summary}\n${failures}\n${run.stdout.slice(-4000)}\n${run.stderr.slice(-2000)}`);
  assert.match(summary, /fail 0/);
  assert.match(summary, /cancelled 0/);
  assert.match(summary, /skipped 0/);
  return summary;
}

// The publisher mapping: this test login as an active ADMIN (publish_catalog reads session_user).
export async function mapPublisher(db: PrismaClient, email: string): Promise<string> {
  const [{ role }] = await db.$queryRaw<{ role: string }[]>`SELECT session_user::text AS role`;
  const staff = await db.staff.create({ data: { name: "Catalog Test Admin", phone: "", email, role: "ADMIN" } });
  await db.catalogPublisher.create({ data: { databaseRole: role, actorStaffId: staff.id } });
  return staff.id;
}

// Mirrors prisma/catalog/catalog.mjs seedCatalog (draft only), without its source-document
// check, so tests can also publish label or mode changes. publish_catalog still verifies every
// stored row against the manifest JSON and hash.
export async function insertDraft(db: PrismaClient, target: Manifest, stableId: (key: string) => string): Promise<{ releaseId: string; hash: string }> {
  const releaseId = stableId("release." + target.version);
  const hash = manifestSha256(target);
  const groupToKind: Record<string, "EXTERIOR_WASH_SEAL" | "INTERIOR_DETAILING" | "CERAMIC_COATING" | "WINDOW_TINT_PPF" | "PAINT_CORRECTION"> =
    { WASH: "EXTERIOR_WASH_SEAL", DETAILING: "INTERIOR_DETAILING", GRAPHENE: "CERAMIC_COATING", TINT: "WINDOW_TINT_PPF", PPF: "WINDOW_TINT_PPF", REPAINT: "PAINT_CORRECTION" };
  await db.$transaction(async (tx) => {
    await tx.catalogRelease.create({ data: { id: releaseId, version: target.version, sourcePath: target.sourcePath,
      sourceReceivedDate: new Date(target.sourceReceivedDate + "T00:00:00Z"), sourceSha256: target.sourceSha256, manifestSha256: hash, manifestJson: canonicalManifest(target) } });
    for (const size of target.sizes) {
      if (!(await tx.vehicleCategory.findUnique({ where: { slug: size.code } }))) {
        await tx.vehicleCategory.create({ data: { id: size.id, slug: size.code, name: size.name, sortOrder: size.sortOrder, sizeMultiplier: null } });
      }
    }
    for (const service of target.services) {
      if (!(await tx.service.findUnique({ where: { slug: service.slug } }))) {
        await tx.service.create({ data: { id: service.id, slug: service.slug, name: service.name, category: groupToKind[service.group], price: null, durationMinutes: null, isActive: false } });
      }
      const { id, offers, ...metadata } = service;
      await tx.catalogServiceVersion.create({ data: { releaseId, serviceId: id, ...metadata } });
      for (const offer of offers) {
        const { durationKind, durationMinutes, elapsedDays, bayHoldPolicy, ...data } = offer;
        await tx.serviceSizeOffer.create({ data: { ...data, releaseId, serviceId: id, workPlan: { create: { kind: durationKind, durationMinutes, elapsedDays, bayHoldPolicy } } } });
      }
    }
    for (const pair of target.compatibility) await tx.addOnCompatibility.create({ data: { releaseId, ...pair } });
  }, { timeout: 60_000 });
  return { releaseId, hash };
}

export async function publish(db: PrismaClient, target: Manifest, stableId: (key: string) => string, reason = "P1-02 test publication"): Promise<string> {
  const { releaseId, hash } = await insertDraft(db, target, stableId);
  await db.$queryRaw`SELECT publish_catalog(${releaseId}, ${hash}, ${"P1-02 synthetic review"}, ${reason}) AS event_id`;
  return releaseId;
}

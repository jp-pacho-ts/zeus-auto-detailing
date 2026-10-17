import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { documentPrices } from './document-reader.mjs';
import { seedCatalog, readManifest, canonical, storedManifest, publishCatalog, rollbackManifest, sha256 } from './catalog.mjs';
const url = process.env.CATALOG_TEST_DATABASE_URL;
assert.ok(url && new URL(url).hostname === '127.0.0.1' && /^\/p1_01_catalog(?:_[a-z0-9]+)?$/.test(new URL(url).pathname), 'Use isolated p1_01_catalog loopback DB');
const db = new PrismaClient({ datasourceUrl: url });
const sourcePath = process.env.CATALOG_SOURCE_PATH;
const manifest = readManifest();
const operator = new PrismaClient({ datasourceUrl: url.replace('postgres@', 'p1_catalog_operator@') });
const unauthorized = new PrismaClient({ datasourceUrl: url.replace('postgres@', 'p1_catalog_unmapped@') });
const detailer = new PrismaClient({ datasourceUrl: url.replace('postgres@', 'p1_catalog_detailer@') });
const runtime = new PrismaClient({ datasourceUrl: url.replace('postgres@', 'zeus_app@') });
const adminId = '20000000-0000-4000-8000-000000000001', detailerId = '20000000-0000-4000-8000-000000000002';
test('P1-01 real PostgreSQL migration, source reconciliation, publication and legacy invariants', async (t) => {
    try {
        await t.test('migration preserves populated legacy booking and marks no invented modern snapshot', async () => {
            const b = await db.booking.findUniqueOrThrow({ where: { id: '10000000-0000-4000-8000-000000000003' } });
            assert.equal(b.priceSnapshot.toString(), '2070');
            assert.equal(b.durationMinutes, 60);
            assert.equal(b.requestHash, 'synthetic-legacy-hash');
            assert.equal(b.serviceNameSnapshot, 'Legacy service snapshot');
            assert.equal(b.snapshotVersion, 'LEGACY_V1');
            assert.equal(b.catalogReleaseId, null);
            assert.equal(await db.bookingLineItem.count({ where: { bookingId: b.id } }), 0);
        });
        let seeded;
        await t.test('draft seed reconciles all DB cells against the independent document parser', async () => {
            seeded = await seedCatalog(db, { sourcePath });
            const stored = await storedManifest(db, seeded.releaseId), expected = documentPrices(readFileSync(sourcePath, 'utf8'));
            assert.equal(stored.services.length, 21);
            assert.equal(await db.serviceSizeOffer.count({ where: { releaseId: seeded.releaseId } }), 105);
            for (const s of stored.services)
                assert.deepEqual(s.offers.map(o => o.state === 'NOT_OFFERED' ? 'N' : o.state === 'UNCONFIRMED' ? 'U' : o.unitPriceCentavos / 100), expected.get(s.sourceName));
            assert.equal(await db.catalogHead.count(), 0);
            assert.equal((await db.catalogRelease.findUnique({ where: { id: seeded.releaseId } })).state, 'DRAFT');
            assert.equal((await db.service.findUnique({ where: { slug: 'legacy-service' } })).isActive, true);
        });
        await t.test('identical seed is a no-op; changed version content and source are rejected', async () => {
            assert.equal((await seedCatalog(db, { sourcePath })).created, false);
            const changed = structuredClone(manifest);
            changed.services[0].name = 'Changed label';
            await assert.rejects(seedCatalog(db, { sourcePath, manifest: changed }), /Same version has different content/);
            await assert.rejects(seedCatalog(db, { sourcePath: new URL('./manifest.json', import.meta.url) }), /Source document hash changed/);
            const wrongPrice = rollbackManifest(manifest, 'wrong-price-test');
            wrongPrice.services[0].offers[0].unitPriceCentavos = 10100;
            await assert.rejects(seedCatalog(db, { sourcePath, manifest: wrongPrice }), /Reviewed source projection differs/);
        });
        await t.test('DB rejects invalid money, offer state, work plans and cross-release add-ons', async () => {
            const offer = manifest.services[0].offers[0];
            await assert.rejects(db.serviceSizeOffer.update({ where: { id: offer.id }, data: { unitPriceCentavos: -1 } }));
            await assert.rejects(db.serviceSizeOffer.update({ where: { id: offer.id }, data: { unitPriceCentavos: 100000001 } }));
            await assert.rejects(db.serviceSizeOffer.update({ where: { id: offer.id }, data: { unitPriceCentavos: null } }));
            await assert.rejects(db.serviceWorkPlan.update({ where: { offerId: offer.id }, data: { durationMinutes: null } }));
            await assert.rejects(db.serviceWorkPlan.update({ where: { offerId: offer.id }, data: { kind: 'UNKNOWN', durationMinutes: null } }));
            await assert.rejects(db.addOnCompatibility.create({ data: { releaseId: seeded.releaseId, baseServiceId: manifest.services[3].id, addOnServiceId: manifest.services[0].id, sizeCodes: ['S', 'M', 'L', 'XL'] } }));
            await assert.rejects(db.serviceSizeOffer.update({ where: { id: offer.id }, data: { sizeCode: 'S' } }));
        });
        // Cluster-local synthetic logins; owner provisions mappings, never an app client role.
        for (const role of ['p1_catalog_operator', 'p1_catalog_unmapped', 'p1_catalog_detailer', 'zeus_app']) {
            const rows = await db.$queryRaw `SELECT 1 FROM pg_roles WHERE rolname=${role}`;
            if (!rows.length)
                await db.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN`);
            await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
        }
        for (const role of ['p1_catalog_operator', 'p1_catalog_unmapped', 'p1_catalog_detailer'])
            await db.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION publish_catalog(text,text,text,text) TO ${role}`);
        for (const [id, role, email] of [[adminId, 'ADMIN', 'admin@synthetic.invalid'], [detailerId, 'DETAILER', 'detailer@synthetic.invalid']])
            await db.staff.upsert({ where: { id }, update: { role, isActive: true }, create: { id, name: 'Synthetic operator', phone: '+639000000002', email, role } });
        await db.catalogPublisher.upsert({ where: { databaseRole: 'p1_catalog_operator' }, update: { actorStaffId: adminId }, create: { databaseRole: 'p1_catalog_operator', actorStaffId: adminId } });
        await db.catalogPublisher.upsert({ where: { databaseRole: 'p1_catalog_detailer' }, update: { actorStaffId: detailerId }, create: { databaseRole: 'p1_catalog_detailer', actorStaffId: detailerId } });
        const args = { releaseId: seeded.releaseId, approvedManifestSha256: seeded.manifestSha256, reviewReference: 'synthetic-review/P1-01', reason: 'Synthetic local test' };
        await t.test('unmapped, inactive, DETAILER and runtime callers cannot publish or forge an ADMIN', async () => {
            await assert.rejects(publishCatalog(unauthorized, args), /mapped active ADMIN/);
            await assert.rejects(publishCatalog(detailer, args), /mapped active ADMIN/);
            await assert.rejects(publishCatalog(runtime, args), /permission denied/);
            await assert.rejects(runtime.$executeRaw `INSERT INTO catalog_publishers VALUES ('zeus_app',${adminId})`, /permission denied/);
            await db.staff.update({ where: { id: adminId }, data: { isActive: false } });
            await assert.rejects(publishCatalog(operator, args), /mapped active ADMIN/);
            await db.staff.update({ where: { id: adminId }, data: { isActive: true } });
            assert.equal(await db.catalogHead.count(), 0);
            assert.equal((await runtime.$queryRawUnsafe('SELECT count(*)::int AS n FROM service_size_offers'))[0].n, 105);
            await assert.rejects(runtime.$executeRawUnsafe('UPDATE service_size_offers SET "unitPriceCentavos"=1'), /permission denied/);
            await assert.rejects(runtime.$executeRawUnsafe('DELETE FROM catalog_head'), /permission denied/);
            await assert.rejects(runtime.$executeRawUnsafe('TRUNCATE catalog_publication_events'), /permission denied/);
            await assert.rejects(operator.$executeRawUnsafe('DELETE FROM catalog_publishers'), /permission denied/);
        });
        await t.test('wrong approved hash or tampered persisted content cannot publish', async () => {
            await assert.rejects(publishCatalog(operator, { ...args, approvedManifestSha256: '0'.repeat(64) }), /hash mismatch/);
            const offer = manifest.services[0].offers[0];
            await db.serviceSizeOffer.update({ where: { id: offer.id }, data: { unitPriceCentavos: 10100 } });
            await assert.rejects(publishCatalog(operator, args), /Manifest offer mismatch/);
            await db.serviceSizeOffer.update({ where: { id: offer.id }, data: { unitPriceCentavos: offer.unitPriceCentavos } });
        });
        await t.test('audit failure rolls back head/state, successful publication records trusted actor and hashes', async () => {
            await db.$executeRawUnsafe(`CREATE FUNCTION p1_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
            await db.$executeRawUnsafe('CREATE TRIGGER p1_fail_audit BEFORE INSERT ON catalog_publication_events FOR EACH ROW EXECUTE FUNCTION p1_fail_audit()');
            await assert.rejects(publishCatalog(operator, args), /synthetic audit failure/);
            assert.equal(await db.catalogHead.count(), 0);
            assert.equal((await db.catalogRelease.findUnique({ where: { id: seeded.releaseId } })).state, 'DRAFT');
            await db.$executeRawUnsafe('ALTER TABLE catalog_publication_events DISABLE TRIGGER p1_fail_audit');
            await publishCatalog(operator, args);
            const event = await db.catalogPublicationEvent.findFirstOrThrow();
            assert.equal(event.actorStaffId, adminId);
            assert.equal(event.databaseRole, 'p1_catalog_operator');
            assert.equal(event.manifestSha256, seeded.manifestSha256);
            assert.equal(event.sourceSha256, manifest.sourceSha256);
            assert.equal(event.previousReleaseId, null);
            assert.equal((await db.service.findUnique({ where: { slug: 'legacy-service' } })).isActive, false);
        });
        await t.test('published content and audit cannot be altered; legacy snapshots stay immutable', async () => {
            await assert.rejects(db.serviceSizeOffer.update({ where: { id: manifest.services[0].offers[0].id }, data: { unitPriceCentavos: 1 } }), /immutable/);
            await assert.rejects(db.vehicleCategory.update({ where: { id: manifest.sizes[0].id }, data: { name: 'tamper' } }), /immutable/);
            await assert.rejects(db.catalogRelease.update({ where: { id: seeded.releaseId }, data: { manifestSha256: '0'.repeat(64) } }), /immutable/);
            await assert.rejects(db.catalogPublicationEvent.updateMany({ data: { reason: 'tamper' } }), /append-only/);
            await assert.rejects(db.$executeRawUnsafe('TRUNCATE catalog_publication_events'), /append-only/);
            await assert.rejects(runtime.$executeRawUnsafe('ALTER TABLE catalog_publication_events DISABLE TRIGGER ALL'), /owner/);
            await assert.rejects(db.booking.update({ where: { id: '10000000-0000-4000-8000-000000000003' }, data: { priceSnapshot: 1 } }), /immutable/);
            assert.equal((await seedCatalog(db, { sourcePath })).created, false);
        });
        await t.test('new snapshots require exact atomic lines and cannot be repriced', async () => {
            const service = manifest.services[0], offer = service.offers[0];
            const booking = { id: '40000000-0000-4000-8000-000000000001', referenceCode: 'ZEUS-SYNTH002', customerName: 'Synthetic snapshot', customerPhone: '+639000000003', vehicleModel: 'Synthetic vehicle', vehicleCategoryId: offer.vehicleCategoryId, serviceId: service.id, bookingDate: new Date('2026-11-02T00:00:00Z'), startTime: '08:00', endTime: '08:30', startsAt: new Date('2026-11-02T00:00:00Z'), endsAt: new Date('2026-11-02T00:30:00Z'), durationMinutes: 30, priceSnapshot: 100, serviceNameSnapshot: service.name, vehicleCategoryNameSnapshot: manifest.sizes[0].name, idempotencyKey: '40000000-0000-4000-8000-000000000002', requestHash: 'synthetic-modern-hash', snapshotVersion: 'CATALOG_V2', catalogReleaseId: seeded.releaseId, vehicleSizeCodeSnapshot: 'MOTOR', catalogFingerprint: seeded.manifestSha256, pricingAlgorithm: 'php-service-size-v2' };
            const line = { order: 0, releaseId: seeded.releaseId, serviceId: service.id, vehicleCategoryId: offer.vehicleCategoryId, offerId: offer.id, type: 'BASE', nameSnapshot: service.name, unit: 'VEHICLE', quantity: 1, unitPriceCentavos: 10000, subtotalCentavos: 10000, addedMinutes: 30 };
            await assert.rejects(db.booking.create({ data: booking }), /Incomplete catalog snapshot totals/);
            await assert.rejects(db.booking.create({ data: { ...booking, lineItems: { create: { ...line, unitPriceCentavos: 9000, subtotalCentavos: 9000 } } } }));
            const row = await db.booking.create({ data: { ...booking, lineItems: { create: line } }, include: { lineItems: true } });
            assert.equal(row.lineItems.length, 1);
            assert.equal(row.priceSnapshot.toString(), '100');
            await assert.rejects(db.bookingLineItem.update({ where: { id: row.lineItems[0].id }, data: { nameSnapshot: 'tamper' } }), /append-only/);
            await assert.rejects(db.booking.update({ where: { id: row.id }, data: { durationMinutes: 60 } }), /immutable/);
        });
        await t.test('MANAGER maps to ADMIN; rollback is a new release and one head under competing publish', async () => {
            await db.staff.update({ where: { id: adminId }, data: { role: 'MANAGER' } });
            const rollback = rollbackManifest(manifest, 'client-2026-10-16-rollback-test');
            const next = await seedCatalog(db, { sourcePath, manifest: rollback });
            const outcomes = await Promise.allSettled([publishCatalog(operator, { ...args, releaseId: next.releaseId, approvedManifestSha256: next.manifestSha256, reason: 'ROLLBACK: synthetic prior reviewed manifest' }), publishCatalog(operator, { ...args, releaseId: next.releaseId, approvedManifestSha256: next.manifestSha256, reason: 'ROLLBACK: competing attempt' })]);
            assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(await db.catalogHead.count(), 1);
            assert.equal(await db.catalogRelease.count({ where: { state: 'PUBLISHED' } }), 1);
            assert.equal(await db.catalogPublicationEvent.count(), 2);
            const event = await db.catalogPublicationEvent.findFirst({ where: { releaseId: next.releaseId } });
            assert.equal(event.previousReleaseId, seeded.releaseId);
            assert.equal(event.previousManifestSha256, seeded.manifestSha256);
            assert.equal(event.action, 'ROLLBACK');
            assert.notEqual(next.manifestSha256, seeded.manifestSha256);
        });
    }
    finally {
        await Promise.all([db, operator, unauthorized, detailer, runtime].map(client => client.$disconnect()));
    }
});

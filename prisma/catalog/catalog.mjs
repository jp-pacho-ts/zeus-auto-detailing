import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
export const SIZES = ['MOTOR', 'S', 'M', 'L', 'XL'];
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value; }
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function stableId(key) {
    const bytes = createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex')).update('zeus.catalog.' + key).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    const h = bytes.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function requireLocalDatabase(url) {
    const parsed = new URL(url ?? '');
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.searchParams.has('host'))
        throw Error('P1-01 maintenance is local-only');
    return url;
}
export function validateManifest(m) {
    assert.match(m.version, /^[a-zA-Z0-9._-]{1,80}$/);
    assert.equal(m.sourcePath, 'docs/client/service-catalog.md');
    assert.match(m.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(m.sourceReceivedDate, '2026-10-16');
    assert.deepEqual(m.sizes.map(s => s.code), SIZES);
    assert.equal(m.services.length, 21);
    assert.equal(new Set(m.services.map(s => s.id)).size, 21);
    assert.equal(new Set(m.services.map(s => s.slug)).size, 21);
    const money = n => assert.ok(n === null || (Number.isSafeInteger(n) && n >= 0 && n <= 100000000));
    const ids = new Set();
    for (const s of m.services) {
        assert.equal(s.id, stableId('service.' + s.slug));
        assert.ok(['WASH', 'DETAILING', 'GRAPHENE', 'TINT', 'PPF', 'REPAINT'].includes(s.group));
        assert.ok(['BASE', 'ADD_ON'].includes(s.type));
        assert.ok(['VEHICLE', 'PANEL'].includes(s.unit));
        // ADR-005 §7: the queue is release data (a booking_queues code); publish_catalog checks it exists.
        assert.match(s.queueCode, /^[A-Z][A-Z0-9_]{0,31}$/);
        assert.equal(s.offers.length, 5);
        assert.deepEqual(s.offers.map(o => o.sizeCode), SIZES);
        money(s.referenceUnitPriceCentavos);
        for (const [i, o] of s.offers.entries()) {
            assert.ok(!ids.has(o.id));
            ids.add(o.id);
            assert.equal(o.vehicleCategoryId, m.sizes[i].id);
            assert.ok(['OFFERED', 'NOT_OFFERED', 'UNCONFIRMED'].includes(o.state));
            money(o.unitPriceCentavos);
            money(o.sourceCompareAtCentavos);
            assert.equal(o.compareAtCentavos, null);
            assert.equal(o.compareAtVerified, false);
            assert.equal(o.elapsedDays, null);
            assert.equal(o.bayHoldPolicy, 'UNCONFIRMED');
            if (o.state === 'NOT_OFFERED') {
                assert.equal(o.unitPriceCentavos, null);
                assert.equal(o.sourceCompareAtCentavos, null);
            }
            if (o.state === 'OFFERED')
                assert.notEqual(o.unitPriceCentavos, null);
            const minutes = ({ 'basic-wash': 30, 'signature-wash': 35, 'premium-wash': 45 })[s.slug];
            const fixed = o.state === 'OFFERED' && minutes !== undefined;
            assert.equal(o.bookingMode, fixed ? 'FIXED_ONLINE' : 'QUOTE_REQUIRED');
            assert.equal(o.durationKind, fixed ? 'TIMED' : 'UNKNOWN');
            assert.equal(o.durationMinutes, fixed ? minutes : null);
            if (fixed) {
                assert.equal(s.type, 'BASE');
                assert.equal(s.unit, 'VEHICLE');
            }
        }
    }
    assert.equal(m.compatibility.length, 6);
    const pairs = new Set();
    for (const pair of m.compatibility) {
        const base = m.services.find(s => s.id === pair.baseServiceId), add = m.services.find(s => s.id === pair.addOnServiceId);
        assert.ok(base && add && base.type === 'BASE' && base.group === 'WASH' && add.type === 'ADD_ON');
        assert.deepEqual(pair.sizeCodes, ['S', 'M', 'L', 'XL']);
        const key = pair.baseServiceId + pair.addOnServiceId;
        assert.ok(!pairs.has(key));
        pairs.add(key);
    }
    return m;
}
export function readManifest(file = new URL('./manifest.json', import.meta.url)) { return validateManifest(JSON.parse(readFileSync(file, 'utf8'))); }
export function rollbackManifest(original, version) {
    const m = structuredClone(original);
    m.version = version;
    for (const service of m.services)
        for (const offer of service.offers)
            offer.id = stableId('offer.' + version + '.' + service.slug + '.' + offer.sizeCode);
    return validateManifest(m);
}
/** @param {import("@prisma/client").PrismaClient} db @param {{manifest?: any, sourcePath?: string | URL}} options */
export async function seedCatalog(db, { manifest = readManifest(), sourcePath } = {}) {
    validateManifest(manifest);
    assert.ok(sourcePath, 'Source document path is required');
    assert.equal(sha256(readFileSync(sourcePath)), manifest.sourceSha256, 'Source document hash changed; review and version the manifest');
    const manifestJson = canonical(manifest), manifestSha256 = sha256(manifestJson), releaseId = stableId('release.' + manifest.version);
    return db.$transaction(async (tx) => {
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(746001,1)`;
        const existing = await tx.catalogRelease.findUnique({ where: { version: manifest.version } });
        if (existing) {
            assert.equal(existing.manifestSha256, manifestSha256, 'Same version has different content');
            await assertStoredManifest(tx, existing.id, manifest);
            return { releaseId: existing.id, manifestSha256, created: false };
        }
        // Current task seeds only the checked-in reviewed source projection. New source content
        // requires a reviewed manifest update; rollback may change version/offer IDs only.
        const reference = readManifest();
        const sourceProjection = m => ({ ...m, version: null, services: m.services.map(s => ({ ...s, offers: s.offers.map(o => ({ ...o, id: null })) })) });
        assert.equal(canonical(sourceProjection(manifest)), canonical(sourceProjection(reference)), 'Reviewed source projection differs');
        await tx.catalogRelease.create({ data: { id: releaseId, version: manifest.version, sourcePath: manifest.sourcePath, sourceReceivedDate: new Date(manifest.sourceReceivedDate + 'T00:00:00Z'), sourceSha256: manifest.sourceSha256, manifestSha256, manifestJson } });
        for (const size of manifest.sizes) {
            const old = await tx.vehicleCategory.findUnique({ where: { slug: size.code } });
            if (old)
                assert.equal(old.id, size.id, 'Size identity collision');
            else
                await tx.vehicleCategory.create({ data: { id: size.id, slug: size.code, name: size.name, sortOrder: size.sortOrder, sizeMultiplier: null } });
        }
        for (const service of manifest.services) {
            const old = await tx.service.findUnique({ where: { slug: service.slug } });
            if (old)
                assert.equal(old.id, service.id, 'Service identity collision');
            else
                await tx.service.create({ data: { id: service.id, slug: service.slug, name: service.name, category: ({ WASH: 'EXTERIOR_WASH_SEAL', DETAILING: 'INTERIOR_DETAILING', GRAPHENE: 'CERAMIC_COATING', TINT: 'WINDOW_TINT_PPF', PPF: 'WINDOW_TINT_PPF', REPAINT: 'PAINT_CORRECTION' })[service.group], price: null, durationMinutes: null, isActive: false } });
            const { id, offers, ...metadata } = service;
            await tx.catalogServiceVersion.create({ data: { releaseId, serviceId: id, ...metadata } });
            for (const offer of offers) {
                const { durationKind, durationMinutes, elapsedDays, bayHoldPolicy, ...data } = offer;
                await tx.serviceSizeOffer.create({ data: { ...data, releaseId, serviceId: id, workPlan: { create: { kind: durationKind, durationMinutes, elapsedDays, bayHoldPolicy } } } });
            }
        }
        for (const pair of manifest.compatibility)
            await tx.addOnCompatibility.create({ data: { releaseId, ...pair } });
        await assertStoredManifest(tx, releaseId, manifest);
        return { releaseId, manifestSha256, created: true };
    }, { timeout: 20000 });
}
export async function storedManifest(tx, releaseId) {
    const release = await tx.catalogRelease.findUniqueOrThrow({ where: { id: releaseId } });
    const versions = await tx.catalogServiceVersion.findMany({ where: { releaseId }, orderBy: { sortOrder: 'asc' }, include: { offers: { include: { workPlan: true } } } });
    const services = versions.map(({ releaseId: _, serviceId, offers, ...metadata }) => ({ id: serviceId, ...metadata, offers: SIZES.map(code => {
            const { releaseId: _r, serviceId: _s, promoStartsAt: _p, promoEndsAt: _e, workPlan, ...o } = offers.find(o => o.sizeCode === code) ?? {};
            assert.ok(workPlan, 'Missing offer or work plan');
            return { ...o, durationKind: workPlan.kind, durationMinutes: workPlan.durationMinutes, elapsedDays: workPlan.elapsedDays, bayHoldPolicy: workPlan.bayHoldPolicy };
        }) }));
    const sizes = await tx.vehicleCategory.findMany({ where: { id: { in: services[0].offers.map(o => o.vehicleCategoryId) } } });
    const compatibility = (await tx.addOnCompatibility.findMany({ where: { releaseId } })).map(({ releaseId: _, ...pair }) => pair).sort((a, b) => {
        const original = JSON.parse(release.manifestJson).compatibility;
        return original.findIndex(p => p.baseServiceId === a.baseServiceId && p.addOnServiceId === a.addOnServiceId) - original.findIndex(p => p.baseServiceId === b.baseServiceId && p.addOnServiceId === b.addOnServiceId);
    });
    return { version: release.version, sourcePath: release.sourcePath, sourceReceivedDate: release.sourceReceivedDate.toISOString().slice(0, 10), sourceSha256: release.sourceSha256, sizes: SIZES.map(code => { const s = sizes.find(s => s.slug === code); assert.ok(s); return { id: s.id, code, name: s.name, sortOrder: s.sortOrder }; }), services, compatibility };
}
export async function assertStoredManifest(tx, releaseId, manifest) { assert.equal(canonical(await storedManifest(tx, releaseId)), canonical(manifest), 'Stored catalog differs from approved manifest'); }
export async function publishCatalog(db, { releaseId, approvedManifestSha256, reviewReference, reason }) {
    assert.match(approvedManifestSha256, /^[a-f0-9]{64}$/);
    assert.ok(reviewReference?.trim() && reason?.trim());
    // Authority comes exclusively from the DB session identity. No caller-supplied role or actor.
    return db.$queryRaw `SELECT publish_catalog(${releaseId},${approvedManifestSha256},${reviewReference},${reason}) AS event_id`;
}

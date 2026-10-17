const assert = require('node:assert/strict');
const { test, after, before } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).hostname === '127.0.0.1' && /^\/p1_01_catalog(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL).pathname));
const db = new PrismaClient();
function load(relative) {
    const filename = path.resolve(relative);
    if (!process.env.CATALOG_GUARD_BASELINE)
        return require(filename);
    const source = execFileSync('git', ['show', '72f240a:' + relative], { encoding: 'utf8' });
    const m = new Module(filename, module);
    m.filename = filename;
    m.paths = Module._nodeModulePaths(path.dirname(filename));
    m._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
    return m.exports;
}
const { getBookingCatalog } = load('src/server/catalog.ts');
const { readAvailability } = load('src/server/availability-data.ts');
const singleton = require('../../src/server/db.ts');
before(async () => {
    await db.vehicleCategory.upsert({ where: { slug: 'SUV_CROSSOVER' }, update: { sizeMultiplier: null }, create: { id: '30000000-0000-4000-8000-000000000001', name: 'Synthetic null category', slug: 'SUV_CROSSOVER', sizeMultiplier: null, sortOrder: 9 } });
    for (const [id, slug, price] of [['30000000-0000-4000-8000-000000000002', 'synthetic-null-price', null], ['30000000-0000-4000-8000-000000000003', 'synthetic-valid-price', 100]])
        await db.service.upsert({ where: { slug }, update: { isActive: true, price }, create: { id, slug, name: 'Synthetic compatibility service', category: 'EXTERIOR_WASH_SEAL', durationMinutes: 60, price, isActive: true } });
    await db.scheduleConfig.upsert({ where: { effectiveDate: new Date('2026-01-01T00:00:00Z') }, update: {}, create: { effectiveDate: new Date('2026-01-01T00:00:00Z') } });
});
after(async () => { await db.$disconnect(); await singleton.prisma.$disconnect(); });
test('legacy catalog safely omits nullable compatibility rows', async () => {
    const result = await getBookingCatalog();
    assert.equal(result.ok, true);
    assert.ok(!result.data.vehicleCategories.some(c => c.code === 'SUV_CROSSOVER'));
    assert.ok(!result.data.services.some(s => s.slug === 'synthetic-null-price'));
});
test('availability fails closed for a nullable legacy multiplier', async () => {
    await assert.rejects(readAvailability(db, { date: '2026-11-02', vehicleCategoryId: '30000000-0000-4000-8000-000000000001', serviceId: '30000000-0000-4000-8000-000000000003' }, new Date('2026-10-17T00:00:00Z')), e => e.code === 'SCHEDULE_CONFLICT');
});
test('availability fails closed for a nullable legacy price', async () => {
    await assert.rejects(readAvailability(db, { date: '2026-11-02', vehicleCategoryId: '10000000-0000-4000-8000-000000000001', serviceId: '30000000-0000-4000-8000-000000000002' }, new Date('2026-10-17T00:00:00Z')), e => e.code === 'SCHEDULE_CONFLICT');
});

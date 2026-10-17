import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { documentPrices } from './document-reader.mjs';
test('manifest reproduces all 105 source price/state cells without multipliers or inferred prices', () => {
    const file = new URL('./manifest.json', import.meta.url);
    assert.ok(existsSync(file), 'P1-01 catalog manifest has not been implemented');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(process.env.CATALOG_SOURCE_PATH, 'Set CATALOG_SOURCE_PATH to the canonical client document');
    const source = readFileSync(process.env.CATALOG_SOURCE_PATH, 'utf8');
    const expected = documentPrices(source);
    assert.equal(manifest.sourceSha256, createHash('sha256').update(readFileSync(process.env.CATALOG_SOURCE_PATH)).digest('hex'));
    assert.deepEqual(manifest.sizes.map(size => size.code), ['MOTOR', 'S', 'M', 'L', 'XL']);
    assert.equal(expected.size, 21);
    assert.equal(manifest.services.length, 21);
    for (const service of manifest.services) {
        assert.ok(expected.has(service.sourceName), service.sourceName);
        assert.deepEqual(service.offers.map(offer => offer.state === 'NOT_OFFERED' ? 'N' : offer.state === 'UNCONFIRMED' ? 'U' : offer.unitPriceCentavos / 100), expected.get(service.sourceName));
        for (const offer of service.offers) {
            assert.equal(offer.compareAtCentavos, null);
            assert.equal(offer.bookingMode, service.group === 'WASH' && service.type === 'BASE' && offer.state === 'OFFERED' ? 'FIXED_ONLINE' : 'QUOTE_REQUIRED');
            assert.equal(offer.durationMinutes, offer.bookingMode === 'FIXED_ONLINE' ? ({ 'basic-wash': 30, 'signature-wash': 35, 'premium-wash': 45 })[service.slug] : null);
        }
    }
    assert.equal(manifest.services.find(s => s.slug === 'panel-repaint').referenceUnitPriceCentavos, 350000);
    assert.equal(manifest.services.find(s => s.slug === 'arcane-graphene').offers[1].unitPriceCentavos, 1310000);
    assert.equal(manifest.services.find(s => s.slug === 'arcane-graphene').offers[1].sourceCompareAtCentavos, 2883300);
});

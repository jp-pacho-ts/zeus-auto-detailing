/* eslint-disable @typescript-eslint/no-require-imports */
// P1-55 real-browser check: the Back button is as tall as Continue (and Submit) on steps 2 to 4, at laptop, desktop and phone sizes.
// Catalog, quote and days are stubbed in the browser; Cloudflare is stubbed too. Loopback app only; never loads .env.
// Optional: P155_SHOTS (screenshot folder), P155_REPORT (JSON file with the measured heights).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
// The real catalog's size names and a one-line description for each: long names are what made the bands tall.
const sizes = [
  ['MOTOR', 'Motor / Motorcycle', 'Scooters and motorcycles'],
  ['S', 'Small · Compact / Sedan', 'Hatchbacks and small sedans'],
  ['M', 'Medium · Compact SUV / Crossover', 'Compact SUVs and crossovers'],
  ['L', 'Large · Midsize SUV / Pick-up', 'Midsize SUVs and pick-ups'],
  ['XL', 'X-Large · Fullsize SUV / Pick-up / Van', 'Fullsize SUVs, pick-ups and vans, such as crew-cab trucks and three-row family vehicles'],
];
const vehicleCategories = sizes.map(([code, name, description], i) => ({ id: id(100 + i), code, name, description, sortOrder: i }));
const offer = (sid, vi, price) => ({ id: id(5000 + sid * 10 + vi), vehicleCategoryId: id(100 + vi), duration: { kind: 'TIMED', minutes: 90 }, onlineBooking: 'PRICED', state: 'OFFERED', bookingMode: 'FIXED_ONLINE', unitPriceCentavos: price + vi * 15000, compareAtCentavos: null });
const svc = (n, name, type, base, description) => ({ id: id(n), slug: name.toLowerCase().replace(/\W+/g, '-'), name, description, category: 'WASH', type, unit: 'VEHICLE', inclusions: [], productName: null, hardness: null, warrantyMonths: null, referenceUnitPriceCentavos: null, offers: [0, 1, 2, 3, 4].map((vi) => offer(n, vi, base)) });
const catalog = { catalogReleaseId: id(1), catalogVersion: 'synthetic', vehicleCategories, services: [svc(1, 'Basic Wash', 'BASE', 25000, 'Exterior hand wash, dry and tire shine.'), svc(2, 'Engine Bay Wash', 'ADD_ON', 30000, 'Degrease and dress the engine bay.')], addOnCompatibility: [{ baseServiceId: id(1), addOnServiceId: id(2) }] };
const quoteFor = (vid, lineIds) => {
  const vi = vehicleCategories.findIndex((v) => v.id === vid);
  const lines = lineIds.map((sid) => { const s = catalog.services.find((x) => x.id === sid); const o = s.offers[vi]; return { serviceId: s.id, offerId: o.id, kind: s.type, name: s.name, unit: 'VEHICLE', quantity: 1, priceStatus: 'PRICED', unitPriceCentavos: o.unitPriceCentavos, subtotalCentavos: o.unitPriceCentavos, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null }; });
  const total = lines.reduce((a, l) => a + l.subtotalCentavos, 0), issued = new Date().toISOString();
  return { version: 3, catalogReleaseId: id(1), catalogFingerprint: 'a'.repeat(64), pricingAlgorithm: 'php-service-size-v3', vehicleCategoryId: vid, primaryServiceId: lines[0].serviceId, queueId: 'WASH', lines, totalPriceCentavos: total, estimatedTotalCentavos: total, currency: 'PHP', issuedAt: issued, expiresAt: new Date(Date.parse(issued) + 900000).toISOString(), quoteToken: 'synthetic' };
};

async function open(browser, origin, upstream, [width, height]) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route('**/*', async (route) => {
    const request = route.request(), u = request.url(), p = new URL(u).pathname, q = new URL(u).searchParams;
    if (u.startsWith('https://challenges.cloudflare.com/')) return route.fulfill({ contentType: 'text/javascript', body: "window.turnstile={render(el,o){const b=document.createElement('div');b.style.cssText='width:300px;height:65px;border:1px solid #555;background:#222';el.appendChild(b);setTimeout(()=>o.callback('synthetic-'+Math.random()),30);return 'w'+Math.random()},remove(){}};" });
    if (!u.startsWith(origin + '/')) return route.abort();
    const json = (b, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    const lineIds = () => (q.get('lines') || '').split(',').filter(Boolean).map((x) => x.split(':')[0]);
    if (p === '/api/catalog') return json({ ok: true, data: catalog });
    if (p === '/api/bookings/quote') return json({ ok: true, data: { quote: quoteFor(q.get('vehicleCategoryId'), lineIds()) } });
    if (p === '/api/availability') {
      const from = q.get('fromDate'), days = [];
      for (let i = 0; i < 14; i++) days.push({ date: new Date(new Date(from + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10), state: i === 2 ? 'FULLY_BOOKED' : 'AVAILABLE' });
      return json({ ok: true, data: { timezone: 'Asia/Manila', days, nextAvailableDay: days[0].date, searchedThrough: days[13].date, generatedAt: new Date().toISOString(), quote: quoteFor(q.get('vehicleCategoryId'), lineIds()), onlineBookingStatus: 'OPEN' } });
    }
    const response = await route.fetch({ url: u.replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.153' } });
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  await page.goto(origin + '/book', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Choose your vehicle size' }).waitFor();
  await page.locator('input[name="vehicle-category"]').first().waitFor({ state: 'attached' }); // the catalog has loaded
  return { context, page };
}


// P1-55: Back and the main action (Continue, then Submit) are the same height wherever they appear.
const SIZES = [[1366, 650], [1280, 600], [1920, 940], [320, 568], [390, 844], [844, 390]];
test('Back is as tall as Continue on steps 2, 3 and 4 at laptop, desktop and phone sizes', { timeout: 280000 }, async () => {
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const report = [], failures = [];
  const shot = async (page, name) => { if (process.env.P155_SHOTS) await page.screenshot({ path: path.join(process.env.P155_SHOTS, name + '.png') }); };
  try {
    for (const [width, height] of SIZES) {
      const key = `${width}x${height}`;
      const { context, page } = await open(browser, origin, upstream, [width, height]);
      const pair = async (label) => {
        const back = await page.getByRole('button', { name: 'Back', exact: true }).filter({ visible: true }).first().boundingBox();
        const main = await page.getByRole('button', { name: /^(Continue|Submit booking request)$/ }).filter({ visible: true }).first().boundingBox();
        report.push({ viewport: key, step: label, backHeight: back && +back.height.toFixed(2), actionHeight: main && +main.height.toFixed(2) });
        if (!back || !main || Math.abs(back.height - main.height) > 1) failures.push(`${key} ${label}: Back is ${back && back.height}px, the action is ${main && main.height}px`);
      };
      const next = () => page.getByRole('button', { name: 'Continue', exact: true }).filter({ visible: true }).first().click();
      await page.getByLabel(/^Small/).check();
      await next();
      await page.getByRole('heading', { name: 'Choose your services' }).waitFor();
      await page.getByRole('button', { name: /Premium Carwash/ }).click();
      await page.getByLabel(/^Basic Wash/).check();
      await page.waitForTimeout(500);
      await pair('step 2'); await shot(page, `p155-step2-${key}`);
      await next();
      await page.getByRole('heading', { name: 'Choose your day' }).waitFor();
      await page.locator('input[name="booking-day"]:not([disabled])').first().waitFor({ state: 'attached', timeout: 30000 });
      await page.locator('input[name="booking-day"]:not([disabled])').nth(1).check({ force: true });
      await pair('step 3'); await shot(page, `p155-step3-${key}`);
      await next();
      await page.getByRole('heading', { name: 'Your details' }).waitFor();
      await page.waitForTimeout(500);
      await pair('step 4'); await shot(page, `p155-step4-${key}`);
      await context.close();
    }
  } finally {
    await browser.close();
    if (process.env.P155_REPORT) fs.writeFileSync(process.env.P155_REPORT, JSON.stringify({ report, failures }, null, 1));
  }
  assert.deepEqual(failures, [], failures.join(' | '));
});

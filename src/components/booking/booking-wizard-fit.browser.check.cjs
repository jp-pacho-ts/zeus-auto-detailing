/* eslint-disable @typescript-eslint/no-require-imports */
// P1-53 real-browser check that the booking wizard fits the SCREEN, not only the width: on laptop and desktop viewports step 1
// (five size bands, the real long catalog names) shows fully with no document scroll and Continue in view; the side panel never
// needs its own scroll; the step title and the empty "Choose a size" total are in the calmer type ranges; steps 2 to 4 keep the
// panel fixed and whole. On phones (portrait and landscape) nothing is cut off and the bottom bar never covers the last band.
// Catalog, quote, days and create are stubbed in the browser; Cloudflare is stubbed too. Loopback app only; never loads .env.
// Optional: P153_SHOTS (screenshot folder), P153_REPORT (a JSON file that receives the measured numbers).
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

// Laptop and desktop sizes the LE and his customers use (width x visible height), then phones.
const DESKTOP = [[1366, 650], [1280, 600], [1440, 780], [1536, 730], [1920, 940], [1907, 916]];
const PHONES = [[320, 568], [390, 844], [430, 932], [844, 390], [932, 430]];
const DEEP = new Set(['1366x650', '1280x600', '1920x940']); // steps 2 to 4 are checked at these

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
  return { context, page };
}

const inView = (box, h, w) => box && box.y >= -0.5 && box.y + box.height <= h + 0.5 && box.x >= -0.5 && box.x + box.width <= w + 0.5;

test('the booking wizard fits the screen by height: bands, panel and type on laptops, desktops and phones', { timeout: 280_000 }, async () => {
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const shot = async (page, name) => { if (process.env.P153_SHOTS) await page.screenshot({ path: path.join(process.env.P153_SHOTS, name + '.png') }); };
  const report = [];
  const failures = [];
  const expect = (label, ok, detail) => { if (!ok) failures.push(`${label}: ${detail}`); };
  try {
    for (const [width, height] of DESKTOP) {
      const key = `${width}x${height}`;
      const { context, page } = await open(browser, origin, upstream, [width, height]);
      const m = await page.evaluate(() => {
        const bands = [...document.querySelectorAll('label:has(input[name="vehicle-category"])')].map((e) => { const r = e.getBoundingClientRect(); return { y: r.y, height: r.height, bottom: r.y + r.height, left: r.left, right: r.right }; });
        const mainRect = document.querySelector('main').getBoundingClientRect();
        const panel = document.querySelector('[data-part=panel]');
        const total = [...panel.querySelectorAll('p')].find((p) => p.textContent.trim() === 'Choose a size');
        return { docScroll: document.scrollingElement.scrollHeight - innerHeight, bands, panelOver: panel.scrollHeight - panel.clientHeight, panelHeight: panel.clientHeight, mainWidth: mainRect.width, mainLeft: mainRect.left, title: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize), emptyTotal: total ? parseFloat(getComputedStyle(total).fontSize) : null, innerHeight };
      });
      const cont = await page.getByRole('button', { name: 'Continue', exact: true }).first().boundingBox();
      const tilesLeft = Math.min(...m.bands.map((b) => b.left)), tilesRight = Math.max(...m.bands.map((b) => b.right)), above = m.bands[0].y, below = m.innerHeight - m.bands.at(-1).bottom;
      const row = { viewport: key, step1: { tilesWidth: Math.round(tilesRight - tilesLeft), emptyLeftInMain: Math.round(tilesLeft - m.mainLeft), emptyRightInMain: Math.round(m.mainLeft + m.mainWidth - tilesRight), emptyAbove: Math.round(above), emptyBelow: Math.round(below), docScrollOverflowPx: m.docScroll, bandHeights: m.bands.map((b) => Math.round(b.height)), lastBandBottom: Math.round(m.bands.at(-1).bottom), panelOverflowPx: m.panelOver, panelHeight: m.panelHeight, titlePx: m.title, emptyTotalPx: m.emptyTotal, continueBottom: cont && Math.round(cont.y + cont.height) } };
      expect(key + ' step 1', m.bands.length === 5, 'five bands');
      expect(key + ' no document scroll', m.docScroll <= 1, `the page scrolls by ${m.docScroll}px`);
      expect(key + ' bands fully visible', m.bands.every((b) => b.y >= 0 && b.bottom <= m.innerHeight), `the last band ends at ${Math.round(m.bands.at(-1).bottom)} of ${m.innerHeight}`);
      expect(key + ' tile height', m.bands.every((b) => b.height <= 300), `tiles are ${m.bands.map((b) => Math.round(b.height))} px tall`);
      // P1-54: the size choices use the width of the right area (no narrow column with empty sides) and sit balanced between top and bottom.
      expect(key + ' fills the width', tilesRight - tilesLeft >= Math.min(1000, m.mainWidth - 112), `the choices are ${Math.round(tilesRight - tilesLeft)} px wide in a ${Math.round(m.mainWidth)} px area`);
      expect(key + ' left and right balanced', Math.abs((tilesLeft - m.mainLeft) - (m.mainLeft + m.mainWidth - tilesRight)) <= 2, `left gap ${Math.round(tilesLeft - m.mainLeft)}, right gap ${Math.round(m.mainLeft + m.mainWidth - tilesRight)}`);
      expect(key + ' top and bottom balanced', Math.abs(above - below) <= 40, `${Math.round(above)} px above, ${Math.round(below)} px below the choices`);
      expect(key + ' Continue in view', inView(cont, m.innerHeight, width), `Continue box ${JSON.stringify(cont)}`);
      expect(key + ' panel needs no scroll', m.panelOver <= 1, `the panel overflows by ${m.panelOver}px`);
      expect(key + ' title size', m.title >= 27 && m.title <= 33, `the step title is ${m.title}px`);
      expect(key + ' empty total size', m.emptyTotal !== null && m.emptyTotal >= 14 && m.emptyTotal <= 16, `the empty total is ${m.emptyTotal}px`);
      await shot(page, `p153-1-size-${key}`);
      if (DEEP.has(key)) {
        // Steps 2 to 4: the panel stays fixed and whole while the right side scrolls.
        await page.getByLabel(/^Small/).check();
        await page.getByRole('button', { name: 'Continue', exact: true }).first().click();
        await page.getByRole('heading', { name: 'Choose your services' }).waitFor();
        await page.getByRole('button', { name: /Premium Carwash/ }).click();
        await page.getByLabel(/^Basic Wash/).check();
        await page.getByLabel(/Engine Bay Wash/).check();
        await page.waitForTimeout(600);
        const steps = [];
        const panelState = async (label) => {
          const s = await page.evaluate(() => { const panel = document.querySelector('[data-part=panel]'); window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: 'instant' }); const r = panel.getBoundingClientRect(); const money = [...panel.querySelectorAll('p')].find((p) => /^₱/.test(p.textContent.trim())); return { over: panel.scrollHeight - panel.clientHeight, top: r.top, bottom: r.bottom, price: money ? parseFloat(getComputedStyle(money).fontSize) : null, innerHeight }; });
          const primary = await page.getByRole('button', { name: /^(Continue|Submit booking request)$/ }).filter({ visible: true }).first().boundingBox();
          steps.push({ step: label, panelOverflowPx: s.over, panelTopAfterScroll: Math.round(s.top), pricePx: s.price, primaryBottom: primary && Math.round(primary.y + primary.height) });
          expect(`${key} ${label} panel whole`, s.over <= 1, `the panel overflows by ${s.over}px`);
          expect(`${key} ${label} panel fixed`, Math.abs(s.top) <= 1 && s.bottom <= s.innerHeight + 1, `the panel top is ${s.top} after scrolling`);
          expect(`${key} ${label} action in view`, inView(primary, s.innerHeight, width), `action box ${JSON.stringify(primary)}`);
          expect(`${key} ${label} price size`, s.price !== null && s.price >= 27 && s.price <= 33, `the total is ${s.price}px`);
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        };
        await panelState('step 2');
        await shot(page, `p153-2-services-${key}`);
        await page.getByRole('button', { name: 'Continue', exact: true }).first().click();
        await page.getByRole('heading', { name: 'Choose your day' }).waitFor();
        await page.locator('input[name="booking-day"]:not([disabled])').first().waitFor({ state: 'attached', timeout: 30_000 });
        await page.locator('input[name="booking-day"]:not([disabled])').nth(1).check({ force: true });
        await panelState('step 3');
        await shot(page, `p153-3-day-${key}`);
        await page.getByRole('button', { name: 'Continue', exact: true }).first().click();
        await page.getByRole('heading', { name: 'Your details' }).waitFor();
        await page.waitForTimeout(500);
        await panelState('step 4');
        // The details form uses two columns on desktop: About you beside Your vehicle.
        const cols = await page.evaluate(() => { const a = document.querySelector('#customerFirstName').getBoundingClientRect(), b = document.querySelector('#vehicleModel').getBoundingClientRect(); return { sameRow: Math.abs(a.top - b.top) < 24, right: b.left > a.right - 1 }; });
        expect(`${key} step 4 two columns`, cols.sameRow && cols.right, `first name and vehicle model are not side by side: ${JSON.stringify(cols)}`);
        await shot(page, `p153-4-details-${key}`);
        row.deep = steps;
      }
      report.push(row);
      await context.close();
    }
    for (const [width, height] of PHONES) {
      const key = `${width}x${height}`;
      const { context, page } = await open(browser, origin, upstream, [width, height]);
      const m = await page.evaluate(() => {
        window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: 'instant' });
        const bands = [...document.querySelectorAll('label:has(input[name="vehicle-category"])')];
        const last = bands.at(-1).getBoundingClientRect();
        const bar = document.getElementById('wizard-action-bar').getBoundingClientRect();
        const small = [...document.querySelectorAll('main p, main span, [data-part=panel] p')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12; }).length;
        return { lastBottom: last.bottom, barTop: bar.top, sideways: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth, small, innerHeight };
      });
      const cont = await page.getByRole('button', { name: 'Continue', exact: true }).filter({ visible: true }).first().boundingBox();
      report.push({ viewport: key, phone: { lastBandBottom: Math.round(m.lastBottom), barTop: Math.round(m.barTop), continueTouchHeight: cont && Math.round(cont.height) } });
      expect(key + ' last band clear of the bar', m.lastBottom <= m.barTop + 1, `the last band ends at ${Math.round(m.lastBottom)}, the bar starts at ${Math.round(m.barTop)}`);
      expect(key + ' Continue in view', inView(cont, m.innerHeight, width) && cont.height >= 44, `Continue box ${JSON.stringify(cont)}`);
      expect(key + ' no sideways scroll', !m.sideways, 'sideways scroll');
      expect(key + ' no tiny text', m.small === 0, `${m.small} text elements under 12px`);
      await shot(page, `p153-phone-${key}`);
      await context.close();
    }
  } finally {
    await browser.close();
    if (process.env.P153_REPORT) fs.writeFileSync(process.env.P153_REPORT, JSON.stringify({ report, failures }, null, 1));
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

/* eslint-disable @typescript-eslint/no-require-imports */
// P1-52 real-browser check of the booking wizard's Showroom layout at 390, 1280 and 1907 (and no sideways scroll at 320): the side
// panel and its progress (list on desktop, segmented bar on phones), one submit on the details step with the review under the
// fields, the month calendar, the Manage booking corner family (no 4 px corners) and the ticket confirmation with its dashed
// tear-off edge, its notches and a clean print view. Catalog, quote, days and create are stubbed in the browser; the Cloudflare
// script is stubbed too. Loopback app only; never loads .env. Optional P152_SHOTS: a screenshot folder.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const sizes = [['S', 'Small', 'Hatchbacks and small sedans'], ['L', 'Large', 'SUVs and pickups']];
const vehicleCategories = sizes.map(([code, name, description], i) => ({ id: id(100 + i), code, name, description, sortOrder: i }));
const offer = (sid, vi, price) => ({ id: id(5000 + sid * 10 + vi), vehicleCategoryId: id(100 + vi), duration: { kind: 'TIMED', minutes: 90 }, onlineBooking: 'PRICED', state: 'OFFERED', bookingMode: 'FIXED_ONLINE', unitPriceCentavos: price + vi * 15000, compareAtCentavos: null });
const svc = (n, name, type, base, description) => ({ id: id(n), slug: name.toLowerCase().replace(/\W+/g, '-'), name, description, category: 'WASH', type, unit: 'VEHICLE', inclusions: [], productName: null, hardness: null, warrantyMonths: null, referenceUnitPriceCentavos: null, offers: [0, 1].map((vi) => offer(n, vi, base)) });
const catalog = { catalogReleaseId: id(1), catalogVersion: 'synthetic', vehicleCategories, services: [svc(1, 'Basic Wash', 'BASE', 25000, 'Exterior hand wash, dry and tire shine.'), svc(2, 'Engine Bay Wash', 'ADD_ON', 30000, 'Degrease and dress the engine bay.')], addOnCompatibility: [{ baseServiceId: id(1), addOnServiceId: id(2) }] };
const quoteFor = (vid, lineIds) => {
  const vi = vehicleCategories.findIndex((v) => v.id === vid);
  const lines = lineIds.map((sid) => { const s = catalog.services.find((x) => x.id === sid); const o = s.offers[vi]; return { serviceId: s.id, offerId: o.id, kind: s.type, name: s.name, unit: 'VEHICLE', quantity: 1, priceStatus: 'PRICED', unitPriceCentavos: o.unitPriceCentavos, subtotalCentavos: o.unitPriceCentavos, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null }; });
  const total = lines.reduce((a, l) => a + l.subtotalCentavos, 0), issued = new Date().toISOString();
  return { version: 3, catalogReleaseId: id(1), catalogFingerprint: 'a'.repeat(64), pricingAlgorithm: 'php-service-size-v3', vehicleCategoryId: vid, primaryServiceId: lines[0].serviceId, queueId: 'WASH', lines, totalPriceCentavos: total, estimatedTotalCentavos: total, currency: 'PHP', issuedAt: issued, expiresAt: new Date(Date.parse(issued) + 900000).toISOString(), quoteToken: 'synthetic' };
};

test('the booking wizard: side panel, one submit, calendar, rounded corners and the ticket confirmation', { timeout: 280_000 }, async () => {
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const errors = [];
  const shot = async (page, name) => { if (process.env.P152_SHOTS) await page.screenshot({ path: path.join(process.env.P152_SHOTS, name + '.png'), fullPage: true }); };
  try {
    for (const width of [320, 390, 1280, 1907]) {
      const desktop = width >= 1024;
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
      const creates = [];
      await context.route('**/*', async (route) => {
        const request = route.request(), u = request.url(), p = new URL(u).pathname, q = new URL(u).searchParams;
        if (u.startsWith('https://challenges.cloudflare.com/')) return route.fulfill({ contentType: 'text/javascript', body: "window.turnstile={render(el,o){const b=document.createElement('div');b.style.cssText=(o.size==='compact'?'width:150px;height:140px':'width:300px;height:65px')+';border:1px solid #555;background:#222';el.appendChild(b);setTimeout(()=>o.callback('synthetic-'+Math.random()),30);return 'w'+Math.random()},remove(){}};" });
        if (!u.startsWith(origin + '/')) return route.abort();
        const json = (b, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
        const lineIds = () => (q.get('lines') || '').split(',').filter(Boolean).map((x) => x.split(':')[0]);
        if (p === '/api/catalog') return json({ ok: true, data: catalog });
        if (p === '/api/bookings/quote') return json({ ok: true, data: { quote: quoteFor(q.get('vehicleCategoryId'), lineIds()) } });
        if (p === '/api/availability') {
          const from = q.get('fromDate'), days = [];
          for (let i = 0; i < 14; i++) days.push({ date: new Date(new Date(from + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10), state: i === 2 ? 'FULLY_BOOKED' : i === 5 ? 'CLOSED' : 'AVAILABLE' });
          return json({ ok: true, data: { timezone: 'Asia/Manila', days, nextAvailableDay: days.find((d) => d.state === 'AVAILABLE').date, searchedThrough: days[13].date, generatedAt: new Date().toISOString(), quote: quoteFor(q.get('vehicleCategoryId'), lineIds()), onlineBookingStatus: 'OPEN' } });
        }
        if (p === '/api/bookings' && request.method() === 'POST') {
          const b = JSON.parse(request.postData() || '{}'); creates.push(b);
          return json({ ok: true, data: { booking: { id: id(900), referenceCode: 'ZEUS-K7M4QX', status: 'PENDING', revision: 1, bookingDate: b.bookingDate, timezone: 'Asia/Manila', vehicleCategoryId: b.vehicleCategoryId, vehicleCategoryName: 'Small', lines: b.acceptedQuote.lines.map((l) => ({ serviceId: l.serviceId, name: l.name, quantity: 1, priceStatus: 'PRICED', subtotalCentavos: l.subtotalCentavos, referenceSubtotalCentavos: null })), totalPriceCentavos: b.acceptedQuote.totalPriceCentavos, estimatedTotalCentavos: b.acceptedQuote.estimatedTotalCentavos, currency: 'PHP' }, managementAccess: null, commitState: 'COMMITTED', replayed: false } });
        }
        const response = await route.fetch({ url: u.replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.152' } });
        await route.fulfill({ response });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      const noSideways = async (label) => assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth), true, `${width}px ${label}: no sideways scroll`);
      const cont = () => page.getByRole('button', { name: 'Continue', exact: true }).first();
      await page.goto(origin + '/book', { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Choose your vehicle size' }).waitFor();

      // The panel: logo, step, one h1; list of steps on desktop, segmented bar on phones; never both.
      assert.equal(await page.locator('h1').count(), 1, `${width}px one page heading`);
      assert.match(await page.locator('[data-part=panel]').innerText(), /Step 1 of 4/);
      assert.equal(await page.getByRole('list', { name: 'Progress steps' }).isVisible(), desktop, `${width}px step list shows on desktop only`);
      assert.equal(await page.getByRole('progressbar', { name: 'Booking progress' }).isVisible(), !desktop, `${width}px segmented bar shows on phones only`);
      if (desktop) assert.equal(await page.locator('[data-part=panel]').evaluate((e) => getComputedStyle(e).position), 'sticky', 'the panel stays in view');
      const bar = await page.locator('#wizard-action-bar').isVisible();
      assert.equal(bar, !desktop, `${width}px the bottom bar is a phone thing`);
      await noSideways('step 1');
      // Bands: one drawing per size, a 12 px radius.
      assert.equal(await page.locator('label:has(input[name="vehicle-category"]) svg').count(), 2);
      const bandRadius = await page.locator('label:has(input[name="vehicle-category"])').first().evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
      assert.ok(bandRadius >= 11.5 && bandRadius <= 13, `${width}px bands are 12 px rounded, got ${bandRadius}`);
      // Gold extruded icons: one gradient on the page, eight layers per icon, decorative, big enough to read.
      assert.equal(await page.locator('#zeus-gold-3d').count(), 1, 'the gold gradient is defined once');
      assert.equal(await page.locator('[id]').evaluateAll((els) => els.length - new Set(els.map((e) => e.id)).size), 0, 'no duplicate ids on the page');
      for (const mark of await page.locator('[data-part=vehicle-mark] svg').all()) {
        assert.equal(await mark.getAttribute('aria-hidden'), 'true');
        assert.equal(await mark.locator('path').count(), 8);
        const box = await mark.boundingBox();
        assert.ok(box.width >= 40 && box.height >= 40, `${width}px the icon is at least 40 px (got ${Math.round(box.width)})`); // P1-53: 40 on short laptop screens (52 px tile), 44 and up elsewhere
      }
      await shot(page, `p152-1-size-empty-${width}`);
      await page.getByLabel(/^Small/).check();
      await shot(page, `p152-1-size-${width}`);
      await cont().click();
      await page.getByRole('heading', { name: 'Choose your services' }).waitFor();
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'wizard-step-title', 'focus moves to the step heading');
      await page.getByRole('button', { name: /Premium Carwash/ }).click();
      await page.getByLabel(/^Basic Wash/).check();
      await page.getByLabel(/Engine Bay Wash/).check();
      await page.waitForTimeout(500);
      await noSideways('step 2');
      if (desktop) {
        assert.match(await page.locator('[data-part=panel]').innerText(), /₱550.00/, 'the big total is in the panel');
        assert.ok((await page.getByRole('button', { name: 'Change vehicle size' }).filter({ visible: true }).count()) === 1, 'a Change for the finished step');
      }
      await shot(page, `p152-2-services-${width}`);
      await cont().click();
      await page.getByRole('heading', { name: 'Choose your day' }).waitFor();
      await page.locator('input[name="booking-day"]').first().waitFor({ state: 'attached', timeout: 30_000 });
      // The month calendar: seven weekday heads, fourteen days, a Chosen mark on the picked one (words from 640 px).
      assert.equal(await page.locator('#booking-days input[name="booking-day"]').count(), 14);
      assert.equal(await page.locator('#booking-days [aria-hidden=true] > span').filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ }).count(), 7);
      await page.locator('input[name="booking-day"]:not([disabled])').nth(1).check({ force: true });
      if (width >= 640) assert.equal(await page.locator('#booking-days').getByText('Chosen', { exact: true }).isVisible(), true);
      await noSideways('step 3');
      const radii = async (locators) => { for (const [name, loc] of locators) { const r = await loc.first().evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius)); assert.ok(r >= 10 && r <= 14, `${width}px ${name} is 12 px rounded, not a pill (got ${r})`); } };
      await radii([['Back', page.getByRole('button', { name: 'Back' }).filter({ visible: true })], ['Earlier days', page.getByRole('button', { name: 'Earlier days' })], ['Later days', page.getByRole('button', { name: 'Later days' })], ['Continue', cont()]]);
      await shot(page, `p152-3-day-${width}`);
      await cont().click();
      await page.getByRole('heading', { name: 'Your details' }).waitFor();

      // One form, one submit: the review sits under the fields, the security check under the review.
      assert.equal(await page.locator('form').count(), 1, `${width}px one form`);
      assert.equal(await page.getByRole('button', { name: 'Submit booking request' }).filter({ visible: true }).count(), 1, `${width}px one visible Submit`);
      assert.equal(await page.locator('form [data-part=review]').count(), 1, 'the review is inside the details step');
      const order = await page.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return [y('#customerFirstName'), y('#vehicleModel'), y('[data-part=review]'), y('#turnstileToken')]; });
      assert.deepEqual([...order].sort((a, b) => a - b), order, `${width}px fields, then review, then security check`);
      assert.deepEqual(await page.locator('form h2').allInnerTexts(), ['About you', 'Your vehicle', 'Check your booking']);
      const a = await page.locator('#customerFirstName').boundingBox(), b = await page.locator('#customerLastName').boundingBox();
      if (width >= 640) assert.ok(Math.abs(a.y - b.y) < 4 && b.x > a.x, `${width}px the two names sit side by side`);
      else assert.ok(b.y > a.y + a.height - 1, `${width}px the two names stack`);
      await noSideways('step 4');

      // The Manage booking corner family: nothing a customer can press or type into has a 4 px corner.
      const sharp = await page.evaluate(() => [...document.querySelectorAll('button, a[href], select, textarea, input:not([type=radio]):not([type=checkbox])')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0' && !e.closest('[hidden]'); })
        .map((e) => [e, parseFloat(getComputedStyle(e).borderTopLeftRadius)]).filter(([, r]) => r > 0.5 && r < 9).map(([e, r]) => e.tagName + ' ' + (e.id || e.textContent.trim().slice(0, 20)) + ' ' + r));
      assert.deepEqual(sharp, [], `${width}px no 4 px corners`);
      const fieldRadius = await page.locator('#customerFirstName').evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
      assert.ok(fieldRadius >= 11.5, `fields are 12 px rounded, got ${fieldRadius}`);
      await shot(page, `p152-4-details-${width}`);

      await page.getByLabel('First name').fill('Ana');
      await page.getByLabel('Last name').fill('dela Cruz');
      await page.getByLabel('Philippine mobile number').fill('0917 000 0000');
      await page.getByLabel(/Vehicle make/).fill('Toyota Vios');
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Submit booking request' }).filter({ visible: true }).click();
      await page.getByRole('heading', { name: 'Booking received' }).waitFor({ timeout: 15_000 });
      assert.equal(creates.length, 1, 'one create request');
      assert.equal(creates[0].customerFirstName, 'Ana');
      assert.equal(creates[0].customerLastName, 'dela Cruz');
      assert.equal(creates[0].customerName, 'Ana dela Cruz');
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'wizard-step-title');

      // The ticket: the reference in mono on the main side, the details on a stub past a dashed edge with two notches.
      const ticket = page.locator('section.print-receipt-card').first();
      const ref = page.locator('#reference-title');
      assert.equal((await ref.innerText()).trim(), 'ZEUS-K7M4QX');
      assert.match(await ref.evaluate((e) => getComputedStyle(e).fontFamily), /mono/i, 'the reference is set in a monospace face');
      await page.getByRole('button', { name: 'Copy booking reference' }).waitFor();
      await page.getByRole('button', { name: 'Print receipt' }).waitFor();
      assert.equal(await page.getByText('Waiting for confirmation').first().isVisible(), true);
      const stub = page.locator('[data-part=stub]');
      const sb = await stub.boundingBox(), rb = await ref.boundingBox();
      if (width >= 768) assert.ok(sb.x > rb.x + rb.width - 1, `${width}px the stub is beside the reference`);
      else assert.ok(sb.y > rb.y + rb.height, `${width}px the stub stacks under the reference`);
      const edge = await stub.evaluate((e, w) => { const s = getComputedStyle(e), pb = getComputedStyle(e, '::before'), pa = getComputedStyle(e, '::after'); return { style: w >= 768 ? s.borderLeftStyle : s.borderTopStyle, before: pb.width, after: pa.width }; }, width);
      assert.equal(edge.style, 'dashed', 'a dashed tear-off edge');
      assert.deepEqual([edge.before, edge.after], ['26px', '26px'], 'two notches');
      assert.ok(parseFloat(await ticket.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)) >= 15, 'the ticket is a 16 px card');
      assert.match(await stub.innerText(), /₱550.00/);
      await radii([['Copy reference', page.getByRole('button', { name: 'Copy booking reference' })], ['Print receipt', page.getByRole('button', { name: 'Print receipt' })], ['Return to home', page.getByRole('link', { name: 'Return to home' }).last()]]);
      await noSideways('confirmation');
      await shot(page, `p152-5-ticket-${width}`);

      // Print: the buttons and the page chrome drop out, the ticket stays, flat and white.
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.getByRole('button', { name: 'Copy booking reference' }).isVisible(), false, 'no buttons in the print');
      assert.equal(await ticket.isVisible(), true, 'the receipt prints');
      const printed = await ticket.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, radius: getComputedStyle(e).borderTopLeftRadius, stub: getComputedStyle(e.querySelector('[data-part=stub]')).backgroundImage }));
      assert.equal(printed.bg, 'rgb(255, 255, 255)');
      assert.equal(parseFloat(printed.radius), 0);
      assert.equal(printed.stub, 'none');
      await page.emulateMedia({ media: 'screen' });
      await context.unrouteAll({ behavior: 'ignoreErrors' });
      await context.close();
    }
    assert.deepEqual(errors, [], 'no page error');
  } finally {
    await browser.close();
  }
});

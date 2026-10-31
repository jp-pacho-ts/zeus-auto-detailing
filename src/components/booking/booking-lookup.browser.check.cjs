/* eslint-disable @typescript-eslint/no-require-imports */
// P1-32 real-browser check of the "Manage booking" page: reference code + last name, at 390 and 1280.
// The Cloudflare script and the lookup API are stubbed in the browser (the server side is covered by
// bookings-lookup.integration.test.ts), so this checks what the customer sees: the form, one generic failure,
// the rate-limit words, the status-level progress, masked contact, the old private-code form still there,
// no sideways scroll. Same environment as the other browser checks; never loads .env.
// Optional P132_SHOTS: a folder for screenshots.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const GENERIC = "We couldn't find that booking. Check the reference code and last name.";
const LIMIT = 'Too many tries. Use the link in your confirmation email, or call the shop.';
const future = new Date(Date.now() + 8 * 3600_000 + 5 * 86_400_000).toISOString().slice(0, 10);
const view = (status) => ({
  id: '0f8fad5b-d9cb-469f-a165-70867728950e', referenceCode: 'ZEUS-ABC123', status, revision: 2, bookingDate: future, timezone: 'Asia/Manila',
  vehicleCategoryId: '0f8fad5b-d9cb-469f-a165-70867728950f', vehicleCategoryName: 'Small', currency: 'PHP', totalPriceCentavos: 18000, estimatedTotalCentavos: 18000,
  lines: [{ serviceId: '0f8fad5b-d9cb-469f-a165-708677289510', name: 'Basic Wash', quantity: 1, priceStatus: 'PRICED', subtotalCentavos: 18000, referenceSubtotalCentavos: null }],
  selfServiceAllowed: true, selfServiceCutoff: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  deposit: { status: 'NONE', proofsSent: 0, proofsAllowed: 3, message: null },
});
const envelope = (data) => ({ ok: true, data });
const failure = (code, message, status) => ({ status, body: { ok: false, error: { code, message, fieldErrors: {}, retryable: code === 'RATE_LIMITED', commitState: 'NOT_APPLICABLE', currentQuote: null, currentBooking: null, retryAfterSeconds: null } } });

test('the Manage booking page: reference code + last name, one generic failure, progress, masked contact', { timeout: 150_000 }, async () => {
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const errors = [];
  const shot = async (page, name) => { if (process.env.P132_SHOTS) await page.screenshot({ path: path.join(process.env.P132_SHOTS, name + '.png'), fullPage: true }); };
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const lookups = [];
      await context.route('**/*', async (route) => {
        const request = route.request(), u = request.url();
        if (u.startsWith('https://challenges.cloudflare.com/')) {
          // A Turnstile that hands back a fresh token as soon as it is rendered.
          return route.fulfill({ contentType: 'text/javascript', body: "window.turnstile={render(el,o){setTimeout(()=>o.callback('synthetic-'+Math.random()),30);return 'w'+Math.random()},remove(){}};" });
        }
        if (!u.startsWith(origin + '/')) return route.abort();
        if (new URL(u).pathname === '/api/bookings/manage/lookup' && request.method() === 'POST') {
          const body = JSON.parse(request.postData() || '{}');
          lookups.push(body);
          let out;
          if (body.lastName === 'Slow') out = failure('RATE_LIMITED', 'Too many tries. Use the link in your confirmation email, or call the shop.', 429);
          else if (body.referenceCode.trim().toUpperCase() === 'ZEUS-ABC123' && /^cruz$/i.test(body.lastName.trim())) out = { status: 200, body: envelope({ booking: view('CONFIRMED'), sessionExpiresAt: new Date(Date.now() + 1800_000).toISOString(), contact: { phone: '+63 9•• ••• 4567', email: 'j•••@gmail.com' } }) };
          else out = failure('NOT_FOUND', GENERIC, 404);
          return route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
        }
        if (new URL(u).pathname === '/api/bookings/manage' && request.method() === 'GET') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'x', fieldErrors: {}, retryable: false, commitState: 'NOT_APPLICABLE', currentQuote: null, currentBooking: null, retryAfterSeconds: null } }) });
        const response = await route.fetch({ url: u.replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.132' } });
        await route.fulfill({ response });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin + '/book/manage', { waitUntil: 'networkidle' });
      const form = page.getByRole('form', { name: 'Find your booking' }).or(page.locator('form[aria-labelledby="lookup-title"]'));
      await form.waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Find your booking' }).count(), 1, width + 'px the lookup form');
      assert.equal(await page.getByRole('heading', { name: 'Enter your private code' }).count(), 1, width + 'px the private-code form is still there');
      await shot(page, `p132-lookup-${width}`);
      const submit = form.getByRole('button', { name: 'Find my booking' });
      // A wrong name: the one generic answer, and the form stays usable.
      await form.getByLabel('Reference code').fill('zeus-abc123');
      await form.getByLabel('Last name').fill('Reyes');
      await page.waitForTimeout(150);
      await submit.click();
      const alert = form.getByRole('alert');
      await alert.waitFor();
      assert.equal((await alert.innerText()).trim(), GENERIC, width + 'px generic failure text');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'alert', 'focus moves to the message');
      // A wrong code gives exactly the same words.
      await form.getByLabel('Reference code').fill('ZEUS-ZZZZZZ');
      await page.waitForTimeout(150);
      await submit.click();
      await page.waitForFunction(() => document.querySelectorAll('[role=alert]').length === 1);
      assert.equal((await alert.innerText()).trim(), GENERIC, 'a wrong code reads the same');
      // The limit words, with the way out.
      await form.getByLabel('Last name').fill('Slow');
      await page.waitForTimeout(150);
      await submit.click();
      await page.waitForFunction((t) => document.querySelector('[role=alert]')?.textContent?.includes(t), LIMIT.split('.')[0]);
      assert.match(await alert.innerText(), /Use the link in your confirmation email, or call the shop\./);
      await shot(page, `p132-limit-${width}`);
      // The right pair opens the booking with status-level progress and masked contact.
      await form.getByLabel('Reference code').fill(' ZEUS-ABC123 ');
      await form.getByLabel('Last name').fill('CRUZ');
      await page.waitForTimeout(150);
      await submit.click();
      await page.getByRole('heading', { name: 'Booking progress' }).waitFor();
      assert.match(await page.getByText('Current status:').innerText(), /Confirmed/);
      const steps = page.getByRole('list', { name: 'Progress steps' }).getByRole('listitem');
      assert.deepEqual(await steps.allInnerTexts().then((t) => t.map((x) => x.replace(/\s*\(done\)/, '').trim())), ['Received', 'Confirmed', 'In service', 'Completed']);
      assert.equal(await steps.nth(1).getAttribute('aria-current'), 'step');
      assert.equal(await page.getByText('+63 9•• ••• 4567').count(), 1, 'masked phone');
      assert.equal(await page.getByText('j•••@gmail.com').count(), 1, 'masked email');
      const body = await page.locator('body').innerText();
      for (const secret of ['bay', 'Bay', 'worker', 'Worker', 'checklist']) assert.ok(!body.includes(secret), width + 'px nothing about ' + secret);
      assert.equal(lookups.length, 4);
      assert.ok(lookups.every((l) => typeof l.turnstileToken === 'string' && l.turnstileToken.startsWith('synthetic-')), 'every attempt carries a security-check token');
      assert.equal(new Set(lookups.map((l) => l.turnstileToken)).size, 4, 'a fresh token for every attempt');
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth), true, width + 'px no sideways scroll');
      await shot(page, `p132-progress-${width}`);
      await context.unrouteAll({ behavior: 'ignoreErrors' });
      await context.close();
    }
    assert.deepEqual(errors, [], 'no page error');
  } finally {
    await browser.close();
  }
});

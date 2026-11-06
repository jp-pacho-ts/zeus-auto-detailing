/* eslint-disable @typescript-eslint/no-require-imports */
// P1-32 real-browser check of the booking form's name fields, at 390 and 1280: First name and Last name
// replace "Your name", each refuses an empty value with its own words, and the request carries both. The
// create call is stubbed so no booking is made; the Cloudflare script is stubbed in the browser. Same
// environment as the other browser checks; never loads .env. Optional P132_SHOTS: a screenshot folder.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('the booking form asks for a first and a last name, and sends both', { timeout: 150_000 }, async () => {
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const errors = [];
  const shot = async (page, name) => { if (process.env.P132_SHOTS) await page.screenshot({ path: path.join(process.env.P132_SHOTS, name + '.png'), fullPage: true }); };
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const creates = [];
      await context.route('**/*', async (route) => {
        const request = route.request(), u = request.url();
        if (u.startsWith('https://challenges.cloudflare.com/')) {
          return route.fulfill({ contentType: 'text/javascript', body: "window.turnstile={render(el,o){setTimeout(()=>o.callback('synthetic-'+Math.random()),30);return 'w'+Math.random()},remove(){}};" });
        }
        if (!u.startsWith(origin + '/')) return route.abort();
        if (new URL(u).pathname === '/api/bookings' && request.method() === 'POST') {
          creates.push(JSON.parse(request.postData() || '{}'));
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'CHALLENGE_FAILED', message: 'Complete the security check again.', fieldErrors: {}, retryable: true, commitState: 'NOT_APPLICABLE', currentQuote: null, currentBooking: null, retryAfterSeconds: null } }) });
        }
        const response = await route.fetch({ url: u.replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.133' } });
        await route.fulfill({ response });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin + '/book?vehicle=sedan&service=basic-wash', { waitUntil: 'networkidle' });
      // The link opens the services step with Basic Wash chosen: Continue, pick the first open day, Continue.
      const first = page.locator('#customerFirstName');
      const next = () => page.getByRole('button', { name: 'Continue', exact: true }).first();
      await next().click();
      const day = page.locator('input[name="booking-day"]:not([disabled])').first();
      await day.waitFor({ state: 'attached', timeout: 30_000 });
      await day.check({ force: true });
      await next().click();
      await first.waitFor();
      assert.equal(await page.getByLabel('Your name').count(), 0, width + 'px the single name field is gone');
      const last = page.locator('#customerLastName');
      assert.equal(await page.getByLabel('First name').count(), 1);
      assert.equal(await page.getByLabel('Last name').count(), 1);
      assert.equal(await first.getAttribute('autocomplete'), 'given-name');
      assert.equal(await last.getAttribute('autocomplete'), 'family-name');
      const a = await first.boundingBox(), b = await last.boundingBox();
      if (width >= 640) assert.ok(Math.abs(a.y - b.y) < 4 && b.x > a.x, width + 'px the two names sit side by side');
      else assert.ok(b.y > a.y + a.height - 1, width + 'px the two names stack');
      assert.ok(a.height >= 44 && b.height >= 44, 'touch-sized fields');
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth), true, width + 'px no sideways scroll');
      await shot(page, `p132-form-${width}`);
      // Empty names are refused with their own words, and nothing is sent.
      await page.locator('#customerPhone').fill('0917 000 0000');
      await page.locator('#vehicleModel').fill('Toyota Vios');
      await page.waitForTimeout(200);
      await page.locator('form').first().evaluate((f) => f.requestSubmit());
      await page.locator('#customerFirstName-error').waitFor();
      assert.equal((await page.locator('#customerFirstName-error').innerText()).trim(), 'Enter your first name.');
      assert.equal((await page.locator('#customerLastName-error').innerText()).trim(), 'Enter your last name.');
      assert.equal(creates.length, 0, 'nothing is sent while a name is missing');
      assert.equal(await first.getAttribute('aria-invalid'), 'true');
      // Both given: the request carries both and the display name.
      await first.fill('Ana');
      await last.fill('dela Cruz');
      await page.waitForTimeout(200);
      await page.locator('form').first().evaluate((f) => f.requestSubmit());
      await page.waitForFunction(() => true);
      for (let i = 0; i < 40 && !creates.length; i++) await page.waitForTimeout(100);
      assert.equal(creates.length, 1, 'one create request');
      assert.equal(creates[0].customerFirstName, 'Ana');
      assert.equal(creates[0].customerLastName, 'dela Cruz');
      assert.equal(creates[0].customerName, 'Ana dela Cruz');
      await context.unrouteAll({ behavior: 'ignoreErrors' });
      await context.close();
    }
    assert.deepEqual(errors, [], 'no page error');
  } finally {
    await browser.close();
  }
});

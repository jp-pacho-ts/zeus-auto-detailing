/* eslint-disable @typescript-eslint/no-require-imports */
// P1-25 F1 real-browser regression (Codex review of 1aebbf2): a move whose write ends uncertain stays
// locked until a SUCCESSFUL board reload. A failed reload (503) keeps the old cards visible but
// read-only: Move car disabled, cards not draggable, uncertain-outcome alert and reload error both shown.
// Same environment as card-drag.browser.check.cjs; never loads .env. Fixture: a car waiting in
// "Waiting · Wash" and an empty Wash bay named "Wash Bay QSA B" (the card-drag fixture's empty bay).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('an uncertain move stays locked while the board reload fails, and unlocks only after a good reload', { timeout: 120_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const retryable = ['GET', 'HEAD'].includes(request.method());
      let response;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await route.fetch({
            url: request.url().replace(origin, upstream.origin),
            headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.126' },
          });
        } catch (error) {
          if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
        }
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let puts = 0;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && /\/api\/admin\/bookings\/[^/]+\/bay$/.test(new URL(request.url()).pathname)) puts += 1;
    });

    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();

    const card = page.getByRole('region', { name: 'Waiting · Wash', exact: true }).locator('article').first();
    await card.waitFor();
    const ref = (await card.getAttribute('aria-label')) ?? '';
    assert.match(ref, /^ZEUS-/, 'waiting Wash card present');
    const moveButton = card.getByRole('button', { name: 'Move car', exact: true });
    const uncertain = page.getByRole('alert').filter({ hasText: 'The move outcome is uncertain.' });
    assert.equal(await moveButton.isDisabled(), false, 'Move car starts enabled');
    assert.equal(await card.getAttribute('draggable'), 'true', 'the card starts draggable');

    // The write is aborted in transport, so its outcome is unknown.
    const select = card.getByLabel('Move ' + ref + ' to bay');
    await select.selectOption({ label: 'Wash Bay QSA B' });
    await page.route('**/api/admin/bookings/*/bay', (route) => (route.request().method() === 'PUT' ? route.abort() : route.fallback()));
    await moveButton.click();
    await uncertain.waitFor();
    assert.equal(puts, 1, 'exactly one PUT was attempted');
    assert.equal(await moveButton.isDisabled(), true, 'Move car disabled while the outcome is uncertain');
    assert.notEqual(await card.getAttribute('draggable'), 'true', 'not draggable while the outcome is uncertain');

    // The next board reload fails: the stale card stays visible and stays read-only, the alert stays.
    await page.route(/\/api\/admin\/board\?/, (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'RETRYABLE_ERROR', message: 'Synthetic board reload failure' } }),
    }));
    const failed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/board' && r.status() === 503);
    await page.getByRole('button', { name: 'Refresh board', exact: true }).click();
    await failed;
    await page.waitForTimeout(300);
    assert.equal(await card.count(), 1, 'the stale card stays visible');
    assert.equal(await moveButton.isDisabled(), true, 'Move car stays disabled after a failed reload');
    assert.notEqual(await card.getAttribute('draggable'), 'true', 'the stale card is not draggable after a failed reload');
    assert.equal(await uncertain.count(), 1, 'the uncertain-outcome alert stays after a failed reload');
    assert.ok(await page.getByRole('alert').filter({ hasText: 'Synthetic board reload failure' }).count() >= 1, 'the reload error is shown');
    assert.equal(puts, 1, 'no further write was possible');

    // A successful reload is the authoritative recovery: the lock clears.
    await page.unroute(/\/api\/admin\/board\?/);
    await page.unroute('**/api/admin/bookings/*/bay');
    const good = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/board' && r.status() === 200);
    await page.getByRole('button', { name: 'Refresh board', exact: true }).click();
    await good;
    await uncertain.waitFor({ state: 'detached' });
    const fresh = page.getByRole('region', { name: 'Waiting · Wash', exact: true }).locator('article').first();
    await fresh.waitFor();
    assert.equal(await fresh.getByRole('button', { name: 'Move car', exact: true }).isDisabled(), false, 'Move car enabled again after a good reload');
    assert.equal(await fresh.getAttribute('draggable'), 'true', 'draggable again after a good reload');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

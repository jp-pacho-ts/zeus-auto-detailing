/* eslint-disable @typescript-eslint/no-require-imports */
// P1-29 real-browser check: the booking drawer's Delete booking action is ADMIN only, stays off until the
// reference code is typed exactly, removes the card from the board for good (reload too), and leaves no
// page error. Same environment and fixture as card-drag.browser.check.cjs; never loads .env.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('only an ADMIN can delete a booking, after typing its reference code', { timeout: 120_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.QSA_DETAILER_EMAIL, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const errors = [];
  async function session(email, password) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const retryable = ['GET', 'HEAD'].includes(request.method());
      let response;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.129' } });
        } catch (error) {
          if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
        }
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();
    return { context, page };
  }
  try {
    // A detailer can open the booking but is never offered Delete booking.
    const staff = await session(process.env.QSA_DETAILER_EMAIL, process.env.QSA_DETAILER_PASSWORD);
    const staffCard = staff.page.getByRole('region', { name: 'Waiting · Wash', exact: true }).locator('article').first();
    await staffCard.waitFor();
    await staffCard.getByRole('button', { name: await staffCard.getAttribute('aria-label'), exact: true }).click();
    await staff.page.getByRole('dialog').getByText('Booking details').waitFor();
    await staff.page.getByRole('dialog').getByRole('button', { name: 'Close details' }).waitFor();
    assert.equal(await staff.page.getByRole('button', { name: 'Delete booking' }).count(), 0, 'no Delete booking for a detailer');
    await staff.page.waitForLoadState('networkidle'); await staff.context.unrouteAll({ behavior: 'ignoreErrors' }); await staff.context.close();

    const { context, page } = await session(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD);
    const waiting = page.getByRole('region', { name: 'Waiting · Wash', exact: true });
    const card = waiting.locator('article').first();
    await card.waitFor();
    const ref = await card.getAttribute('aria-label');
    const total = await page.locator('article').count();
    await card.getByRole('button', { name: ref, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Booking details').waitFor();
    const button = dialog.getByRole('button', { name: 'Delete booking', exact: true });
    const input = dialog.getByLabel('Type ' + ref + ' to confirm');
    assert.match(await dialog.getByText(/removes it from history, from the day.s counts and from any totals/).innerText(), /A short record that you deleted it is kept/);
    assert.equal(await button.isDisabled(), true, 'off until the code is typed');
    await input.fill(ref.toLowerCase());
    assert.equal(await button.isDisabled(), true, 'lower case does not match');
    await input.fill(ref.slice(0, -1));
    assert.equal(await button.isDisabled(), true, 'a partial code does not match');
    await input.fill(ref);
    assert.equal(await button.isDisabled(), false, 'on once the exact code is typed');
    const gone = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/delete') && r.request().method() === 'POST');
    await button.click();
    assert.equal((await gone).status(), 200, 'the delete was accepted');
    await dialog.waitFor({ state: 'detached' });
    // The board keeps its rows while it reloads, so wait for the card to leave rather than count at once.
    await page.getByRole('article', { name: ref, exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.locator('article').count(), total - 1, 'one card fewer');
    // Reload: the booking is really gone, not just hidden.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();
    await page.locator('article').first().waitFor();
    assert.equal(await page.getByRole('article', { name: ref, exact: true }).count(), 0, 'still gone after a reload');
    // The board payload no longer names it either.
    const again = await page.evaluate(async (code) => {
      const res = await fetch('/api/admin/board?date=' + new Date().toISOString().slice(0, 10));
      return { status: res.status, text: (await res.text()).includes(code) };
    }, ref);
    assert.equal(again.text, false, 'the board payload no longer names it');
    await page.waitForLoadState('networkidle');
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    assert.deepEqual(errors, [], 'no page error');
  } finally {
    await browser.close();
  }
});

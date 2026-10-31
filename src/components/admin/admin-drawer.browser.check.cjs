/* eslint-disable @typescript-eslint/no-require-imports */
// Standalone synthetic browser regression. Same environment as bookings/bay-controls.browser.check.cjs.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
test('mobile drawer contains focus, makes background inert, restores focus and preserves desktop navigation', { timeout: 90000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname));
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await context.route('**/*', async route => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.123' } });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    const firstMenu = page.locator('button[aria-controls=admin-nav]');
    if (await firstMenu.isVisible()) await firstMenu.click();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();
    const nav = page.locator('#admin-nav');
    const menu = page.locator('button[aria-controls=admin-nav]');
    const shot = async name => { if (process.env.P120_DRAWER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.P120_DRAWER_SCREENSHOTS, name + '.png') }); };
    for (const width of [390, 767]) {
      await page.setViewportSize({ width, height: 900 });
      await menu.click();
      await nav.getByRole('button', { name: 'Bookings', exact: true }).waitFor();
      await shot(width + '-open');
      await nav.getByRole('button', { name: 'Sign out', exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await nav.evaluate(el => el.contains(document.activeElement)), true, width + 'px Tab must stay in drawer');
      await nav.getByRole('link', { name: 'Return to public shop site' }).focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await nav.evaluate(el => el.contains(document.activeElement)), true, width + 'px Shift+Tab must stay in drawer');
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press(i < 10 ? 'Tab' : 'Shift+Tab');
        assert.equal(await nav.evaluate(el => el.contains(document.activeElement)), true, 'drawer traversal stays visible');
      }
      assert.equal(await page.locator('#admin-content').evaluate(el => Boolean(el.closest('[inert]'))), true, 'content must be inert');
      await page.locator('header').getByRole('link', { name: /New Booking/ }).evaluate(el => el.focus());
      assert.equal(await nav.evaluate(el => el.contains(document.activeElement)), true, 'covered header cannot take focus');
      await menu.evaluate(el => el.focus());
      assert.equal(await nav.evaluate(el => el.contains(document.activeElement)), true, 'covered mobile bar cannot take focus');
      await page.keyboard.press('Escape');
      await nav.waitFor({ state: 'hidden' });
      assert.equal(await menu.evaluate(el => el === document.activeElement), true, 'Escape restores Menu focus');
      await menu.click(); await nav.getByRole('button', { name: 'Close menu' }).click();
      await nav.waitFor({ state: 'hidden' });
      assert.equal(await menu.evaluate(el => el === document.activeElement), true, 'Close restores Menu focus');
      await menu.click();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForFunction(() => !document.querySelector('#admin-content').closest('[inert]'));
      assert.equal(await nav.getAttribute('aria-modal'), null, 'desktop sidebar is not modal');
      await nav.getByRole('button', { name: 'Sign out', exact: true }).focus(); await page.keyboard.press('Tab');
      assert.equal(await page.locator('header').getByRole('link', { name: /New Booking/ }).evaluate(el => el === document.activeElement), true, 'desktop Tab leaves sidebar normally');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await nav.getByRole('button', { name: 'Sign out', exact: true }).evaluate(el => el === document.activeElement), true, 'desktop Shift+Tab returns normally');
      await nav.getByRole('button', { name: 'Team & Commissions', exact: true }).click();
      await page.getByRole('heading', { name: 'Team & Commissions', exact: true }).waitFor();
      await shot(width + '-desktop');
      await nav.getByRole('button', { name: 'Bookings', exact: true }).click();
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

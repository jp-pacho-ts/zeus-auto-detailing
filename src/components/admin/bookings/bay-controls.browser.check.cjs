/* eslint-disable @typescript-eslint/no-require-imports */
// P1-20 real-browser regression. Uses a running synthetic loopback fixture; never loads .env.
// Run: node --test src/components/admin/bookings/bay-controls.browser.check.cjs
// Required: PLAYWRIGHT_MODULE, P120_BROWSER_ORIGIN (loopback upstream), P120_APP_ORIGIN,
// P120_TEST_EMAIL, P120_TEST_PASSWORD. Optional: P120_CHROME_EXECUTABLE, P120_DIALOG_SCREENSHOT_DIR.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('remove-bay confirmation contains Tab/Shift+Tab focus and Escape returns it to the bay menu', { timeout: 90_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const name = 'QA Focus Bay ' + Date.now();
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.122' } });
      await route.fulfill({ response });
    });
    page = await context.newPage();
    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('button', { name: 'Add a wash bay', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add a wash bay', exact: true }).click();
    const input = page.getByLabel('New wash bay name');
    await input.fill(name);
    await input.locator('..').getByRole('button', { name: 'Add bay', exact: true }).click();
    await page.getByLabel('Wash board column').selectOption({ label: name + ' (0)' });
    const trigger = page.getByRole('button', { name: 'Options for ' + name, exact: true });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await page.waitForFunction(() => document.activeElement?.textContent === 'Keep bay');
    for (const width of [1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id }));
        assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, width + 'px ' + key + ' must stay inside the confirmation: ' + JSON.stringify(focus));
      }
      if (process.env.P120_DIALOG_SCREENSHOT_DIR) await page.screenshot({ path: require('node:path').join(process.env.P120_DIALOG_SCREENSHOT_DIR, width + '-bay-confirmation.png') });
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, 'Escape returns focus to the bay menu');
  } finally {
    // Deactivate only this test's uniquely named empty bay; keep history and every assertion.
    try {
      if (page) await page.evaluate(async (name) => {
        const result = await (await fetch('/api/admin/bays')).json();
        const bay = result.data?.find((row) => row.name === name);
        if (bay?.isActive) {
          const response = await fetch('/api/admin/bays/' + bay.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedUpdatedAt: bay.updatedAt, isActive: false }) });
          if (!response.ok) throw new Error('Synthetic bay cleanup failed');
        }
      }, name);
    } finally {
      await browser.close();
    }
  }
});

/* eslint-disable @typescript-eslint/no-require-imports */
// Run against a built loopback app and fresh team-browser.fixture.ts database. Same environment as expenses.browser.check.cjs.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('expense analytics refreshes after writes, preserves the period, and displays exact signed totals', { timeout: 120_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost'].includes(upstream.hostname));
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
      if (!route.request().url().startsWith(origin + '/')) return route.abort();
      const response = await route.fetch({ url: route.request().url().replace(origin, upstream.origin), headers: { ...route.request().headers(), 'x-forwarded-for': '198.51.100.149' } });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/admin/login');
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Expenses', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Expense analytics', exact: true });
    await panel.getByTestId('expense-analytics-total').waitFor();
    await panel.getByRole('button', { name: 'This year', exact: true }).click();
    await page.waitForResponse((r) => r.url().includes('/expenses/analytics?') && r.status() === 200);
    const shot = async (name) => {
      if (process.env.P139_SHOTS) await panel.screenshot({ path: path.join(process.env.P139_SHOTS, name + '.png') });
    };
    await shot('analytics-before-write');
    const checkTotal = async (expected) => {
      await page.waitForFunction((value) => document.querySelector('[data-testid="expense-analytics-total"]')?.textContent === value, expected, { timeout: 8000 });
      assert.equal(await panel.getByRole('button', { name: 'This year', exact: true }).getAttribute('aria-pressed'), 'true');
    };
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Category', { exact: true }).selectOption({ label: 'Utilities' });
    await dialog.getByLabel('Amount, in pesos').fill('1250.50');
    await dialog.getByLabel('Who was paid (optional)').fill('Analytics QA');
    await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'The expense was added.' }).first().waitFor();
    await shot('analytics-after-write');
    await checkTotal('₱1,250.50');
    const row = page.locator('[data-expense]').filter({ hasText: 'Analytics QA' });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount, in pesos').fill('1300');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await checkTotal('₱1,300.00');
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove expense', exact: true }).click();
    await checkTotal('₱0.00');
    await page.getByLabel('Show removed').check();
    await row.getByRole('button', { name: 'Restore', exact: true }).click();
    await checkTotal('₱1,300.00');
    await panel.getByRole('button', { name: 'Show as table' }).click();
    assert.match(await panel.locator('table').innerText(), /1,300\.00/);
    await shot('analytics-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot('analytics-phone');

    // Boundary responses use the real DTO shape; normal CRUD above uses the real server and database.
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const fixture = (total) => ({ from: today, to: today, today, unit: 'DAY', buckets: [{ start: today, end: today, future: false, total, manual: total.startsWith('-') ? '0' : total, stockBought: '0', commissionsPaid: total.startsWith('-') ? total : '0' }], totals: { total, manual: total.startsWith('-') ? '0' : total, stockBought: '0', commissionsPaid: total.startsWith('-') ? total : '0', commissionsOwed: '0' }, byCategory: total.startsWith('-') ? [] : [{ categoryId: 'qa', name: 'Large category', total }], pricedStockIns: 0, unpricedStockIns: 2 });
    let total = '-2500';
    await page.route('**/api/admin/expenses/analytics?*', (route) => route.fulfill({ json: { ok: true, data: fixture(total) } }));
    await panel.getByRole('button', { name: 'Today', exact: true }).click();
    await panel.getByText('-₱25.00', { exact: true }).first().waitFor();
    assert.match(await panel.locator('table').innerText(), /-₱25\.00/);
    assert.equal(await panel.getByText('No spending in this period.', { exact: true }).count(), 0);
    assert.equal(await panel.getByText(/% of the total/).count(), 0);
    await panel.getByText('2 stock-ins had no price and are not counted.').waitFor();
    total = '9007199254740993';
    await panel.getByRole('button', { name: 'This month', exact: true }).click();
    await panel.getByText('₱90,071,992,547,409.93', { exact: true }).first().waitFor();
    assert.match(await panel.locator('table').first().innerText(), /90,071,992,547,409\.93/);
    assert.match(await panel.innerText(), /Large category/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

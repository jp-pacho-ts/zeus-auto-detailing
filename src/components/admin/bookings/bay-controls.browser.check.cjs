/* eslint-disable @typescript-eslint/no-require-imports */
// P1-20 real-browser regression. Uses a running synthetic loopback fixture; never loads .env.
// Run: node --test src/components/admin/bookings/bay-controls.browser.check.cjs
// Required: PLAYWRIGHT_MODULE, P120_BROWSER_ORIGIN (loopback upstream), P120_APP_ORIGIN,
// P120_TEST_EMAIL, P120_TEST_PASSWORD. Optional: P120_CHROME_EXECUTABLE, P120_DIALOG_SCREENSHOT_DIR.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// P1-22: Add bay is a row-header button that opens a modal. The refusal and busy steps hold or
// answer one synthetic POST in this test's own route handler; the final add uses the real server.
test('add-bay modal and remove-bay confirmation contain Tab/Shift+Tab focus and Escape returns it to their buttons', { timeout: 120_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const name = 'QA Focus Bay ' + Date.now();
  let page;
  let refuseNextAdd = false, holdNextAdd = null;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const adding = request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/bays';
      if (adding && refuseNextAdd) {
        refuseNextAdd = false;
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'CONFLICT', message: 'Synthetic refusal from the shop server.', commitState: 'NOT_COMMITTED' } }) });
      }
      if (adding && holdNextAdd) { const hold = holdNextAdd; holdNextAdd = null; await hold; }
      const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.122' } });
      await route.fulfill({ response });
    });
    page = await context.newPage();
    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    const add = page.getByRole('button', { name: 'Add bay to Wash', exact: true });
    await add.waitFor();
    const modal = page.getByRole('dialog', { name: 'Add a wash bay' });
    const field = modal.getByLabel('Bay name', { exact: true });
    const isFocused = (locator) => locator.evaluate((element) => document.activeElement === element);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await add.click();
      await modal.waitFor();
      assert.equal(await isFocused(field), true, width + 'px the name field is focused on open');
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent }));
        assert.equal(await modal.evaluate((element) => element.contains(document.activeElement)), true, width + 'px ' + key + ' must stay inside the add-bay modal: ' + JSON.stringify(focus));
      }
      await modal.getByRole('button', { name: 'Add bay', exact: true }).click();
      await modal.getByRole('alert').filter({ hasText: 'Enter a bay name.' }).waitFor();
      assert.equal(await field.getAttribute('aria-invalid'), 'true', width + 'px invalid name is marked');
      assert.equal(await isFocused(field), true, width + 'px focus returns to the field after a validation error');
      if (process.env.P120_DIALOG_SCREENSHOT_DIR) await page.screenshot({ path: require('node:path').join(process.env.P120_DIALOG_SCREENSHOT_DIR, width + '-add-bay-validation.png') });
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'detached' });
      assert.equal(await isFocused(add), true, width + 'px Escape returns focus to Add bay');
      await add.click();
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
      await modal.waitFor({ state: 'detached' });
      assert.equal(await isFocused(add), true, width + 'px Cancel returns focus to Add bay');
    }
    await add.click();
    await field.fill(name);
    refuseNextAdd = true;
    await modal.getByRole('button', { name: 'Add bay', exact: true }).click();
    await modal.getByRole('alert').filter({ hasText: 'Synthetic refusal from the shop server.' }).waitFor();
    assert.equal(await isFocused(field), true, 'focus returns to the field after a server refusal');
    assert.equal(await field.inputValue(), name, 'the typed name is kept after a refusal');
    let release;
    holdNextAdd = new Promise((resolve) => { release = resolve; });
    await modal.getByRole('button', { name: 'Add bay', exact: true }).click();
    const adding = modal.getByRole('button', { name: 'Adding…', exact: true });
    await adding.waitFor();
    assert.equal(await adding.isDisabled(), true, 'the submit button is disabled while adding');
    assert.equal(await modal.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true, 'Cancel is disabled while adding');
    await page.keyboard.press('Escape');
    assert.equal(await modal.isVisible(), true, 'Escape is ignored while adding');
    release();
    await modal.waitFor({ state: 'detached' });
    assert.equal(await isFocused(add), true, 'focus returns to Add bay after the bay is added');
    await page.getByRole('status').filter({ hasText: name + ' added.' }).waitFor();
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
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove bay', exact: true }).click();
    await trigger.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay Calendar', exact: true }).click();
    await page.getByRole('group', { name: 'Calendar sections' }).getByRole('button', { name: 'Bays', exact: true }).click();
    await page.getByRole('button', { name: 'Bring back ' + name, exact: true }).waitFor();
    for (const width of [1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const size = await page.locator('#admin-content').evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
      assert.ok(size.scroll <= size.client, width + 'px removed-bay actions must fit the content: ' + JSON.stringify(size));
    }
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

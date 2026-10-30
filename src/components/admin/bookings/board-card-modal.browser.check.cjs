/* eslint-disable @typescript-eslint/no-require-imports */
// P1-30 real-browser regression: a click anywhere on a board card opens its details as a modal dialog.
// Controls on the card and real drags do not open it; the keyboard path, Escape/Close, focus return and the
// scroll lock work; Done cards open it; a detailer sees no Delete booking; after a delete focus lands on the
// board, not <body>. Same environment and fixture as card-drag.browser.check.cjs; never loads .env.
// Optional P130_SHOTS: a folder for before/after screenshots at 1280 and 390.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('click anywhere on a board card opens its details modal; controls and drags do not', { timeout: 180_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.QSA_DETAILER_EMAIL, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const errors = [];
  const shot = async (page, name) => { if (process.env.P130_SHOTS) await page.screenshot({ path: path.join(process.env.P130_SHOTS, name + '.png') }); };
  async function session(email, password, viewport) {
    const context = await browser.newContext({ viewport });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const retryable = ['GET', 'HEAD'].includes(request.method());
      let response;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.130' } });
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
    const menu = page.locator('button[aria-controls=admin-nav]');
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();
    return { context, page };
  }
  const close = async ({ context, page }) => {
    await page.waitForLoadState('networkidle');
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  };
  const scrollMode = (page) => page.evaluate(() => getComputedStyle(document.getElementById('admin-content')).overflowY);
  const activeIs = (page, id) => page.evaluate((x) => document.activeElement?.id === x, id);
  try {
    // ---- ADMIN at 1280 and 390: click on the card body (not the reference), screenshots before and after ----
    for (const width of (process.env.P130_WIDTHS || '1280,390').split(',').map(Number)) {
      const s = await session(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width, height: 900 });
      const { page } = s;
      const washRow = page.getByRole('region', { name: 'Wash row' });
      const card = washRow.getByRole('region', { name: 'Waiting · Wash', exact: true }).locator('article').first();
      await card.waitFor();
      const ref = await card.getAttribute('aria-label');
      const dialog = page.getByRole('dialog');
      const before = await scrollMode(page);
      await shot(page, `p130-before-${width}`);
      await card.getByText(/Synthetic Vehicle|·/).first().click();
      await dialog.getByText('Booking details').waitFor({ timeout: 5000 }).catch(() => {});
      await shot(page, `p130-after-${width}`);
      assert.equal(await dialog.count(), 1, `${width}px: a click on the card body opens the details dialog`);
      assert.equal(await dialog.evaluate((d) => d.open && d.matches(':modal')), true, 'it is a true modal dialog');
      await dialog.getByText(ref, { exact: true }).first().waitFor();
      assert.equal(await scrollMode(page), 'hidden', 'the dashboard cannot scroll behind the modal');
      // Escape closes it, focus returns to this card's reference button, the scroll area works again.
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await activeIs(page, 'board-card-' + (await card.getByRole('button', { name: ref, exact: true }).getAttribute('id')).slice('board-card-'.length)), true, 'focus returns to the card after Escape');
      assert.equal(await scrollMode(page), before, 'the scroll area is restored after Escape');
      // The visible Close button does the same.
      await card.getByText(/Synthetic Vehicle|·/).first().click();
      await dialog.getByRole('button', { name: 'Close details' }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await activeIs(page, await card.getByRole('button', { name: ref, exact: true }).getAttribute('id')), true, 'focus returns to the card after Close');
      assert.equal(await scrollMode(page), before, 'the scroll area is restored after Close');
      // The keyboard path: Tab reaches the reference button, Enter opens it.
      await card.getByRole('button', { name: ref, exact: true }).focus();
      await page.keyboard.press('Enter');
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      // Controls on the card keep their own behaviour and never open the dialog.
      await card.getByLabel('Move ' + ref + ' to bay').click();
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 0, 'the bay dropdown does not open the details');
      await card.getByRole('button', { name: 'Move car', exact: true }).click();
      assert.equal(await dialog.count(), 0, 'Move car does not open the details');
      await close(s);
    }

    // ---- ADMIN at 1280: a real drag does not open it and still moves the car; Done card; Delete; focus fallback ----
    const s = await session(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 1280, height: 2400 });
    const { page } = s;
    const washRow = page.getByRole('region', { name: 'Wash row' });
    const card = washRow.getByRole('region', { name: 'Waiting · Wash', exact: true }).locator('article').first();
    await card.waitFor();
    const ref = await card.getAttribute('aria-label');
    const dialog = page.getByRole('dialog');
    const bays = await washRow.locator('section[aria-label^="Wash Bay"]').evaluateAll((els) => els.map((el) => ({ label: el.getAttribute('aria-label'), cards: el.querySelectorAll('article').length })));
    const emptyBay = bays.find((b) => b.cards === 0)?.label;
    assert.ok(emptyBay, 'fixture needs an empty Wash bay');
    let puts = 0;
    page.on('request', (r) => { if (r.method() === 'PUT' && /\/bay$/.test(new URL(r.url()).pathname)) puts += 1; });
    const centre = async (l) => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const target = washRow.getByRole('region', { name: emptyBay, exact: true });
    await target.scrollIntoViewIfNeeded(); await card.scrollIntoViewIfNeeded();
    const a = await centre(card.getByText(/Synthetic Vehicle|·/).first()), b = await centre(target);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(a.x + 12, a.y + 12, { steps: 5 });
    await page.mouse.move(b.x, b.y, { steps: 20 });
    await page.mouse.up();
    await washRow.getByRole('region', { name: emptyBay, exact: true }).getByRole('article', { name: ref, exact: true }).waitFor();
    assert.equal(await dialog.count(), 0, 'a drag does not open the details');
    assert.equal(puts, 1, 'the drag still moves the car');

    // Delete from the modal: ADMIN sees it, the typed code is needed, and focus lands on the board afterwards.
    const moved = washRow.getByRole('region', { name: emptyBay, exact: true }).getByRole('article', { name: ref, exact: true });
    await moved.getByText(/Synthetic Vehicle|·/).first().click();
    await dialog.waitFor();
    const del = dialog.getByRole('button', { name: 'Delete booking', exact: true });
    assert.equal(await del.isDisabled(), true, 'Delete booking needs the typed code');
    await dialog.getByLabel('Type ' + ref + ' to confirm').fill(ref);
    await del.click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('article', { name: ref, exact: true }).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body);
    assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'BODY', 'focus is on the board, not <body>, after the card is gone');
    assert.notEqual(await scrollMode(page), 'hidden', 'the scroll area works after the delete');
    // A reload leaves the dashboard scrollable.
    await page.reload({ waitUntil: 'networkidle' });
    assert.notEqual(await scrollMode(page), 'hidden', 'the dashboard scrolls after a reload');

    // Done cards open the same details.
    const done = page.locator('section[aria-label^="Done"] article').first();
    if (await done.count()) {
      await done.getByText(/Synthetic Vehicle|·/).first().click();
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
    }
    await close(s);

    // ---- DETAILER: opens the details read-only, no Delete booking ----
    const staff = await session(process.env.QSA_DETAILER_EMAIL, process.env.QSA_DETAILER_PASSWORD, { width: 1280, height: 900 });
    const sc = staff.page.getByRole('region', { name: 'Waiting · Wash', exact: true }).locator('article').first();
    await sc.waitFor();
    await sc.getByText(/Synthetic Vehicle|·/).first().click();
    await staff.page.getByRole('dialog').getByText('Booking details').waitFor();
    assert.equal(await staff.page.getByRole('button', { name: 'Delete booking' }).count(), 0, 'no Delete booking for a detailer');
    await close(staff);
    assert.deepEqual(errors, [], 'no page error');
  } finally {
    await browser.close();
  }
});

/* eslint-disable @typescript-eslint/no-require-imports */
// P1-35 real-browser check: "Find bookings" is the first thing on the admin Bookings page (above the metric
// tiles and the day queues), at 390 and 1280; its search box is visible without scrolling; the document does
// not scroll; there is one Status filter that filters the queues live and rides along with a search; a search
// opens results and a row's details; Clear search clears only the results. Fixture as in card-drag (today has
// three bookings ZEUS-Q00001..3). Never loads .env. Optional P135_SHOTS: a screenshot folder.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('Find bookings is first on the Bookings page, with one Status filter, and the search still works', { timeout: 180_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const errors = [];
  const shot = async (page, name) => { if (process.env.P135_SHOTS) await page.screenshot({ path: path.join(process.env.P135_SHOTS, name + '.png') }); };
  try {
    for (const [width, height] of [[390, 844], [1280, 900]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const searches = [];
      await context.route('**/*', async (route) => {
        const request = route.request(), u = request.url();
        if (!u.startsWith(origin + '/')) return route.abort();
        const p = new URL(u).pathname;
        if ((p === '/api/admin/bookings/search' && request.method() === 'POST') || (p === '/api/admin/bookings' && request.method() === 'GET')) searches.push({ path: p, search: new URL(u).search, body: request.postData() });
        const retryable = ['GET', 'HEAD'].includes(request.method());
        let response;
        for (let attempt = 0; !response; attempt++) {
          try {
            response = await route.fetch({ url: u.replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.135' } });
          } catch (error) {
            if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
          }
        }
        await route.fulfill({ response });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
      await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
      const menu = page.locator('button[aria-controls=admin-nav]');
      if (await menu.isVisible()) await menu.click().then(() => menu.click()).catch(() => {});
      await page.getByText('Queue day').waitFor();
      await page.locator('[aria-label$=" queue"] tbody tr').first().waitFor();
      await shot(page, `p135-${process.env.P135_PHASE || 'after'}-${width}`);

      // Page order: Find bookings, then the tiles, then the day card with the queues.
      const y = (locator) => locator.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const find = page.getByRole('heading', { name: 'Find bookings', exact: true });
      const tile = page.getByText("Day's Bookings", { exact: true });
      const queueDay = page.getByText('Queue day');
      assert.ok((await y(find)) < (await y(tile)), width + 'px Find bookings is above the metric tiles');
      assert.ok((await y(find)) < (await y(queueDay)), width + 'px Find bookings is above the queues');
      // Visible without scrolling, and the page itself does not scroll.
      const box = await page.getByLabel('Name, phone, last 4 digits or reference').boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= height, width + 'px the search box is in the first screen: ' + JSON.stringify(box));
      const doc = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, client: document.scrollingElement.clientHeight }));
      assert.ok(doc.scroll <= doc.client, width + 'px the page itself does not scroll: ' + JSON.stringify(doc));
      // One Status filter; the two old ones are gone.
      assert.equal(await page.getByLabel('Booking status').count() + (await page.getByLabel('Search status').count()), 0, 'the old status dropdowns are gone');
      const status = page.getByLabel('Status', { exact: true });
      assert.equal(await status.count(), 1, 'one Status control');
      // The Status filter filters the queue rows live...
      const rows = () => page.locator('[aria-label$=" queue"] tbody tr').count();
      const all = await rows();
      assert.ok(all >= 3, 'fixture rows');
      await status.selectOption('CANCELLED');
      await page.waitForFunction(() => document.querySelectorAll('[aria-label$=" queue"] tbody tr').length === 0 || document.body.innerText.includes('No bookings match this view'));
      assert.equal(await rows(), 0, 'Cancelled shows none of today');
      await status.selectOption('ALL');
      assert.equal(await rows(), all, 'All brings them back');
      // ... and rides along with a search.
      await page.getByLabel('Name, phone, last 4 digits or reference').fill('ZEUS-Q00002');
      await status.selectOption('PENDING');
      await page.getByRole('button', { name: 'Search bookings' }).click();
      const result = page.locator('section', { has: page.getByRole('heading', { name: 'Find bookings' }) }).locator('table tbody tr').first();
      await result.waitFor();
      assert.ok(searches.some((s) => s.body && JSON.parse(s.body).status?.[0] === 'PENDING' && JSON.parse(s.body).q === 'ZEUS-Q00002'), 'the search sent the one Status');
      assert.match(await result.innerText(), /ZEUS-Q00002/);
      // Results sit under the form, above the tiles; the tiles and queues are still there.
      assert.ok((await y(result)) < (await y(tile)), width + 'px results come before the tiles');
      assert.ok(await tile.isVisible() || (await tile.count()) === 1, 'tiles still on the page');
      assert.ok((await rows()) >= 0);
      // A result row opens the booking details.
      await result.getByRole('button', { name: /ZEUS-Q00002/ }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('Booking details').waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await shot(page, `p135-${process.env.P135_PHASE || 'after'}-results-${width}`);
      // Clear search clears only the results.
      await page.getByRole('button', { name: 'Clear search' }).click();
      await page.waitForFunction(() => !document.body.innerText.includes('Clear search'));
      assert.equal(await page.getByRole('button', { name: 'Clear search' }).count(), 0);
      assert.equal(await rows(), all, 'the queues are untouched by Clear search');
      await page.goto('about:blank');
      await context.unrouteAll({ behavior: 'ignoreErrors' });
      await context.close();
    }
    assert.deepEqual(errors, [], 'no page error');
  } finally {
    await browser.close();
  }
});

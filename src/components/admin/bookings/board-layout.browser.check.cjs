/* eslint-disable @typescript-eslint/no-require-imports */
// P1-22 / P1-25 real-browser regression, restated for the P1-62 container board (the per-type rows, their one-line scrolling and the empty-column
// card-height rule are gone). Same environment as bay-controls.browser.check.cjs; never loads .env. The fixture day needs cards and an empty bay.
// Optional: P122_LAYOUT_SCREENSHOTS (directory).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('Board day sits right of the view switch from lg; Waiting, containers and Done sit side by side from lg and one at a time below; bays in a container share a height; empty bays keep a visible slot', { timeout: 90_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // A loopback connection reset is the harness proxy's, not the page's: retry a GET/HEAD at most twice and log it.
    // HTTP status failures and every other error still pass straight through.
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const retryable = ['GET', 'HEAD'].includes(request.method());
      let response;
      for (let attempt = 0; !response; attempt++) {
        try {
          response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.126' } });
        } catch (error) {
          if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
          console.log('proxy retry ' + (attempt + 1) + '/2 after ' + error.message.split('\n')[0] + ': ' + request.method() + ' ' + request.url());
        }
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
    await page.getByLabel('Board day').waitFor();
    await page.locator('section[data-board-zone="WAITING"] article').first().waitFor();
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      // The dashboard frame is one screen tall and only #admin-content scrolls: the page itself
      // never scrolls, and a wheel outside the board (or past its end) leaves the frame in place.
      const pageScroll = () => page.evaluate(() => ({
        scrollY: window.scrollY, height: document.scrollingElement.scrollHeight, client: document.scrollingElement.clientHeight,
        header: Math.round(document.querySelector('header').getBoundingClientRect().top),
      }));
      const still = (s, where) => {
        assert.ok(s.height <= s.client, width + 'px ' + where + ': the page itself cannot scroll: ' + JSON.stringify(s));
        assert.equal(s.scrollY, 0, width + 'px ' + where + ': the page stays at the top');
        assert.ok(s.header >= 0, width + 'px ' + where + ': the header stays in place: ' + s.header);
      };
      still(await pageScroll(), 'at rest');
      const nav = page.locator('#admin-nav');
      const outside = (await nav.isVisible()) ? await nav.boundingBox() : await page.locator('header').first().boundingBox();
      await page.mouse.move(outside.x + outside.width / 2, outside.y + Math.min(outside.height - 4, 60));
      for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 600);
      await page.waitForTimeout(150);
      still(await pageScroll(), 'after a wheel over the ' + ((await nav.isVisible()) ? 'sidebar' : 'top bar'));
      const contentBox = await page.locator('#admin-content').boundingBox();
      await page.mouse.move(contentBox.x + contentBox.width / 2, contentBox.y + contentBox.height - 20);
      for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 800);
      await page.waitForTimeout(150);
      assert.ok(await page.locator('#admin-content').evaluate((el) => el.scrollTop > 0 || el.scrollHeight <= el.clientHeight), width + 'px the board itself scrolls');
      still(await pageScroll(), 'after a wheel past the end of the board');
      await page.locator('#admin-content').evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(100);
      const m = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
        const content = document.querySelector('#admin-content');
        const tab = document.querySelector('[aria-label="Bay board sections"]');
        const day = document.querySelector('input[aria-label="Board day"]');
        const refresh = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Refresh board');
        const columns = [...document.querySelectorAll('section[data-board-column]')]
          .filter((c) => c.offsetParent !== null)
          .map((c) => ({ label: c.getAttribute('aria-label'), row: c.closest('article').getAttribute('aria-label'), cards: c.querySelectorAll('article').length, ...box(c) }));
        const zones = ['WAITING', 'BAYS', 'DONE'].map((z) => { const el = document.querySelector('[data-board-zone="' + z + '"]'); return { z, shown: el.getClientRects().length > 0, ...(el.getClientRects().length ? box(el) : {}) }; });
        const tallestCard = Math.max(0, ...[...document.querySelectorAll('[data-board-zone] article')].filter((a) => a.getClientRects().length).map((a) => a.getBoundingClientRect().height));
        return { scroll: content.scrollWidth, client: content.clientWidth, tab: box(tab), day: box(day), refresh: box(refresh), columns, zones, tallestCard };
      });
      assert.ok(m.scroll <= m.client, width + 'px no sideways scroll: ' + JSON.stringify({ scroll: m.scroll, client: m.client }));
      if (width >= 1024) {
        assert.ok(m.day.left >= m.tab.right, width + 'px Board day is right of the view switch');
        assert.ok(Math.abs(m.day.bottom - m.tab.bottom) <= 2, width + 'px Board day shares the switch row: ' + JSON.stringify({ day: m.day, tab: m.tab }));
        assert.ok(m.refresh.left >= m.day.right && Math.abs(m.refresh.bottom - m.tab.bottom) <= 2, width + 'px Refresh board follows Board day on the same row');
      } else {
        assert.ok(m.day.top >= m.tab.bottom, width + 'px Board day wraps below the view switch');
      }
      assert.ok(m.tallestCard > 0, 'fixture needs at least one card');
      const empty = m.columns.filter((c) => c.cards === 0);
      assert.ok(empty.length > 0, 'fixture needs at least one empty bay');
      const shown = m.zones.filter((z) => z.shown);
      if (width >= 1024) {
        assert.deepEqual(shown.map((z) => z.z), ['WAITING', 'BAYS', 'DONE'], width + 'px all three zones are side by side');
        assert.ok(shown[0].right <= shown[1].left && shown[1].right <= shown[2].left, width + 'px left to right: ' + JSON.stringify(shown));
        assert.ok(Math.abs(shown[0].top - shown[1].top) <= 2 && Math.abs(shown[2].top - shown[1].top) <= 2, width + 'px the three zones start on one line: ' + JSON.stringify(shown));
      } else {
        assert.equal(shown.length, 1, width + 'px one zone at a time below lg: ' + JSON.stringify(shown));
      }
      // Bays of one container that sit on one line share a height (the grid stretches them).
      const lines = new Map();
      for (const c of m.columns) lines.set(c.row + '@' + Math.round(c.top), [...(lines.get(c.row + '@' + Math.round(c.top)) ?? []), c]);
      for (const [key, line] of lines) {
        const heights = line.map((c) => c.height);
        assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, width + 'px ' + key + ' bays share one height: ' + JSON.stringify(line.map((c) => [c.label, Math.round(c.height)])));
      }
      for (const c of empty) assert.ok(c.height >= 96, width + 'px empty ' + c.label + ' keeps a visible slot: ' + Math.round(c.height));
      if (process.env.P122_LAYOUT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.P122_LAYOUT_SCREENSHOTS, width + '-layout.png') });
    }
    // The switch moves between the Kanban toolbar and bay setup, so keyboard focus must follow it.
    await page.setViewportSize({ width: 1280, height: 900 });
    const view = page.getByRole('group', { name: 'Bay board sections' });
    const focused = (name) => view.getByRole('button', { name, exact: true }).evaluate((el) => document.activeElement === el);
    await view.getByRole('button', { name: 'Bays', exact: true }).focus();
    await page.keyboard.press('Enter');
    await view.getByRole('button', { name: 'Bays', exact: true, pressed: true }).waitFor();
    assert.equal(await page.getByLabel('Board day').count(), 0, 'Board day shows only in Kanban view');
    assert.equal(await focused('Bays'), true, 'focus stays on Bays after switching');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await page.getByLabel('Board day').waitFor();
    assert.equal(await focused('Kanban'), true, 'focus stays on Kanban after switching back');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

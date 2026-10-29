/* eslint-disable @typescript-eslint/no-require-imports */
// P1-22 real-browser regression (LE 2026-10-29). Same environment as bay-controls.browser.check.cjs;
// never loads .env. The fixture day needs at least one card and at least one empty column.
// Optional: P122_LAYOUT_SCREENSHOTS (directory).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('Board day sits right of the view switch from lg; row columns share one height; empty columns keep a card height from lg', { timeout: 90_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.equal(upstream.origin, process.env.P120_BROWSER_ORIGIN);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.126' } });
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
    await page.locator('section[aria-label$=" row"] article').first().waitFor();
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
        const columns = [...document.querySelectorAll('section[aria-label$=" row"] section[aria-label]')]
          .filter((c) => c.offsetParent !== null)
          .map((c) => ({ label: c.getAttribute('aria-label'), row: c.closest('section[aria-label$=" row"]').getAttribute('aria-label'), cards: c.querySelectorAll('article').length, ...box(c) }));
        const tallestCard = Math.max(0, ...[...document.querySelectorAll('section[aria-label$=" row"] article')].map((a) => a.getBoundingClientRect().height));
        return { scroll: content.scrollWidth, client: content.clientWidth, tab: box(tab), day: box(day), refresh: box(refresh), columns, tallestCard };
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
      assert.ok(empty.length > 0, 'fixture needs at least one empty column');
      if (width >= 768) {
        const lines = new Map();
        for (const c of m.columns) {
          const key = c.row + '@' + Math.round(c.top);
          lines.set(key, [...(lines.get(key) ?? []), c]);
        }
        for (const [key, line] of lines) {
          const heights = line.map((c) => c.height);
          assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, width + 'px ' + key + ' columns share one height: ' + JSON.stringify(line.map((c) => [c.label, Math.round(c.height)])));
        }
        if (width >= 1024) {
          for (const c of empty) assert.ok(c.height >= m.tallestCard, width + 'px empty ' + c.label + ' keeps at least one card height: ' + Math.round(c.height) + ' < ' + Math.round(m.tallestCard));
        } else {
          // At md the sidebar leaves one column per line: nothing to line up, so the slot stays short.
          for (const c of empty) {
            assert.ok(c.height >= 96, width + 'px empty ' + c.label + ' keeps a visible slot: ' + Math.round(c.height));
            if (lines.get(c.row + '@' + Math.round(c.top)).length === 1)
              assert.ok(c.height < m.tallestCard, width + 'px empty ' + c.label + ' alone on its line is not card height: ' + Math.round(c.height) + ' >= ' + Math.round(m.tallestCard));
          }
        }
      } else {
        for (const c of empty) assert.ok(c.height >= 96, width + 'px empty ' + c.label + ' keeps a visible slot: ' + Math.round(c.height));
      }
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

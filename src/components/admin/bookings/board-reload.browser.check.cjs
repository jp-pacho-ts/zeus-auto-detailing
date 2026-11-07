/* eslint-disable @typescript-eslint/no-require-imports */
// P1-62b real-browser check (review F2): what the retired board-scroll check covered and the container board still promises. A board reload (window focus, Refresh board)
// keeps the lanes mounted and the scroll position where it was, and at 200% zoom nothing goes sideways and the page itself does not scroll. Fixture:
// src/server/admin/board-browser.fixture.ts (loopback, synthetic, never .env). Env as containers.browser.check.cjs. The check writes nothing, but use a fresh database anyway.
// 200% zoom is emulated as half the CSS viewport at twice the device scale: that is the layout a browser gives at 200%.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
const origin = new URL(process.env.P120_APP_ORIGIN).origin;
let browser;

async function signIn(contextOptions, label, errors) {
  const context = await browser.newContext(contextOptions);
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin + '/')) return route.abort();
    const retryable = ['GET', 'HEAD'].includes(request.method());
    let response;
    for (let attempt = 0; !response; attempt++) {
      try {
        response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.163' } });
      } catch (error) {
        if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
      }
    }
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(label + ': ' + e.message));
  await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Staff Email or ID').fill(process.env.P120_TEST_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
  const menu = page.locator('button[aria-controls=admin-nav]');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
  await page.getByLabel('Board day').waitFor();
  await page.locator('[data-board-zone] article').first().waitFor({ state: 'attached' });
  return { context, page };
}

test.before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
});
test.after(async () => { await browser?.close(); });

test('a reload from window focus and from Refresh board keeps the lanes mounted and the scroll position', { timeout: 120_000 }, async () => {
  const errors = [];
  const { context, page } = await signIn({ viewport: { width: 1280, height: 700 } }, 'reload', errors);
  // Hold each board answer so the sampling below really sees the time the reload is running.
  let hold = null;
  await page.route(/\/api\/admin\/board\?/, async (route) => { if (hold) await hold; await route.fallback(); });
  const scrolled = await page.locator('#admin-content').evaluate((el) => { el.scrollTop = 300; return { top: el.scrollTop, room: el.scrollHeight - el.clientHeight }; });
  assert.ok(scrolled.room > 0 && scrolled.top > 0, 'the fixture board is taller than the frame: ' + JSON.stringify(scrolled));
  await page.evaluate(() => {
    // Sample every frame: the fewest zones and cards ever on screen, and whether these very elements were ever replaced.
    window.__sample = { zones: 99, cards: 99, top: [] };
    window.__marked = [...document.querySelectorAll('[data-board-zone]')];
    const tick = () => {
      const s = window.__sample;
      s.zones = Math.min(s.zones, document.querySelectorAll('[data-board-zone]').length);
      s.cards = Math.min(s.cards, document.querySelectorAll('[data-board-zone] article').length);
      s.top.push(document.getElementById('admin-content').scrollTop);
      window.__raf = requestAnimationFrame(tick);
    };
    tick();
  });
  const cardsBefore = await page.locator('[data-board-zone] article').count();
  const reloads = [
    ['window focus', () => page.evaluate(() => window.dispatchEvent(new Event('focus')))],
    // A DOM click, not a mouse click: a mouse click would scroll the button into view and hide a real regression.
    ['Refresh board', () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Refresh board').click())],
  ];
  for (const [label, start] of reloads) {
    let release;
    hold = new Promise((resolve) => { release = resolve; });
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/board' && r.status() === 200);
    await start();
    await page.waitForTimeout(300);
    release();
    await answered;
    hold = null;
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({ ...window.__sample, top: [...new Set(window.__sample.top)], connected: window.__marked.every((el) => el.isConnected) }));
    assert.equal(r.zones, 3, `${label}: the three zones never left the page`);
    assert.equal(r.cards, cardsBefore, `${label}: no card left the page during the reload`);
    assert.equal(r.connected, true, `${label}: the lanes are the same elements, not rebuilt`);
    assert.deepEqual(r.top, [scrolled.top], `${label}: the scroll position never moved`);
  }
  await page.evaluate(() => cancelAnimationFrame(window.__raf));
  assert.deepEqual(errors, []);
  await context.close();
});

test('at 200% zoom nothing goes sideways, the page itself does not scroll, and one zone shows at a time', { timeout: 120_000 }, async () => {
  const errors = [];
  for (const [width, height] of [[640, 450], [720, 450]]) {
    const { context, page } = await signIn({ viewport: { width, height }, deviceScaleFactor: 2 }, width + 'px', errors);
    const tabs = page.getByRole('group', { name: 'Board area' });
    await tabs.waitFor();
    for (const [tab, zone] of [['Waiting', 'WAITING'], ['Bays', 'BAYS'], ['Done', 'DONE']]) {
      await tabs.getByRole('button', { name: new RegExp('^' + tab) }).click();
      const m = await page.evaluate(() => {
        const c = document.getElementById('admin-content'), s = document.scrollingElement;
        const right = c.getBoundingClientRect().right;
        const shown = ['WAITING', 'BAYS', 'DONE'].filter((z) => document.querySelector(`[data-board-zone="${z}"]`).getClientRects().length > 0);
        // A control that runs off the right edge is cut off even when the frame itself hides the overflow.
        const cut = [...c.querySelectorAll('button, select, input')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > right + 1).map((el) => (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 40));
        return { scroll: c.scrollWidth, client: c.clientWidth, docH: s.scrollHeight, winH: s.clientHeight, docW: s.scrollWidth, winW: s.clientWidth, scrollY: window.scrollY, shown, cut };
      });
      const where = `${width}px at 2x, ${tab}`;
      assert.deepEqual(m.shown, [zone], `${where}: only its zone shows`);
      assert.ok(m.scroll <= m.client, `${where}: no sideways scroll in the frame: ${m.scroll} > ${m.client}`);
      assert.ok(m.docW <= m.winW, `${where}: no sideways scroll on the page: ${m.docW} > ${m.winW}`);
      assert.ok(m.docH <= m.winH && m.scrollY === 0, `${where}: the page itself cannot scroll: ${m.docH} > ${m.winH}`);
      assert.deepEqual(m.cut, [], `${where}: no control is cut off`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
});

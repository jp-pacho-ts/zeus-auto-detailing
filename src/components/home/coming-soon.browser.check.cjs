/* eslint-disable @typescript-eslint/no-require-imports */
// Standalone built-app regression; never opens a live host or reads dotenv.
// Required: PLAYWRIGHT_MODULE, P121_UPSTREAM (loopback), P121_APP_ORIGIN (synthetic HTTPS),
// P121_EVIDENCE_DIR. Optional: P121_CHROME_EXECUTABLE, P121_SOURCE_SHA.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('temporary homepage: responsive, settled motion, reduced-motion/no-JS, contact and unaffected routes', { timeout: 120000 }, async () => {
  const upstream = new URL(process.env.P121_UPSTREAM);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'loopback only');
  assert.equal(upstream.origin, process.env.P121_UPSTREAM);
  assert.equal(upstream.username + upstream.password, '');
  const origin = new URL(process.env.P121_APP_ORIGIN).origin;
  assert.equal(new URL(origin).protocol, 'https:');
  const out = process.env.P121_EVIDENCE_DIR;
  assert.ok(out, 'explicit evidence directory required');
  fs.mkdirSync(out, { recursive: true });
  const results = { source: process.env.P121_SOURCE_SHA, widths: [], routes: [], errors: [], checks: [] };
  const browser = await chromium.launch({ headless: true, ...(process.env.P121_CHROME_EXECUTABLE ? { executablePath: process.env.P121_CHROME_EXECUTABLE } : {}) });
  async function context(options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
    await ctx.route('**/*', async route => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), timeout: 30000, maxRedirects: 0 });
      await route.fulfill({ response });
    });
    return ctx;
  }
  async function readable(page) {
    await page.getByRole('heading', { name: /Coming soon/ }).waitFor();
    assert.equal(await page.locator('main').count(), 1);
    assert.equal(await page.locator('nav').count(), 0);
    assert.equal(await page.locator('form').count(), 0);
    assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).opacity), '1');
    assert.ok(await page.getByRole('link', { name: /Call the shop/ }).getAttribute('href').then(href => href.startsWith('tel:')));
    assert.equal(await page.getByRole('link', { name: 'Find us on Facebook' }).getAttribute('href'), 'https://www.facebook.com/zeusautodetailingtacloban');
    assert.equal(await page.getByAltText('Zeus Auto Detailing').evaluate(el => el.complete && el.naturalWidth > 0), true);
  }
  try {
    const ctx = await context();
    const page = await ctx.newPage();
    page.on('pageerror', error => results.errors.push(error.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await readable(page);
    await page.locator('[data-home-intro="running"]').waitFor({state:'hidden'});
    assert.equal(await page.locator('[data-home-content]').evaluate(el => el.inert), false);
    results.checks.push('finite cinematic intro settles; content accessible');
    for (const [width, height] of [[390, 844], [768, 1024], [1280, 800], [1440, 900], [390, 480], [320, 640]]) {
      await page.setViewportSize({ width, height });
      const measure = await page.evaluate(() => {
        const root = document.documentElement;
        const heading = document.querySelector('h1');
        return { client: root.clientWidth, scroll: root.scrollWidth, height: root.scrollHeight, headingHeight: heading.clientHeight, headingLineHeight: parseFloat(getComputedStyle(heading).lineHeight) };
      });
      assert.ok(measure.scroll <= measure.client, `${width}x${height}: no horizontal overflow`);
      assert.ok(measure.height >= height, 'complete cinematic page remains scrollable');
      assert.ok(measure.headingHeight <= measure.headingLineHeight * 2 + 2, 'headline at most two lines');
      results.widths.push({ width, height, ...measure });
      await page.screenshot({ path: path.join(out, `${width}x${height}-after.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Zeus Auto Detailing home');
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Contact the shop/);
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Call the shop/);
    const focus = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    assert.equal(focus.style, 'solid'); assert.equal(focus.width, '3px');
    await page.screenshot({ path: path.join(out, '390-keyboard.png'), fullPage: true });
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Find us on Facebook/);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, '200% text zoom reflows');
    await page.screenshot({ path: path.join(out, '390-text-zoom.png'), fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    results.checks.push('keyboard order and visible focus; 200% text zoom; short viewport');
    results.contrast = await page.evaluate(() => {
      const luminance = value => {
        const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const main = getComputedStyle(document.querySelector('.zeus-coming-soon'));
      const call = getComputedStyle(document.querySelector('.zeus-coming-soon__call'));
      return { text: ratio(main.color, main.backgroundColor), action: ratio(call.color, call.backgroundColor) };
    });
    assert.ok(results.contrast.text >= 4.5 && results.contrast.action >= 4.5, 'text and primary action contrast');
    for (const options of [{ reducedMotion: 'reduce' }, { javaScriptEnabled: false }]) {
      const fallback = await context({ viewport: { width: 390, height: 844 }, ...options });
      const p = await fallback.newPage();
      await p.goto(origin, { waitUntil: 'networkidle' });
      await readable(p);
      if (options.reducedMotion) assert.equal(await p.locator('[data-home-intro]').getAttribute('data-home-intro'), 'idle');
      await p.screenshot({ path: path.join(out, options.reducedMotion ? '390-reduced-motion.png' : '390-no-js.png'), fullPage: true });
      await fallback.close();
    }
    results.checks.push('reduced-motion and no-JS complete content/contact');
    for (const route of ['/', '/book', '/book/manage', '/admin/login']) {
      const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, route);
      const headers = response.headers();
      assert.equal(headers['x-frame-options'], 'DENY');
      assert.equal(headers['x-content-type-options'], 'nosniff');
      assert.equal(headers['referrer-policy'], 'no-referrer');
      assert.ok(headers['content-security-policy'].includes("frame-ancestors 'none'"));
      if (route !== '/') assert.equal(await page.locator('.zeus-coming-soon').count(), 0);
      results.routes.push({ route, status: response.status(), securityHeaders: true });
    }
    const session = await page.evaluate(async () => {
      const r = await fetch('/api/admin/auth/session'); return { status: r.status, cache: r.headers.get('cache-control') };
    });
    assert.equal(session.status, 401);
    assert.match(session.cache, /no-store/);
    results.routes.push({ route: '/api/admin/auth/session', ...session });
    // Native redirect requests can bypass Playwright's synthetic-host interception.
    // Exercise this real navigation directly on the same owned loopback server.
    const guardContext = await browser.newContext();
    await guardContext.route('**/*', route => route.request().url().startsWith(upstream.origin + '/') ? route.continue() : route.abort());
    const guardPage = await guardContext.newPage();
    await guardPage.goto(upstream.origin + '/admin', { waitUntil: 'networkidle' });
    assert.ok(guardPage.url().startsWith(upstream.origin + '/admin/login'), 'protected admin redirects unauthenticated visitors to login');
    await guardPage.getByLabel('Staff Email or ID').waitFor();
    await guardContext.close();
    results.checks.push('protected admin remains guarded');
    assert.deepEqual(results.errors, []);
  } finally {
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
});

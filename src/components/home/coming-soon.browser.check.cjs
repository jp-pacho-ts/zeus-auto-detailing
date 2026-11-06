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
    assert.equal(await page.getByRole('link', { name: 'Book now' }).getAttribute('href'), '/book');
    assert.equal(await page.getByRole('link', { name: 'Manage booking' }).getAttribute('href'), '/book/manage');
    // The Call icon sits in the social row; Book now and Manage booking share one pill, side by side at the same height.
    assert.equal(await page.locator('.zeus-social a[href^="tel:"]').count(), 1);
    const pair = await page.evaluate(() => {
      const [a, b] = ['/book', '/book/manage'].map(href => document.querySelector('.zeus-actions a[href="' + href + '"]').getBoundingClientRect());
      const gap = b.left - a.right;
      const [x, y] = [...document.querySelectorAll('.zeus-actions a')].map(el => getComputedStyle(el));
      return { sameHeight: Math.abs(a.height - b.height) < 0.5, sameRow: Math.abs(a.top - b.top) < 0.5, gap: gap >= 8 && gap <= 16, tall: a.height >= 48 && b.height >= 48, sameRadius: x.borderTopLeftRadius === y.borderTopLeftRadius, sameType: x.fontSize === y.fontSize, glow: x.boxShadow !== 'none' && y.boxShadow !== 'none', merged: !!document.querySelector('.zeus-actions').style.background || getComputedStyle(document.querySelector('.zeus-actions')).backgroundImage !== 'none' };
    });
    assert.deepEqual(pair, { sameHeight: true, sameRow: true, gap: true, tall: true, sameRadius: true, sameType: true, glow: true, merged: false });
    // P1-57: both buttons animate (edge sweep and glow pulse), except when the visitor prefers reduced motion (checked by the caller).
    const names = await page.locator('.zeus-actions a').evaluateAll(els => els.map(el => getComputedStyle(el).animationName));
    return names.every(name => name.includes('zeus-edge-spin') && name.includes('zeus-glow-breathe')) ? 'animated' : names.join('|');
    assert.equal(await page.getByRole('link', { name: 'Zeus Auto Detailing on Facebook' }).getAttribute('href'), 'https://www.facebook.com/zeusautodetailingtacloban');
    assert.equal(await page.getByRole('link', { name: 'Zeus Auto Detailing on Instagram' }).getAttribute('href'), 'https://www.instagram.com/zeus.otodetailing');
    assert.equal(await page.getByAltText('Zeus Auto Detailing').evaluate(el => el.complete && el.naturalWidth > 0), true);
  }
  try {
    const ctx = await context();
    const page = await ctx.newPage();
    page.on('pageerror', error => results.errors.push(error.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(await readable(page), 'animated', 'both buttons animate by default');
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
    // P1-33: the header bar is gone, so the first stop is the Call button. P1-46: then the Facebook and Instagram icons (named by
    // aria-label, since they have no visible text), then the address. The Call link's spoken name carries the number.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Book now');
    const focus = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    assert.equal(focus.style, 'solid'); assert.equal(focus.width, '3px');
    await page.screenshot({ path: path.join(out, '390-keyboard.png'), fullPage: true });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Manage booking');
    // P1-56: the Call link is now the first icon in the social row; its spoken name carries the number.
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /^Call the shop 0930 016 2234$/);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Zeus Auto Detailing on Facebook');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Zeus Auto Detailing on Instagram');
    await page.keyboard.press('Tab');
    // P1-47: the address is the location icon, named with the address.
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Zeus Auto Detailing location: Brgy 95 Caibaan, Tacloban City');
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
      // P1-57: Book now is dark text on the gold face (darkest stop #c58b1b); Manage booking is a light label on the dark fill (#100f0d).
      const book = getComputedStyle(document.querySelector('.zeus-btn--primary'));
      const manage = getComputedStyle(document.querySelector('.zeus-btn:not(.zeus-btn--primary)'));
      return { text: ratio(main.color, main.backgroundColor), action: Math.min(ratio(book.color, 'rgb(197,139,27)'), ratio(manage.color, 'rgb(16,15,13)')) };
    });
    assert.ok(results.contrast.text >= 4.5 && results.contrast.action >= 4.5, 'text and primary action contrast');
    for (const options of [{ reducedMotion: 'reduce' }, { javaScriptEnabled: false }]) {
      const fallback = await context({ viewport: { width: 390, height: 844 }, ...options });
      const p = await fallback.newPage();
      await p.goto(origin, { waitUntil: 'networkidle' });
      const edge = await readable(p);
      if (options.reducedMotion) assert.equal(edge, 'none|none', 'both buttons are static with reduced motion');
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

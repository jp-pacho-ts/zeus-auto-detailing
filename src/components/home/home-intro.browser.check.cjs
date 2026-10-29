/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser regression. Loopback application only; synthetic data, no dotenv.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('homepage intro: first session, replay prevention, accessibility and failure recovery', { timeout: 180000 }, async () => {
  const base = new URL(process.env.P126_UPSTREAM);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'loopback only');
  assert.equal(base.origin, process.env.P126_UPSTREAM);
  assert.equal(base.username + base.password, '');
  const out = process.env.P126_EVIDENCE_DIR;
  assert.ok(out, 'explicit evidence directory');
  fs.mkdirSync(out, { recursive: true });
  const results = { source: process.env.P126_SOURCE_SHA, checks: [], widths: [], errors: [] };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.P126_CHROME_EXECUTABLE });
  async function context(options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
    await ctx.route('**/*', route => route.request().url().startsWith(base.origin + '/') ? route.continue() : route.abort());
    return ctx;
  }
  async function settled(page) {
    await page.locator('[data-home-intro="running"]').waitFor({ state: 'hidden', timeout: 9000 });
    assert.equal(await page.locator('[data-home-content]').evaluate(el => el.inert), false);
    assert.equal(await page.locator('[data-home-curtain]').isVisible(), false);
    assert.equal(await page.locator('[data-home-intro] .word').count(), 0, 'SplitType reverted');
    await page.getByRole('heading', { name: 'Coming soon', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Call the shop/ }).getAttribute('href'), 'tel:+639300162234');
    assert.ok(await page.getByRole('link', { name: 'Find us on Facebook' }).isVisible());
    assert.equal(await page.locator('main').count(), 1);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('[data-home-content]').evaluate(el => getComputedStyle(el).transform), 'none');
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).overflowY), 'visible');
  }
  try {
    const ctx = await context();
    const page = await ctx.newPage();
    page.on('pageerror', error => results.errors.push(error.message));
    await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-home-intro="running"]').waitFor();
    assert.equal(await page.locator('[data-home-content]').evaluate(el => el.inert), true);
    assert.equal(await page.locator('[data-home-curtain]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('zeus.home.intro.v1')), 'seen');
    await page.waitForTimeout(500);
    assert.ok(await page.locator('[data-home-intro] .word').count() > 0, 'SplitType is active during intro');
    await page.screenshot({ path: path.join(out, '1440-intro.png') });
    await settled(page);
    results.checks.push('fresh session: finite GSAP intro, SplitType active then reverted; content unlocked');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-home-intro]').getAttribute('data-home-intro'), 'idle', 'reload bypasses');
    await settled(page);
    for (const [width, height] of [[390, 844], [768, 1024], [1280, 800], [1440, 900], [320, 640], [390, 480]]) {
      await page.setViewportSize({ width, height });
      const measure = await page.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(measure.scroll <= measure.client, `${width}x${height}: no overflow`);
      assert.ok(await page.locator('.zeus-coming-soon__logo').evaluate(el => el.complete && el.naturalWidth > 0));
      results.widths.push({ ...measure, height });
      await page.screenshot({ path: path.join(out, `${width}x${height}-after.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '200% text zoom reflows');
    await page.screenshot({ path: path.join(out, '390-text-zoom.png'), fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    for (const route of ['/book', '/book/manage', '/admin/login']) {
      const response = await page.goto(base.origin + route, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      assert.equal(await page.locator('[data-home-intro]').count(), 0, `${route}: no intro`);
    }
    await page.goto(base.origin, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-home-intro]').getAttribute('data-home-intro'), 'idle', 'revisit bypasses');
    await settled(page);
    results.checks.push('reload/revisit bypass; 6 viewports, 200% text zoom; booking/staff routes isolated');
    const separateTab = await ctx.newPage();
    await separateTab.goto(base.origin, {waitUntil:'domcontentloaded'});
    await separateTab.locator('[data-home-intro="running"]').waitFor();
    await separateTab.goto(base.origin + '/admin/login', {waitUntil:'networkidle'});
    assert.equal(await separateTab.locator('[data-home-intro]').count(), 0);
    assert.equal(await separateTab.locator('body').evaluate(el => getComputedStyle(el).overflowY), 'visible');
    await separateTab.goto(base.origin, {waitUntil:'networkidle'});
    assert.equal(await separateTab.locator('[data-home-intro]').getAttribute('data-home-intro'), 'idle');
    await separateTab.close();
    results.checks.push('independent tab plays; navigation during intro cleans up; return bypasses');
    await ctx.close();

    const fresh = await context({ viewport: { width: 390, height: 844 } });
    const mobile = await fresh.newPage();
    await mobile.goto(base.origin, { waitUntil: 'domcontentloaded' });
    await mobile.locator('[data-home-intro="running"]').waitFor();
    await mobile.waitForTimeout(500);
    await mobile.screenshot({ path: path.join(out, '390-intro.png') });
    await mobile.keyboard.press('Tab');
    assert.equal(await mobile.evaluate(() => document.activeElement.textContent), 'Skip intro');
    await mobile.keyboard.press('Escape');
    await settled(mobile);
    await mobile.keyboard.press('Tab');
    assert.ok(await mobile.evaluate(() => !document.activeElement.closest('[data-home-curtain]')), 'keyboard reaches content');
    await fresh.close();
    results.checks.push('new independent session plays; mobile keyboard Skip/Escape works');

    for (const mode of ['reduced', 'no-js', 'storage-denied', 'image-failure', 'script-failure', 'font-failure', 'animation-failure']) {
      const fallback = await context({ viewport: { width: 390, height: 844 }, ...(mode === 'reduced' ? { reducedMotion: 'reduce' } : {}), ...(mode === 'no-js' ? { javaScriptEnabled: false } : {}) });
      if (mode === 'storage-denied') await fallback.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
        Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
      });
      if (['image-failure', 'script-failure', 'font-failure'].includes(mode)) await fallback.route('**/*', route => { const r = route.request(); return (mode === 'image-failure' && r.resourceType() === 'image' || mode === 'script-failure' && r.resourceType() === 'script' || mode === 'font-failure' && /\.(ttf|woff2?)(\?|$)/.test(r.url())) ? route.abort() : r.url().startsWith(base.origin + '/') ? route.continue() : route.abort(); });
      if (mode === 'animation-failure') {
        assert.ok(process.env.P126_ANIMATION_CHUNK, 'actual animation chunk identified');
        await fallback.route('**/' + process.env.P126_ANIMATION_CHUNK, route => route.abort());
      }
      const p = await fallback.newPage();
      await p.goto(base.origin, { waitUntil: mode === 'image-failure' ? 'domcontentloaded' : 'networkidle' });
      if (mode === 'image-failure') await p.locator('[data-home-intro="running"]').waitFor();
      // P1-26 F2: with every script blocked, the inline pre-paint curtain stays until its CSS fallback (<=4s).
      if (mode === 'script-failure') await p.locator('[data-home-curtain]').waitFor({ state: 'hidden', timeout: 4500 });
      await settled(p);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), mode + ': no overflow');
      if (!['image-failure', 'font-failure'].includes(mode)) assert.equal(await p.locator('[data-home-intro]').getAttribute('data-home-intro'), 'idle');
      await p.screenshot({ path: path.join(out, `390-${mode}.png`), fullPage: true });
      await fallback.close();
      results.checks.push(`${mode}: usable content, no curtain/scroll/focus lock`);
    }
    const interrupt = await context();
    const p = await interrupt.newPage();
    await p.goto(base.origin, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-home-intro="running"]').waitFor();
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await settled(p);
    await p.goto(base.origin + '/admin/login', { waitUntil: 'networkidle' });
    assert.equal(await p.locator('[data-home-intro]').count(), 0);
    await interrupt.close();
    results.checks.push('preference changes interrupt immediately; navigation has no global residue');
    assert.deepEqual(results.errors, []);
  } finally {
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
});

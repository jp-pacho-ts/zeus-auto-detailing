/* eslint-disable @typescript-eslint/no-require-imports */
// P1-26 review fixes (F1-F3, F5, F6): real browser regressions against a production build served by `next start`,
// so the app's own security headers (CSP) apply. Loopback application only; synthetic data, no dotenv.
// Required: PLAYWRIGHT_MODULE, P126_UPSTREAM (loopback origin), P126_EVIDENCE_DIR, P126_ANIMATION_CHUNK.
// Optional: P126_CHROME_EXECUTABLE, P126_SOURCE_SHA.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.P126_UPSTREAM || 'http://invalid');
const out = process.env.P126_EVIDENCE_DIR;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withBrowser(fn) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'loopback only');
  assert.equal(base.origin, process.env.P126_UPSTREAM);
  assert.equal(base.username + base.password, '');
  assert.ok(out, 'explicit evidence directory');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.P126_CHROME_EXECUTABLE });
  try { await fn(browser); } finally { await browser.close(); }
}
// Only the loopback app is reachable. `hold` delays matching requests (the app's JavaScript) without failing them.
async function context(browser, { hold, block, ...options } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(base.origin + '/')) return route.abort();
    if (block && block(route.request())) return route.abort();
    if (hold && hold.test(url)) await delay(hold.ms);
    return route.continue().catch(() => {});
  });
  return ctx;
}
const appScripts = ms => Object.assign(/\/_next\/static\/chunks\//, { ms });
// Records every value of the intro state, so an intro that starts late can't slip between two polls.
const recordIntroStates = () => {
  window.__introStates = [];
  new MutationObserver(records => records.forEach(r => window.__introStates.push(r.target.getAttribute('data-home-intro'))))
    .observe(document, { attributes: true, attributeFilter: ['data-home-intro'], subtree: true });
};
async function curtainState(page) {
  return page.evaluate(() => {
    const curtain = document.querySelector('[data-home-curtain]');
    const content = document.querySelector('[data-home-content]');
    const style = getComputedStyle(curtain);
    return {
      prepaint: document.getElementById('zeus-home-intro-pending') ? 'pending' : null,
      curtainShown: style.display !== 'none' && style.visibility !== 'hidden',
      curtainBackground: style.backgroundColor,
      contentVisibility: getComputedStyle(content).visibility,
    };
  });
}

test('F2: fresh session shows the black curtain from the first frame, before the app script loads; focus stays out of hidden content', { timeout: 120000 }, () => withBrowser(async browser => {
  // 1s hold: long enough to inspect the pre-hydration frame, short enough for the intro to start before 3.5s.
  const ctx = await context(browser, { hold: appScripts(1000) });
  const page = await ctx.newPage();
  const response = await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
  // The real CSP applies. If it ever blocks the inline pre-paint script, the curtain assertions below fail.
  assert.match(response.headers()['content-security-policy'] ?? '', /script-src /, 'app security headers present');
  const first = await curtainState(page);
  await page.screenshot({ path: path.join(out, 'f2-1440-first-frame.png') });
  assert.equal(first.prepaint, 'pending', 'pre-paint script ran under the real CSP');
  assert.equal(first.curtainShown, true, 'curtain visible before hydration');
  assert.equal(first.curtainBackground, 'rgb(0, 0, 0)');
  assert.equal(first.contentVisibility, 'hidden', 'content hidden until the intro releases it');
  assert.equal(await page.getByRole('heading', { name: 'Coming soon' }).isVisible(), false);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip intro', 'first Tab reaches Skip');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[data-home-content]')), false, 'focus never lands in hidden content');
  await page.locator('[data-home-intro="running"]').waitFor({ timeout: 8000 });
  await page.locator('[data-home-intro="running"]').waitFor({ state: 'hidden', timeout: 9000 });
  assert.equal(await page.locator('[data-home-content]').evaluate(el => el.inert), false);
  assert.equal((await curtainState(page)).contentVisibility, 'visible');
  assert.equal(await page.evaluate(() => document.getElementById('zeus-home-intro-pending')), null, 'pending style removed');
  await ctx.close();
}));

test('F2: Escape before the app script loads releases the page at once, and the intro never starts later', { timeout: 120000 }, () => withBrowser(async browser => {
  const ctx = await context(browser, { hold: appScripts(2000) });
  await ctx.addInitScript(recordIntroStates);
  const page = await ctx.newPage();
  await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
  assert.equal((await curtainState(page)).curtainShown, true);
  await page.keyboard.press('Escape');
  const after = await curtainState(page);
  assert.equal(after.curtainShown, false, 'Escape works from the first frame');
  assert.equal(after.contentVisibility, 'visible');
  await page.waitForLoadState('networkidle');
  await delay(1500);
  assert.deepEqual(await page.evaluate(() => window.__introStates.filter(s => s === 'running')), [], 'no intro after a skip');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('zeus.home.intro.v1')), 'seen', 'skip counts as seen');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal((await curtainState(page)).curtainShown, false, 'reload after a skip shows no curtain');
  await ctx.close();
}));

test('F2: if the app script never runs, the CSS fallback releases the page within 4.5s', { timeout: 120000 }, () => withBrowser(async browser => {
  const ctx = await context(browser, { viewport: { width: 390, height: 844 }, block: request => request.resourceType() === 'script' });
  const page = await ctx.newPage();
  await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
  assert.equal((await curtainState(page)).curtainShown, true, 'inline pre-paint still runs');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-home-curtain]')).visibility === 'hidden', null, { timeout: 6000 });
  const releasedAt = await page.evaluate(() => performance.now());
  assert.ok(releasedAt <= 4500, `released at ${Math.round(releasedAt)}ms`);
  assert.equal((await curtainState(page)).contentVisibility, 'visible');
  assert.ok(await page.getByRole('link', { name: /Call the shop/ }).isVisible());
  await ctx.close();
}));

test('F2: no curtain at all for reduced motion, refused storage, a repeat visit or no JavaScript', { timeout: 120000 }, () => withBrowser(async browser => {
  for (const mode of ['reduced', 'storage-throws', 'repeat', 'no-js']) {
    const ctx = await context(browser, {
      hold: appScripts(1500),
      ...(mode === 'reduced' ? { reducedMotion: 'reduce' } : {}),
      ...(mode === 'no-js' ? { javaScriptEnabled: false } : {}),
    });
    if (mode === 'storage-throws') await ctx.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    });
    const page = await ctx.newPage();
    if (mode === 'repeat') {
      await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => sessionStorage.setItem('zeus.home.intro.v1', 'seen'));
    }
    await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
    const state = await curtainState(page);
    assert.equal(state.curtainShown, false, `${mode}: no curtain`);
    assert.equal(state.contentVisibility, 'visible', `${mode}: content readable immediately`);
    assert.ok(await page.getByRole('heading', { name: 'Coming soon' }).isVisible(), `${mode}: heading visible`);
    await ctx.close();
  }
}));

test('F5: Escape or pagehide while the motion module is still loading cancels the intro', { timeout: 120000 }, () => withBrowser(async browser => {
  assert.ok(process.env.P126_ANIMATION_CHUNK, 'actual animation chunk identified');
  for (const how of ['escape', 'pagehide']) {
    const ctx = await context(browser, { hold: Object.assign(new RegExp(process.env.P126_ANIMATION_CHUNK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { ms: 1500 }) });
    await ctx.addInitScript(recordIntroStates);
    const page = await ctx.newPage();
    const chunk = page.waitForRequest(request => request.url().includes(process.env.P126_ANIMATION_CHUNK), { timeout: 10000 });
    await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
    await chunk; // hydrated and waiting for the motion module
    if (how === 'escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await delay(2500);
    assert.deepEqual(await page.evaluate(() => window.__introStates.filter(s => s === 'running')), [], `${how}: intro cancelled`);
    assert.equal((await curtainState(page)).curtainShown, false, `${how}: curtain gone`);
    assert.equal(await page.locator('[data-home-content]').evaluate(el => el.inert), false);
    await ctx.close();
  }
}));

test('F1/F3: at 200% text nothing covers the actions and the header logo and link never touch', { timeout: 120000 }, () => withBrowser(async browser => {
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1280, 800], [1440, 900]]) {
    const ctx = await context(browser, { viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(base.origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.locator('.zeus-facebook').scrollIntoViewIfNeeded();
    const result = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const craft = box(document.querySelector('.zeus-craft'));
      const covered = [...document.querySelectorAll('.zeus-actions a')].filter(a => overlap(craft, box(a))).map(a => a.textContent);
      const link = document.querySelector('.zeus-facebook');
      const r = box(link);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const logo = box(document.querySelector('.zeus-coming-soon__logo'));
      const contact = box(document.querySelector('.zeus-home-header > div > a'));
      return {
        covered,
        facebookHit: !!hit && link.contains(hit),
        headerGap: contact.top >= logo.bottom - 1 ? 'wrapped' : contact.left - logo.right,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    await page.screenshot({ path: path.join(out, `f1-${width}-text-200.png`), fullPage: true });
    assert.deepEqual(result.covered, [], `${width}: photo covers no action`);
    assert.equal(result.facebookHit, true, `${width}: Facebook link is the element under its own centre`);
    assert.ok(result.headerGap === 'wrapped' || result.headerGap >= 8, `${width}: header gap ${result.headerGap}`);
    assert.equal(result.overflow, false, `${width}: no horizontal overflow`);
    await ctx.close();
  }
}));

test('F6: the footer shows the visitor\'s current year, not the build year', { timeout: 60000 }, () => withBrowser(async browser => {
  const ctx = await context(browser, { reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    const Real = Date;
    const fixed = Real.UTC(2031, 5, 1);
    window.Date = class extends Real { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
  });
  const page = await ctx.newPage();
  await page.goto(base.origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.zeus-coming-soon__footer').textContent.includes('© 2031'), null, { timeout: 5000 });
  await ctx.close();
}));

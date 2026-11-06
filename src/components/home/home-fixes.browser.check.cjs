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
async function context(browser, { hold, block, init, ...options } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  if (init) await ctx.addInitScript(init);
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(base.origin + '/')) return route.abort();
    if (block && block(route.request())) return route.abort();
    // `hold.gate` (a promise the test resolves) holds a request until the test says so; `hold.ms` is a fixed delay.
    if (hold && hold.test(url)) await (hold.gate ?? delay(hold.ms));
    return route.continue().catch(() => {});
  });
  return ctx;
}
// Deterministic time for tests that inspect the intro at leisure. The intro has two wall-clock inputs: the app script
// refuses to start the intro after HOME_INTRO_LATEST_START_MS of performance.now(), and the pre-paint CSS fallback is an
// animation with a 4s delay. Under load the test's own round trips can outlast both, which made these tests fail with
// no change to the product. `freezeTime` pins performance.now and pauses CSS animations from the first frame;
// `resumeTime` releases them. Nothing in the product is changed, only what the page's clock reads while the test looks.
const freezeTime = () => {
  const real = performance.now.bind(performance);
  let frozenAt = real(), offset = 0;
  performance.now = () => (frozenAt === null ? real() - offset : frozenAt);
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation-play-state:paused!important}';
  const attach = () => { if (document.documentElement) { document.documentElement.appendChild(style); return true; } return false; };
  if (!attach()) new MutationObserver((_, observer) => { if (attach()) observer.disconnect(); }).observe(document, { childList: true });
  window.__resumeTime = () => { if (frozenAt !== null) { offset += real() - frozenAt; frozenAt = null; } style.remove(); };
};
const resumeTime = page => page.evaluate(() => window.__resumeTime());
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
  // Time is frozen and the app scripts are held until this test releases them, so nothing below depends on how fast
  // the machine is: the pre-hydration frame is inspected at leisure and the intro can still start (see freezeTime).
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  // Only the JavaScript chunks are held; the stylesheet lives in the same folder and the first frame needs it.
  const ctx = await context(browser, { hold: Object.assign(/\/_next\/static\/chunks\/[^?]*\.js/, { gate }), init: freezeTime });
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
  // Release the app scripts with the clock still frozen: hydration may take as long as it takes, and the intro still
  // starts because performance.now() has not advanced. Then let time run and wait for the real end of the intro.
  release();
  await page.locator('[data-home-intro="running"]').waitFor({ timeout: 60000 });
  await resumeTime(page);
  await page.locator('[data-home-intro="running"]').waitFor({ state: 'hidden', timeout: 60000 });
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
  // The fallback is a CSS animation with a fixed 4s delay on the document timeline. Its end is read from the timeline
  // itself, in the same milliseconds since navigation start as before, not from whenever this test happened to poll:
  // under load a poll can land a second late with no change to the page (the old check saw 5137ms that way). The limit
  // is still 4500ms, and the delay and the real release are both asserted.
  const schedule = await page.evaluate(async () => {
    const names = ['zeus-intro-release', 'zeus-content-release'];
    const animations = document.getAnimations().filter(animation => names.includes(animation.animationName));
    await Promise.all(animations.map(animation => animation.ready));
    return animations.map(animation => {
      const timing = animation.effect.getComputedTiming();
      return { name: animation.animationName, delay: timing.delay, duration: timing.duration, scheduledEnd: animation.startTime + timing.endTime };
    });
  });
  assert.deepEqual(schedule.map(item => item.name).sort(), ['zeus-content-release', 'zeus-intro-release'], 'both fallback animations exist');
  for (const item of schedule) {
    assert.equal(item.delay, 4000, `${item.name}: fixed 4s delay`);
    assert.equal(item.duration, 0, `${item.name}: instant release`);
    assert.ok(item.scheduledEnd <= 4500, `${item.name}: scheduled release at ${Math.round(item.scheduledEnd)}ms`);
  }
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-home-curtain]')).visibility === 'hidden', null, { timeout: 60000 });
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

// P1-46: the links are now the Call pill, the two social icons and the address; the logo sits bottom right, so it is checked
// against the headline, the line and the Call pill (it must overlap none of them, and no link may be covered).
// P1-33: F1/F3 retargeted. The photo, the craft figure and the header bar no longer exist, so the same promise is kept
// for what replaced them: at 200% text the logo, the headline and every action stay reachable and uncovered.
// F6 (footer shows the visitor's year) is retired: the footer and its year line were removed by task design.
test('F1/F3: at 200% text the logo covers nothing, every action and contact link is the element under its own centre', { timeout: 120000 }, () => withBrowser(async browser => {
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1280, 800], [1440, 900]]) {
    const ctx = await context(browser, { viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(base.origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.locator('.zeus-social').scrollIntoViewIfNeeded();
    const result = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const logo = box(document.querySelector('.zeus-coming-soon__logo'));
      const others = ['h1', '.zeus-lede', '.zeus-actions'].map(selector => box(document.querySelector(selector)));
      const links = [...document.querySelectorAll('.zeus-actions a, .zeus-social a')];
      const unreachable = links.filter(link => {
        const r = box(link);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(hit && link.contains(hit));
      }).map(link => link.getAttribute('aria-label') || link.textContent.trim());
      return {
        unreachable,
        logoOverCopy: others.some(rect => overlap(logo, rect)),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    await page.screenshot({ path: path.join(out, `f1-${width}-text-200.png`), fullPage: true });
    assert.deepEqual(result.unreachable, [], `${width}: every link is the element under its own centre`);
    assert.equal(result.logoOverCopy, false, `${width}: the logo does not overlap the text below it`);
    assert.equal(result.overflow, false, `${width}: no horizontal overflow`);
    await ctx.close();
  }
}));

// P1-46: the cinematic layout, measured in a real browser. Logo bottom right and centred on the icons and address beside
// it; side margins; the headline as wide as the text column on phones; nothing clipped; the page itself does not scroll.
test('P1-46/47: logo bottom right and centred on the icon row, side margins, headline as wide as the text column, nothing clipped', { timeout: 240000 }, () => withBrowser(async browser => {
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [412, 915], [768, 1024], [1280, 800], [1440, 900]]) {
    const ctx = await context(browser, { viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(base.origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const one = selector => document.querySelector(selector);
      const h1 = one('h1');
      const range = document.createRange();
      range.setStart(h1.firstChild, 0);
      range.setEnd(h1.firstChild, h1.firstChild.length);
      const logo = box(one('.zeus-coming-soon__logo'));
      const icons = box(one('.zeus-social'));
      const iconLinks = [...document.querySelectorAll('.zeus-social a')].map(a => box(a));
      const call = box(one('.zeus-actions'));
      const buttons = [...document.querySelectorAll('.zeus-actions a')].map(a => box(a));
      const lede = box(one('.zeus-lede'));
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return {
        vw: innerWidth, vh: innerHeight, logo, icons, iconLinks, call, buttons, lede,
        coming: box(range) && range.getBoundingClientRect().toJSON(),
        logoOverlaps: ['h1', '.zeus-lede', '.zeus-actions'].filter(selector => overlap(logo, box(one(selector)))),
        clipped: [...document.querySelectorAll('h1,p,a,img,svg,span,strong')].filter(e => { const r = box(e); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map(e => e.tagName),
        small: [...document.querySelectorAll('a')].filter(a => { const r = box(a); return r.width < 43.5 || r.height < 43.5; }).map(a => a.getAttribute('aria-label') || a.textContent.trim()),
        scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
      };
    });
    const margin = width <= 340 ? 24 : width <= 800 ? 28 : width * 0.07;
    const column = width - 2 * margin;
    const near = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${width}: ${message} (${a.toFixed(1)} vs ${b.toFixed(1)})`);
    // P1-56: four icons leave no room for the logo beside them under 352px, so there it sits on its own row below the icons.
    if (width >= 352) {
      assert.ok(m.logo.left > width * 0.45 && m.logo.top > height * 0.65, `${width}: logo is bottom right`);
      near(m.logo.right, width - margin, 1.5, 'logo sits on the right margin');
    } else {
      assert.ok(m.logo.top >= m.icons.bottom, `${width}: logo is below the icon row`);
      near(m.logo.left, margin, 1.5, 'logo starts on the left margin');
    }
    // P1-56: Call joins as the first icon, then Facebook, Instagram and the address icon (P1-47); the row, so the row is the whole bottom block.
    assert.equal(m.iconLinks.length, 4, `${width}: Call, Facebook, Instagram and location icons`);
    assert.ok(m.iconLinks.every(link => Math.abs(link.top - m.iconLinks[0].top) < 0.5), `${width}: the four icons share one row`);
    if (width >= 352) near(m.logo.top + m.logo.height / 2, (m.icons.top + m.icons.bottom) / 2, 3, 'logo is centred on the icon row');
    near(m.icons.left, margin, 1.5, 'icons start on the left margin');
    near(m.coming.left, margin, 2, 'headline starts on the left margin');
    if (width <= 800) {
      near(m.call.left, margin, 1.5, 'action pill starts on the left margin');
      if (width <= 560) near(m.call.right, width - margin, 1.5, 'action pill ends on the right margin');
      else assert.ok(m.call.width <= 420.5, `${width}: on tablets the action pill keeps its width (${m.call.width.toFixed(0)}px)`);
      if (width <= 560) assert.ok(m.coming.width >= column * 0.95 && m.coming.width <= column + 1, `${width}: COMING is as wide as the text column (${m.coming.width.toFixed(1)} of ${column})`);
    }
    // P1-57: two separate buttons. They share a row when they fit (360 and up); at 320 they wrap to two full-width rows.
    const [bookBox, manageBox] = m.buttons;
    assert.ok(Math.abs(bookBox.height - manageBox.height) < 0.5 && bookBox.height >= 48, `${width}: equal height, 48px or more`);
    assert.ok(bookBox.left >= margin - 1.5 && manageBox.right <= width - margin + 1.5, `${width}: buttons stay inside the margins`);
    if (width >= 360) assert.ok(Math.abs(bookBox.top - manageBox.top) < 0.5 && manageBox.left - bookBox.right >= 8, `${width}: one row with a gap`);
    else assert.ok(manageBox.top >= bookBox.bottom && Math.abs(bookBox.width - manageBox.width) < 1.5, `${width}: two equal full-width rows`);
    // P1-58: on phones the buttons sit right under the paragraph (20 to 24px) and above the icon row; the icon row and the
    // logo never overlap, and the bottom block keeps clear of the bottom edge.
    if (width <= 800) {
      const gapBelowLede = bookBox.top - m.lede.bottom;
      assert.ok(gapBelowLede >= 18 && gapBelowLede <= 28, `${width}: buttons sit just under the paragraph (${gapBelowLede.toFixed(1)}px)`);
      assert.ok(manageBox.bottom < m.icons.top - 40, `${width}: buttons are well above the icon row, not crowding it`);
      assert.ok(Math.max(m.icons.bottom, m.logo.bottom) <= height - 40, `${width}: icons and logo keep clear of the bottom edge`);
      if (width >= 380) assert.ok(Math.abs(bookBox.width - manageBox.width) < 1.5, `${width}: two equal columns`);
    }
    {
      const icons = m.iconLinks[m.iconLinks.length - 1];
      const apart = m.logo.left >= icons.right + 8 || m.logo.top >= m.icons.bottom;
      assert.ok(apart, `${width}: the logo does not overlap the icon row`);
    }
    assert.deepEqual(m.logoOverlaps, [], `${width}: the logo overlaps nothing`);
    assert.deepEqual(m.clipped, [], `${width}: nothing is clipped at the sides`);
    assert.deepEqual(m.small, [], `${width}: every link is at least 44px`);
    assert.ok(m.scrollW <= width, `${width}: no sideways scroll`);
    assert.ok(m.scrollH <= height + 1, `${width}: the page does not scroll vertically (${m.scrollH} of ${height})`);
    await page.screenshot({ path: path.join(out, `p146-layout-${width}.png`) });
    await ctx.close();
  }
}));

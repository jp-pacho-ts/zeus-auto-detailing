/* eslint-disable @typescript-eslint/no-require-imports */
// P1-33: real-browser checks for the full-screen video homepage against a production build served by `next start`,
// so the app's own security headers (the real CSP) apply. Loopback application only; synthetic data, no dotenv.
// Required: PLAYWRIGHT_MODULE, P133_UPSTREAM (loopback origin), P133_EVIDENCE_DIR,
// P133_CHROME_EXECUTABLE (a Chrome with H.264; Playwright's bundled Chromium cannot play the MP4s).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.P133_UPSTREAM || 'http://invalid');
const out = process.env.P133_EVIDENCE_DIR;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const VIDEO = { phone: '/media/home/hero-720.mp4', desktop: '/media/home/hero-1080.mp4' };

async function withBrowser(fn) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'loopback only');
  assert.equal(base.origin, process.env.P133_UPSTREAM);
  assert.equal(base.username + base.password, '');
  assert.ok(out, 'explicit evidence directory');
  assert.ok(process.env.P133_CHROME_EXECUTABLE, 'a Chrome executable with H.264');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.P133_CHROME_EXECUTABLE });
  try { await fn(browser); } finally { await browser.close(); }
}
// Only the loopback app is reachable. Anything else is aborted and counted, so a stray external request fails the test.
async function context(browser, { block, hold, seen = true, init, ...options } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  ctx.external = [];
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(base.origin + '/')) { ctx.external.push(url); return route.abort(); }
    if (block && block.test(url)) return route.abort();
    if (hold && hold.test(url)) await delay(hold.ms);
    return route.continue().catch(() => {});
  });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (seen) await ctx.addInitScript(() => { try { sessionStorage.setItem('zeus.home.intro.v1', 'seen'); } catch {} });
  if (init) await ctx.addInitScript(init);
  return ctx;
}
function track(page) {
  const log = { errors: [], media: [], loadAt: null, firstMediaAt: null };
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) log.errors.push(`${message.type()}: ${message.text()}`); });
  page.on('pageerror', error => log.errors.push(`pageerror: ${error.message}`));
  page.on('load', () => { log.loadAt = Date.now(); });
  page.on('request', request => {
    if (/\.mp4(\?|$)/.test(request.url())) {
      log.media.push(new URL(request.url()).pathname);
      log.firstMediaAt ??= Date.now();
    }
  });
  return log;
}
const videoState = page => page.evaluate(() => {
  const v = document.querySelector('.zeus-hero-video');
  return { src: v.getAttribute('src'), readyState: v.readyState, time: v.currentTime, paused: v.paused, ready: v.dataset.ready ?? null, opacity: getComputedStyle(v).opacity };
});

// Worst-case contrast of the copy's text colours over what is actually behind them. The copy is hidden, the box under it
// is screenshotted (video frame + shade), and the 99th-percentile luminance of its pixels is used as the background.
async function contrastOverFrame(browser, page, file) {
  // Each text element is measured over the area its own text occupies (a Range around its contents), not its box.
  const targets = await page.evaluate(() => ['.zeus-kicker', '.zeus-pretitle', '.zeus-description p:first-child', '.zeus-description p:last-child', '.zeus-contact-line'].map(selector => {
    const el = document.querySelector(selector);
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { selector, colour: getComputedStyle(el).color, x: r.left, y: r.top, width: r.width, height: r.height };
  }));
  await page.addStyleTag({ content: '.zeus-hero-copy{visibility:hidden!important}' });
  const results = [];
  for (const target of targets) {
    const png = await page.screenshot({ clip: { x: target.x, y: target.y, width: target.width, height: target.height } });
    results.push(...await measure(browser, png, [target.colour], target.selector));
  }
  await page.screenshot({ path: file });
  await page.addStyleTag({ content: '.zeus-hero-copy{visibility:visible!important}' });
  return results;
}
async function measure(browser, png, colours, selector) {
  const probe = await browser.newPage();
  const result = await probe.evaluate(async ([data, colours]) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = 'data:image/png;base64,' + data; });
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const lum = (r, g, b) => lin(r) * .2126 + lin(g) * .7152 + lin(b) * .0722;
    const all = [];
    for (let i = 0; i < pixels.length; i += 16) all.push(lum(pixels[i], pixels[i + 1], pixels[i + 2]));
    all.sort((a, b) => a - b);
    const bg = all[Math.floor(all.length * .99)];
    return colours.map(c => {
      const [r, g, b] = c.match(/[\d.]+/g).map(Number);
      const fg = lum(r, g, b);
      return { colour: c, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
    });
  }, [png.toString('base64'), colours]);
  await probe.close();
  return result.map(item => ({ ...item, colour: `${selector} ${item.colour}` }));
}

test('video plays at 390, 768, 1280 and 1440 under the real CSP: right file only, clean console, no sideways scroll, readable text', { timeout: 240000 }, () => withBrowser(async browser => {
  for (const [width, height] of [[390, 844], [768, 1024], [1280, 800], [1440, 900]]) {
    const ctx = await context(browser, { viewport: { width, height } });
    const page = await ctx.newPage();
    const log = track(page);
    const response = await page.goto(base.origin, { waitUntil: 'load' });
    assert.match(response.headers()['content-security-policy'] ?? '', /default-src 'self'/, 'the live CSP applies');
    assert.doesNotMatch(response.headers()['content-security-policy'] ?? '', /media-src/, 'no CSP change was made for media');
    const early = await videoState(page);
    await page.waitForFunction(() => { const v = document.querySelector('.zeus-hero-video'); return v.readyState >= 3 && v.currentTime > 0.3 && v.dataset.ready === 'true'; }, null, { timeout: 15000 });
    const first = await videoState(page);
    await delay(1200);
    const second = await videoState(page);
    assert.ok(second.time > first.time, `${width}: currentTime advances (${first.time} -> ${second.time})`);
    assert.equal(second.paused, false);
    assert.equal(second.opacity, '1', `${width}: video is faded in`);
    const expected = width <= 800 ? VIDEO.phone : VIDEO.desktop;
    assert.deepEqual([...new Set(log.media)], [expected], `${width}: only ${expected} is requested`);
    assert.equal(second.src.endsWith(expected), true);
    assert.ok(log.firstMediaAt >= log.loadAt, `${width}: the video request starts after the window load event`);
    assert.equal(early.src, null, `${width}: no src at load`);
    assert.deepEqual(log.errors, [], `${width}: no console errors or warnings`);
    assert.deepEqual(await page.evaluate(() => window.__csp), [], `${width}: no CSP violations`);
    assert.deepEqual(ctx.external, [], `${width}: no external requests`);
    const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(metrics.scroll <= metrics.client, `${width}: no sideways scroll`);
    await page.screenshot({ path: path.join(out, `video-${width}-after.png`) });
    for (const ratio of await contrastOverFrame(browser, page, path.join(out, `video-${width}-under-text.png`))) {
      assert.ok(ratio.ratio >= 4.5, `${width}: ${ratio.colour} over the frame is ${ratio.ratio.toFixed(2)}:1`);
    }
    await ctx.close();
  }
}));

test('the media files answer range requests with 206 and an MP4 content type', { timeout: 60000 }, () => withBrowser(async browser => {
  const ctx = await context(browser);
  for (const file of Object.values(VIDEO)) {
    const response = await ctx.request.get(base.origin + file, { headers: { Range: 'bytes=0-99' } });
    assert.equal(response.status(), 206, file);
    assert.match(response.headers()['content-type'], /video\/mp4/, file);
    assert.match(response.headers()['content-range'], /^bytes 0-99\//, file);
  }
  await ctx.close();
}));

test('reduced motion, data-saver and 2G show only the poster: no video request at all', { timeout: 120000 }, () => withBrowser(async browser => {
  const modes = {
    'reduced motion': { options: { reducedMotion: 'reduce' } },
    'save-data': { init: () => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }) },
    '2g': { init: () => Object.defineProperty(navigator, 'connection', { value: { saveData: false, effectiveType: '2g' } }) },
  };
  for (const [name, { options, init }] of Object.entries(modes)) {
    const ctx = await context(browser, { ...options, init });
    const page = await ctx.newPage();
    const log = track(page);
    await page.goto(base.origin, { waitUntil: 'networkidle' });
    await delay(1500);
    const state = await videoState(page);
    assert.deepEqual(log.media, [], `${name}: no mp4 requested`);
    assert.equal(state.src, null, `${name}: video has no src`);
    assert.equal(state.opacity, '0', `${name}: video stays hidden`);
    const poster = await page.locator('.zeus-hero-poster').evaluate(img => ({ done: img.complete && img.naturalWidth > 0, visible: img.getBoundingClientRect().height > 0 }));
    assert.deepEqual(poster, { done: true, visible: true }, `${name}: poster shows`);
    assert.deepEqual(log.errors, [], `${name}: clean console`);
    await page.screenshot({ path: path.join(out, `video-poster-only-${name.replace(/\W+/g, '-')}.png`) });
    await ctx.close();
  }
}));

test('a phone-width poster is the 720 file and a desktop poster is the 1080 file, never both', { timeout: 60000 }, () => withBrowser(async browser => {
  for (const [width, expected] of [[390, 'hero-poster-720.jpg'], [1440, 'hero-poster.jpg']]) {
    const ctx = await context(browser, { viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const seen = [];
    page.on('request', request => { if (/hero-poster/.test(request.url())) seen.push(request.url().split('/').pop()); });
    await page.goto(base.origin, { waitUntil: 'networkidle' });
    assert.deepEqual([...new Set(seen)], [expected], `${width}: poster file`);
    await ctx.close();
  }
}));

test('the P1-26 intro still releases: video blocked, video slow, and a fresh session', { timeout: 180000 }, () => withBrowser(async browser => {
  const cases = {
    'video blocked': { block: /\.mp4/ },
    'video slow': { hold: Object.assign(/\.mp4/, { ms: 6000 }) },
    'fresh session': {},
  };
  for (const [name, options] of Object.entries(cases)) {
    const ctx = await context(browser, { ...options, seen: false });
    const page = await ctx.newPage();
    const log = track(page);
    await page.goto(base.origin, { waitUntil: 'domcontentloaded' });
    // The curtain's hidden attribute is set before the pre-paint CSS shows it, so wait on what a visitor sees: the
    // content becomes visible and the curtain is not shown.
    await page.waitForFunction(() => {
      const curtain = document.querySelector('[data-home-curtain]');
      const shown = getComputedStyle(curtain).display !== 'none' && getComputedStyle(curtain).visibility !== 'hidden';
      return !shown && getComputedStyle(document.querySelector('[data-home-content]')).visibility === 'visible';
    }, null, { timeout: 12000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-home-content]')).visibility), 'visible', `${name}: content visible`);
    assert.equal(await page.evaluate(() => document.querySelector('[data-home-content]').inert), false, `${name}: content not inert`);
    assert.ok(await page.getByRole('link', { name: /Call the shop/ }).isVisible(), `${name}: Call button visible`);
    if (name === 'video blocked') assert.deepEqual(await page.evaluate(() => window.__csp), [], `${name}: no CSP violations`);
    await page.screenshot({ path: path.join(out, `video-intro-${name.replace(/\W+/g, '-')}.png`) });
    assert.equal(ctx.external.length, 0, `${name}: no external requests`);
    void log;
    await ctx.close();
  }
}));

test('F1: a page opened in a hidden tab loads no video, then plays it when the tab is first shown', { timeout: 120000 }, () => withBrowser(async browser => {
  const ctx = await context(browser, {
    init: () => {
      // A simulated background tab: the page sees document.hidden === true until the test shows it.
      window.__hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
    },
  });
  const page = await ctx.newPage();
  const log = track(page);
  await page.goto(base.origin, { waitUntil: 'load' });
  await delay(2500);
  assert.deepEqual(log.media, [], 'hidden: no mp4 is requested');
  assert.equal((await videoState(page)).src, null, 'hidden: no src');
  await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => { const v = document.querySelector('.zeus-hero-video'); return v.readyState >= 3 && v.currentTime > 0.3 && v.dataset.ready === 'true'; }, null, { timeout: 15000 });
  assert.deepEqual([...new Set(log.media)], [VIDEO.desktop], 'shown: the desktop file is requested once');
  assert.deepEqual(log.errors, [], 'clean console');
  assert.deepEqual(await page.evaluate(() => window.__csp), [], 'no CSP violations');
  await ctx.close();
}));

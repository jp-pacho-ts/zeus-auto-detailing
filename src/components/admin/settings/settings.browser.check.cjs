/* eslint-disable @typescript-eslint/no-require-imports */
// P1-42 real-browser check: Settings against a built app on loopback with synthetic data (the team fixture, src/server/admin/team-browser.fixture.ts).
// Same environment as team.browser.check.cjs; never loads .env. It really turns maintenance on and off through the proxy, so it needs a fresh database
// and waits for the two 3-second caches. Runs the real Content-Security-Policy and fails on any violation.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
const origin = new URL(process.env.P120_APP_ORIGIN).origin;
const shots = process.env.P142_SHOTS;
const SETTLE_MS = 7_000; // the proxy's 3 s and the route's 3 s, plus a margin
let browser;
const problems = [];

async function open(email, password, viewport, label) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin + '/')) return route.abort();
    const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.142' } });
    await route.fulfill({ response });
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(label + ' pageerror: ' + e.message));
  await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Staff Email or ID').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
  return { context, page };
}
async function goToSettings(page) {
  const menu = page.locator('button[aria-controls=admin-nav]');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
async function layoutRules(page, label) {
  const m = await page.evaluate(() => {
    const main = document.getElementById('admin-content');
    return {
      docH: document.documentElement.scrollHeight, winH: window.innerHeight, docW: document.documentElement.scrollWidth, winW: window.innerWidth, csp: window.__csp,
      mainW: main.scrollWidth, mainClient: main.clientWidth,
      small: [...main.querySelectorAll('button, input')].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 43.5).map(({ el, r }) => `${el.tagName} "${(el.textContent || el.name || '').trim().slice(0, 30)}" ${Math.round(r.height)}px`),
    };
  });
  assert.ok(m.docH <= m.winH + 1, `${label}: the document itself must not scroll (${m.docH} > ${m.winH})`);
  assert.ok(m.docW <= m.winW + 1, `${label}: no sideways scroll`);
  assert.ok(m.mainW <= m.mainClient + 1, `${label}: nothing is wider than the content area`);
  assert.deepEqual(m.csp, [], `${label}: no Content-Security-Policy violation`);
  assert.deepEqual(m.small, [], `${label}: every control is at least 44 px`);
}
const direct = (p, init) => fetch(upstream.origin + p, { redirect: 'manual', ...init });

test.before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.ok(process.env.P120_TEST_EMAIL && process.env.QSA_DETAILER_EMAIL, 'Supply synthetic fixture credentials');
  browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
});
test.after(async () => { await browser?.close(); assert.deepEqual(problems, [], 'no page error'); });

test('a non-admin is told plainly and the server refuses too', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.QSA_DETAILER_EMAIL, process.env.QSA_DETAILER_PASSWORD, { width: 1440, height: 900 }, 'detailer');
  await goToSettings(page);
  await page.getByText('Only an admin can change the settings.').waitFor();
  assert.equal(await page.evaluate(async () => (await fetch('/api/admin/settings')).status), 403);
  await context.close();
});

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test(`${label} ${viewport.width}: the four cards fit, and the email state names no secret`, { timeout: 120_000 }, async () => {
    const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, viewport, label);
    await goToSettings(page);
    for (const name of ['Website', 'Online booking', 'Daily limits', 'Email']) await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.getByText(/^Not set up\.|^Set up\./).waitFor();
    await page.getByText(/Shop emails in the last 7 days: \d+ failed, \d+ waiting\./).waitFor();
    assert.equal(await page.getByRole('button', { name: /test email/i }).count(), 0, 'the email test comes later');
    await layoutRules(page, label);
    await shot(page, `settings-${label}`);
    await context.close();
  });
}

test('maintenance end to end: confirm, customers get 503, the admin keeps working, the banner shows, and switching back restores the site', { timeout: 180_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 1440, height: 900 }, 'maintenance');
  await goToSettings(page);
  const website = page.getByRole('group', { name: 'Customer website' });
  await page.getByLabel(/Message customers see/).fill('Back at <noon>.');
  await page.getByRole('button', { name: 'Save message' }).click();
  await page.getByText('The message was saved.').waitFor();

  // Cancel changes nothing.
  await website.getByRole('button', { name: 'Under maintenance' }).click();
  await page.getByRole('heading', { name: 'Turn on maintenance?' }).waitFor();
  await shot(page, 'settings-confirm');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await website.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed'), 'true');

  await website.getByRole('button', { name: 'Under maintenance' }).click();
  await page.getByRole('button', { name: 'Turn on maintenance' }).click();
  await page.getByText(/The website is under maintenance\. Customers see it within a few seconds\./).waitFor();
  await page.getByText(/The customer website is under maintenance\..*Turn it off in Settings\./).waitFor();
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, 'settings-maintenance-on');

  // Customers: every page and API closes, plainly, and cannot be cached.
  for (const p of ['/', '/book', '/book/manage']) {
    const r = await direct(p);
    assert.equal(r.status, 503, p);
    assert.equal(r.headers.get('retry-after'), '600', p);
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
    const html = await r.text();
    assert.match(html, /under maintenance/, p);
    assert.match(html, /Back at &lt;noon&gt;\./, `${p}: the message, escaped`);
  }
  for (const p of ['/api/catalog', '/api/availability?x=1']) {
    const r = await direct(p);
    assert.equal(r.status, 503, p);
    assert.equal((await r.json()).error.code, 'ONLINE_BOOKING_UNAVAILABLE', p);
  }
  assert.equal(await (await direct('/api/site-state')).json().then((s) => s.maintenance), true);
  const customer = await context.newPage();
  await customer.goto(origin + '/');
  await customer.getByRole('heading', { name: /under maintenance/ }).waitFor();
  await shot(customer, 'settings-customer-page');
  await customer.close();

  // The admin is not locked out: login page, a new session read, and the rest of the admin all work.
  assert.equal((await direct('/admin/login')).status, 200);
  assert.notEqual((await direct('/api/admin/auth/session')).status, 503);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(/Turn it off in Settings\./).waitFor();
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Team & Commissions', exact: true }).click();
  await page.getByRole('heading', { name: 'Team & Commissions', exact: true }).waitFor();

  // Back to live, with no restart.
  await goToSettings(page);
  await page.getByRole('group', { name: 'Customer website' }).getByRole('button', { name: 'Live' }).click();
  await page.getByText(/The website is live again\./).waitFor();
  assert.equal(await page.getByText(/Turn it off in Settings\./).count(), 0, 'the banner is gone');
  await page.waitForTimeout(SETTLE_MS);
  for (const p of ['/', '/book', '/book/manage']) assert.equal((await direct(p)).status, 200, p);
  await context.close();
});

test('the booking switch: Paused shows the paused panel to customers and Open brings booking back', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 1440, height: 900 }, 'paused');
  await goToSettings(page);
  const booking = page.getByRole('group', { name: 'New bookings' });
  await booking.getByRole('button', { name: 'Paused' }).click();
  await page.getByText('Online booking is paused.').waitFor();
  assert.equal((await direct('/book')).status, 200, 'Paused is not maintenance: the pages stay up');
  await booking.getByRole('button', { name: 'Open' }).click();
  await page.getByText('Online booking is open.').waitFor();
  await context.close();
});

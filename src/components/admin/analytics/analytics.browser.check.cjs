/* eslint-disable @typescript-eslint/no-require-imports */
// P1-40 real-browser check: the Sales Analytics screen against a built app on loopback with synthetic data. Fixture and environment are those of
// team.browser.check.cjs (src/server/admin/team-browser.fixture.ts: five jobs finished on the day the fixture runs, ₱5,900.01 in all). Never loads .env.
// Runs the real Content-Security-Policy and fails on any violation. The states the fixture does not hold (unpriced jobs, weeks, months, a stock
// value too large to show, a failed read) answer one synthetic response in this test's own route handler; no write happens.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
const origin = new URL(process.env.P120_APP_ORIGIN).origin;
const shots = process.env.P140_SHOTS;
let browser;
const problems = [];

async function open(email, password, options, label) {
  const context = await browser.newContext(options);
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin + '/')) return route.abort();
    const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.140' } });
    await route.fulfill({ response });
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(label + ' pageerror: ' + e.message));
  // The only console errors allowed are the browser's note of the refusals this check provokes on purpose.
  const expected = { detailer: /status of 403/, failed: /status of 503/ }[label];
  page.on('console', (m) => { if (m.type() === 'error' && !(expected && expected.test(m.text()))) problems.push(label + ' console: ' + m.text()); });
  await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Staff Email or ID').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
  return { context, page };
}
async function goToAnalytics(page) {
  const menu = page.locator('button[aria-controls=admin-nav]');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Sales Analytics', exact: true }).click();
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const text = (page) => page.locator('#admin-content').innerText();

// The page must not scroll sideways or vertically itself (the admin content area scrolls), and every control is 44 px.
async function layoutRules(page, label) {
  const m = await page.evaluate(() => {
    const main = document.getElementById('admin-content');
    return {
      docH: document.documentElement.scrollHeight, winH: window.innerHeight, docW: document.documentElement.scrollWidth, winW: window.innerWidth,
      mainW: main.scrollWidth, mainClient: main.clientWidth, csp: window.__csp,
      small: [...main.querySelectorAll('button, input, select, summary, a[href]')].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 43.5)
        .map(({ el, r }) => `${el.tagName} "${(el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.height)}px`),
    };
  });
  assert.ok(m.docH <= m.winH + 1, `${label}: the document itself must not scroll (${m.docH} > ${m.winH})`);
  assert.ok(m.docW <= m.winW + 1, `${label}: no sideways scroll (${m.docW} > ${m.winW})`);
  assert.ok(m.mainW <= m.mainClient + 1, `${label}: nothing is wider than the content area (${m.mainW} > ${m.mainClient})`);
  assert.deepEqual(m.csp, [], `${label}: no Content-Security-Policy violation`);
  assert.deepEqual(m.small, [], `${label}: every control is at least 44 px`);
}
// The old demo screen's invented figures must never come back.
function noInventedFigures(body, label) {
  assert.doesNotMatch(body, /184,500|18\.4%|82\.4%|6,820|Bay Utilization|Gross Revenue|Popular Treatments|Last 30 Days/, `${label}: an invented figure`);
}

test.before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.ok(process.env.P120_TEST_EMAIL && process.env.QSA_DETAILER_EMAIL, 'Supply synthetic fixture credentials');
  browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
});
test.after(async () => { await browser?.close(); assert.deepEqual(problems, [], 'no page error and no unexpected console error'); });

test('a non-admin is told plainly, sees no money, and the server refuses too', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.QSA_DETAILER_EMAIL, process.env.QSA_DETAILER_PASSWORD, { viewport: { width: 1440, height: 900 } }, 'detailer');
  await goToAnalytics(page);
  await page.getByText('Only an admin can see sales.').waitFor();
  assert.doesNotMatch(await text(page), /₱/);
  assert.equal(await page.evaluate(async () => (await fetch('/api/admin/analytics?from=2026-01-01&to=2026-01-31')).status), 403);
  await context.close();
});

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['laptop', { width: 1366, height: 650 }], ['phone', { width: 390, height: 844 }]]) {
  test(`${label} ${viewport.width}: real figures, the chart by keyboard, the table view and the empty state`, { timeout: 180_000 }, async () => {
    const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { viewport }, label);
    await goToAnalytics(page);
    await page.getByText('₱5,900.01').first().waitFor();
    let body = await text(page);
    noInventedFigures(body, label);
    assert.match(body, /not cash counted/, 'revenue is defined on the screen');
    assert.match(body, /Finished jobs\s+5\b/);
    assert.match(body, /Average job\s+₱1,180\.00/, 'half up: 590001 / 5');
    assert.match(body, /Commission earned\s+₱675\.00/);
    assert.match(body, /Tint[\s\S]*₱5,000\.01/);
    assert.match(body, /Wash[\s\S]*₱900\.00/);
    assert.match(body, /Tint \+ PPF/);
    assert.match(body, /Finished\s+0\b/, 'the fixture jobs are booked in 2027, so this month lists none by booked day');
    assert.match(body, /Profit and expenses arrive with the Expenses page/);
    assert.doesNotMatch(body, /P1-\d|[A-Z]+_[A-Z]+/, 'no code labels');
    await layoutRules(page, label);
    await shot(page, `analytics-${label}`);
    await page.locator('#admin-content').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await shot(page, `analytics-${label}-bottom`);
    await page.locator('#admin-content').evaluate((el) => el.scrollTo(0, 0));

    // The chart by keyboard: one tab stop, arrows move, the name says the day and the money.
    const bars = page.locator('[data-bar]');
    assert.equal(await page.locator('[data-bar][tabindex="0"]').count(), 1, 'one tab stop');
    await bars.first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-bar')), '1');
    assert.match(await bars.nth(1).getAttribute('aria-label'), /^[A-Z][a-z]{2} \d+: (No finished job|Not yet|₱)/);
    await shot(page, `analytics-${label}-tooltip`);

    // The table view holds every value.
    await page.getByRole('button', { name: 'Show as table' }).click();
    await page.getByRole('cell', { name: /₱5,900\.01 from 5 jobs/ }).waitFor();
    await layoutRules(page, `${label} table`);
    await shot(page, `analytics-${label}-table`);
    await page.getByRole('button', { name: 'Show as chart' }).click();

    // A custom period: refused in plain words, then an empty period with no invented figure.
    await page.getByRole('button', { name: 'Custom' }).click();
    await page.getByLabel('From', { exact: true }).fill('2020-02-01');
    await page.getByLabel('To', { exact: true }).fill('2020-01-01');
    await page.getByRole('alert').filter({ hasText: "The end day can't be before the start day." }).waitFor();
    await page.getByLabel('To', { exact: true }).fill('2020-02-29');
    await page.getByText('No finished jobs in this period.').waitFor();
    body = await text(page);
    assert.match(body, /Revenue · Feb 1 to Feb 29, 2020\s+₱0\.00/);
    assert.match(body, /Average job\s+–/, 'no average, not a zero');
    assert.match(body, /Commissions began on/);
    assert.equal((body.match(/Nothing in this period\./g) || []).length, 3);
    noInventedFigures(body, `${label} empty`);
    await layoutRules(page, `${label} empty`);
    await shot(page, `analytics-${label}-empty`);
    await context.close();
  });
}

const synthetic = (extra) => ({
  ok: true,
  data: {
    from: '2026-01-01', to: '2026-12-31', today: '2026-11-07', revenueCentavos: 123456789, finishedJobs: 25, fullyPricedJobs: 2, averageJobCentavos: 50000,
    unpriced: { jobs: 23, references: Array.from({ length: 20 }, (_, i) => `ZEUS-U${String(i).padStart(5, '0')}`) },
    buckets: { unit: 'MONTH', rows: Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1).padStart(2, '0');
      return { start: `2026-${m}-01`, end: `2026-${m}-28`, future: i > 10, revenueCentavos: i > 10 ? 0 : (i + 1) * 1000000, jobs: i > 10 ? 0 : i + 1 };
    }) },
    byGroup: [{ code: 'GRAPHENE', revenueCentavos: 100000000 }, { code: 'WASH', revenueCentavos: 23456789 }],
    byQueue: [{ code: 'DETAILING_COATING', name: 'Detailing + Coating', revenueCentavos: 100000000 }, { code: 'WASH', name: 'Wash', revenueCentavos: 23456789 }],
    topServices: [{ name: 'A service with a very long name that has to wrap on a phone and never be clipped', revenueCentavos: 100000000, count: 9 }],
    bookingsByStatus: { PENDING: 1, CONFIRMED: 2, IN_PROGRESS: 3, COMPLETED: 25, CANCELLED: 4 },
    notCounted: { deletedFinished: 2, olderFinished: 1 },
    commissions: { startsAt: '2025-01-01T00:00:00.000Z', earnedCentavos: 100, unpaidCentavos: 50, nobodyCredited: 0, missingRecords: 0 },
    stock: { valueCentavos: null, noCostItems: 3, lowOrOutCount: 4 },
    ...extra,
  },
});

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test(`${label} ${viewport.width}: the notices, a year by month, and a long service name`, { timeout: 120_000 }, async () => {
    const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { viewport }, label);
    await page.route('**/api/admin/analytics?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(synthetic({})) }));
    await goToAnalytics(page);
    await page.getByText('₱1,234,567.89').first().waitFor();
    const body = await text(page);
    assert.match(body, /23 finished jobs have a service with no final price, so revenue is short by those services\./);
    assert.match(body, /2 finished bookings dated in this period were deleted and are not counted\./);
    assert.match(body, /1 finished booking from the older booking system is not counted\./);
    assert.match(body, /Too large to show/);
    assert.match(body, /3 supplies have no cost and are left out\./);
    assert.match(body, /Revenue by month/);
    await page.getByText('See which jobs').click();
    await page.getByText('ZEUS-U00000').waitFor();
    await page.getByText('and 3 more').waitFor();
    await layoutRules(page, `${label} notices`);
    const clipped = await page.locator('#admin-content li > span:first-child').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    assert.equal(clipped, 0, 'a long name wraps');
    await shot(page, `analytics-${label}-notices`);
    await context.close();
  });
}

test('a failed read shows Retry and no figures; Retry brings them back', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { viewport: { width: 1440, height: 900 } }, 'failed');
  let fail = true;
  await page.route('**/api/admin/analytics?*', async (route) => {
    if (!fail) return route.fallback();
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.', retryable: true, commitState: 'NOT_APPLICABLE' } }) });
  });
  await goToAnalytics(page);
  const retry = page.getByRole('button', { name: /retry/i });
  await retry.waitFor();
  assert.doesNotMatch(await text(page), /₱/, 'no figure next to a failure');
  await shot(page, 'analytics-failed');
  fail = false;
  await retry.click();
  await page.getByText('₱5,900.01').first().waitFor();
  await context.close();
});

test('a device in another time zone still asks for the Manila month', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { viewport: { width: 1440, height: 900 }, timezoneId: 'America/Los_Angeles' }, 'zone');
  // 16:30 UTC on Oct 31 is already Nov 1 in Manila, and still Oct 31 on this device.
  await page.clock.setFixedTime(new Date('2026-10-31T16:30:00.000Z'));
  const asked = [];
  page.on('request', (r) => { if (r.url().includes('/api/admin/analytics?')) asked.push(new URL(r.url()).search); });
  await goToAnalytics(page);
  await page.getByText(/^Revenue · /).waitFor();
  assert.equal(asked[0], '?from=2026-11-01&to=2026-11-30');
  await context.close();
});

/* eslint-disable @typescript-eslint/no-require-imports */
// P1-82 real-browser check: no page reports a Content-Security-Policy "eval" violation, and the policy still refuses eval.
// Zod 4 probes `new Function("")` when its first object schema is built; our CSP has no 'unsafe-eval', so the probe failed (caught) but the
// browser still filed a securitypolicyviolation on every page that loads a schema (UI/UX finding B4). src/instrumentation-client.ts turns the
// probe off with z.config({ jitless: true }) before the app code runs.
// Fixture and environment: board-browser.fixture.ts (an ADMIN login), a built app on loopback, P120_* variables as in the other admin checks.
// Never loads .env.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const TABS = ['Dashboard', 'Bookings', 'Calendar', 'Bay board', 'Services', 'Staff', 'Payroll & Commissions', 'Supplies & Inventory', 'Expenses', 'Sales Analytics', 'Users', 'Settings'];

test('no page reports any CSP violation (the Zod eval probe included), and the policy still has no unsafe-eval',{ timeout: 180_000 }, async () => {
  const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  const origin = new URL(process.env.P120_APP_ORIGIN).origin;
  assert.ok(process.env.P120_TEST_EMAIL && process.env.P120_TEST_PASSWORD, 'Supply synthetic fixture credentials');
  const browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
  const seen = []; // every page visited, with the eval violations it reported
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) return route.abort();
      const response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.182' } });
      await route.fulfill({ response });
    });
    // Recorded from the first script on every document, so a violation during hydration is not missed.
    // Every violation is kept with its source; none is filtered out (Security C3).
    await context.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber }));
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const record = async (where) => {
      await page.waitForLoadState('networkidle');
      seen.push({ where, ...(await page.evaluate(() => ({
        violations: window.__csp.slice(),
        // Proof that these pages build Zod schemas is the RED run on dev 4692fcf: the probe's eval violation on /book and every admin tab.
        jitless: globalThis.__zod_globalConfig?.jitless === true,
      }))) });
    };

    // The policy the app serves still refuses eval (P1-82 must not loosen it).
    for (const url of ['/admin/login', '/', '/book']) {
      const response = await page.goto(origin + url, { waitUntil: 'networkidle' });
      const policy = response.headers()['content-security-policy'] || '';
      assert.match(policy, /script-src /, url + ': a script-src policy is served');
      assert.doesNotMatch(policy, /unsafe-eval|wasm-unsafe-eval/, url + ': no unsafe-eval in the policy');
      await record(url);
    }

    // Sign in, then open every admin tab (each one loads its own forms and schemas).
    await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Staff Email or Username').fill(process.env.P120_TEST_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.P120_TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    await record('/admin (Dashboard after sign-in)');
    const nav = page.getByRole('navigation', { name: 'Shop Operations Navigation' });
    for (const tab of TABS) {
      await nav.getByRole('button', { name: tab, exact: true }).click();
      await record('/admin ' + tab);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(seen, null, 1));
  assert.deepEqual(errors, [], 'no page error');
  assert.deepEqual(seen.filter((s) => s.violations.length > 0).map((s) => ({ where: s.where, violations: s.violations })), [], 'pages that reported any CSP violation');
  assert.ok(seen.every((s) => s.jitless), 'Zod runs jitless on every page (src/instrumentation-client.ts loaded first)');
});

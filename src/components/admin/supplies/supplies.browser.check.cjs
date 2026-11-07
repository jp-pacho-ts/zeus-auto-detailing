/* eslint-disable @typescript-eslint/no-require-imports */
// P1-38 real-browser check: the Supplies & Inventory screen against a built app on loopback with synthetic data (the team fixture,
// src/server/admin/team-browser.fixture.ts, gives the admin and detailer logins; the supplies list starts empty). Runs the real
// Content-Security-Policy and fails on any violation. Same environment as team.browser.check.cjs; never loads .env.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
const origin = new URL(process.env.P120_APP_ORIGIN).origin;
const shots = process.env.P138_SHOTS;
let browser;
const problems = [];

async function open(email, password, viewport, label) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin + '/')) return route.abort();
    const retryable = ['GET', 'HEAD'].includes(request.method());
    let response;
    for (let attempt = 0; !response; attempt++) {
      try {
        response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.138' } });
      } catch (error) {
        if (!retryable || attempt === 2 || !/ECONNRESET|socket hang up/.test(error.message)) throw error;
      }
    }
    await route.fulfill({ response });
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(label + ' pageerror: ' + e.message));
  // Console errors the browser prints for the refusals this check provokes on purpose: the detailer's 403, and the one lost response.
  const expected = { detailer: /status of 403/, desktop: /ERR_FAILED/ }[label];
  page.on('console', (m) => { if (m.type() === 'error' && !(expected && expected.test(m.text()))) problems.push(label + ' console: ' + m.text()); });
  await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Staff Email or ID').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
  return { context, page };
}
async function goToSupplies(page) {
  const menu = page.locator('button[aria-controls=admin-nav]');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Supplies & Inventory', exact: true }).click();
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const text = (page) => page.locator('#admin-content').innerText();
const rowOf = (page, name) => page.locator('#admin-content li', { hasText: name }).first();

// The page must not scroll sideways or vertically itself (the admin content area scrolls), and every control is 44 px.
async function layoutRules(page, label) {
  const m = await page.evaluate(() => ({ docH: document.documentElement.scrollHeight, winH: window.innerHeight, docW: document.documentElement.scrollWidth, winW: window.innerWidth, csp: window.__csp }));
  assert.ok(m.docH <= m.winH + 1, `${label}: the document itself must not scroll (${m.docH} > ${m.winH})`);
  assert.ok(m.docW <= m.winW + 1, `${label}: no sideways scroll (${m.docW} > ${m.winW})`);
  assert.deepEqual(m.csp, [], `${label}: no Content-Security-Policy violation`);
  const small = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[role=dialog] button, [role=dialog] input, [role=dialog] select, #admin-content button, #admin-content input, #admin-content select')) {
      const target = el.type === 'checkbox' ? el.closest('label') || el : el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName} "${(el.getAttribute('aria-label') || el.textContent || el.name || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  assert.deepEqual(small, [], `${label}: every control is at least 44 px`);
}

test.before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.ok(process.env.P120_TEST_EMAIL && process.env.QSA_DETAILER_EMAIL, 'Supply synthetic fixture credentials');
  browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
});
test.after(async () => { await browser?.close(); });

test('a non-admin login is told plainly this screen is for admins, sees no costs, and the server refuses too', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.QSA_DETAILER_EMAIL, process.env.QSA_DETAILER_PASSWORD, { width: 1440, height: 900 }, 'detailer');
  await goToSupplies(page);
  await page.getByText('Only an admin can see supplies and their costs.').waitFor();
  assert.doesNotMatch(await text(page), /₱|Gtechniq|CarPro/);
  assert.equal(await page.evaluate(async () => (await fetch('/api/admin/supplies')).status), 403, 'the server refuses it');
  await context.close();
});

test('desktop 1440: empty start, add, stock in with a cost, used, a lost response retried once, reorder 0, search, erase vs archive, restore', { timeout: 300_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 1440, height: 900 }, 'desktop');
  await goToSupplies(page);
  const dialog = page.getByRole('dialog');
  const summary = page.getByTestId('supplies-summary');
  await summary.waitFor();

  // The demo screen is gone: no invented products, an honest empty start.
  let body = await text(page);
  assert.match(body, /No supplies yet\. Add your first supply\./);
  assert.doesNotMatch(body, /Gtechniq|CarPro|Lake Country|Koch Chemie|Machine Correction/, 'no invented products');
  await layoutRules(page, 'desktop empty');
  await shot(page, 'supplies-empty-1440');

  // Add an item with a starting stock; it survives a reload.
  await page.getByRole('button', { name: 'Add item' }).first().click();
  await dialog.getByLabel('Name').fill('Iron X Spray');
  await dialog.getByLabel('Category (optional)').fill('Wash');
  await dialog.getByLabel('Unit (bottle, pcs, litre...)').fill('bottle');
  await dialog.getByLabel('Reorder level (0 means no alert)').fill('3');
  await dialog.getByLabel('Cost of one unit, in pesos').fill('125.50');
  await dialog.getByLabel('Starting stock (optional)').fill('5');
  await layoutRules(page, 'desktop add dialog');
  await shot(page, 'supplies-add-1440');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await page.getByText('Iron X Spray was added.').waitFor();
  assert.match(await rowOf(page, 'Iron X Spray').innerText(), /OK[\s\S]*Wash · bottle[\s\S]*In stock 5 · Reorder at 3 · ₱125\.50 each/);
  assert.equal(await summary.innerText(), '1 supply · none low');
  await page.reload({ waitUntil: 'networkidle' });
  await goToSupplies(page);
  await rowOf(page, 'Iron X Spray').waitFor();
  assert.match(await rowOf(page, 'Iron X Spray').innerText(), /In stock 5/, 'a reload keeps it');

  // Stock in with a purchase price: the stock and the item cost move.
  await page.getByRole('button', { name: 'Stock in for Iron X Spray' }).click();
  await dialog.getByLabel(/How many/).fill('10');
  await dialog.getByLabel(/Price of one bottle/).fill('130');
  await dialog.getByLabel('Note (optional)').fill('Delivery');
  await dialog.getByText('15 bottle left after this.').waitFor();
  await shot(page, 'supplies-stock-in-1440');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.getByText('10 bottle added to Iron X Spray.').waitFor();
  assert.match(await rowOf(page, 'Iron X Spray').innerText(), /In stock 15 · Reorder at 3 · ₱130\.00 each/);

  // Used: more than is there is refused before saving; exactly the right amount works and the badge turns Low.
  await page.getByRole('button', { name: 'Used: Iron X Spray' }).click();
  await dialog.getByLabel(/How many/).fill('20');
  await dialog.getByText('Not enough stock. Only 15 left.').waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Save' }).isDisabled(), true, 'cannot save more than is there');
  assert.equal(await dialog.getByLabel(/Price of one/).count(), 0, 'no price on stock used');
  await dialog.getByLabel(/How many/).fill('13');
  await dialog.getByText('2 bottle left after this.').waitFor();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.getByText('13 bottle of Iron X Spray recorded as used.').waitFor();
  assert.match(await rowOf(page, 'Iron X Spray').innerText(), /Low[\s\S]*In stock 2/);
  assert.equal(await summary.innerText(), '1 supply · 1 low or out');

  // A lost response: the server records the movement, the browser never hears back, the admin presses Save again. Recorded once.
  const lose = async (route) => {
    await route.fetch({ url: route.request().url().replace(origin, upstream.origin), headers: { ...route.request().headers(), 'x-forwarded-for': '198.51.100.138' } });
    await route.abort('failed');
  };
  await page.route('**/api/admin/supplies/*/stock', lose, { times: 1 });
  await page.getByRole('button', { name: 'Used: Iron X Spray' }).click();
  await dialog.getByLabel(/How many/).fill('1');
  await dialog.getByLabel('Note (optional)').fill('retry');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.getByRole('alert').waitFor();
  await shot(page, 'supplies-lost-response-1440');
  await dialog.getByRole('button', { name: 'Save' }).click(); // the same form, the same id
  await page.getByText('1 bottle of Iron X Spray recorded as used.').waitFor();
  assert.match(await rowOf(page, 'Iron X Spray').innerText(), /In stock 1 /, 'used once, not twice (2 - 1 = 1)');
  await page.unroute('**/api/admin/supplies/*/stock');

  // The history says what happened, once each.
  await page.getByRole('button', { name: 'History of Iron X Spray' }).click();
  await dialog.getByText('History of Iron X Spray').waitFor();
  await dialog.getByText('Starting stock +5 → 5').waitFor();
  const history = await dialog.innerText();
  assert.match(history, /Stock in \+10 → 15 · ₱130\.00 each · Delivery/);
  assert.match(history, /Used -13 → 2/);
  assert.equal((history.match(/Used -1 → 1 · retry/g) || []).length, 1, 'the retried movement is in the history once');
  assert.match(history, /Catalog Test Admin|Admin/, 'who did it');
  await layoutRules(page, 'desktop history dialog');
  await shot(page, 'supplies-history-1440');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await dialog.waitFor({ state: 'detached' });

  // Reorder level 0: no alert, no badge, not counted.
  await page.getByRole('button', { name: 'Add item' }).first().click();
  await dialog.getByLabel('Name').fill('Silent Soap');
  await dialog.getByLabel('Unit (bottle, pcs, litre...)').fill('L');
  await dialog.getByLabel('Cost of one unit, in pesos').fill('10');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await page.getByText('Silent Soap was added.').waitFor();
  const silent = await rowOf(page, 'Silent Soap').innerText();
  assert.match(silent, /No reorder alert/);
  assert.doesNotMatch(silent, /\bOut\b|\bLow\b|\bOK\b/, 'reorder 0 shows no badge, even at stock 0');
  assert.equal(await summary.innerText(), '2 supplies · 1 low or out', 'and it is not counted');

  // Search.
  await page.getByLabel('Search').fill('iron');
  assert.equal(await page.locator('#admin-content li', { hasText: 'Silent Soap' }).count(), 0);
  await page.getByLabel('Search').fill('zzz');
  await page.getByText('No supplies match your search.').waitFor();
  await page.getByLabel('Search').fill('');

  // Delete: never used = erased; with history = archived (hidden), shown again with Show archived, restorable.
  await page.getByRole('button', { name: 'Delete Silent Soap' }).click();
  await dialog.getByText('was never used, so it will be deleted for good').waitFor();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('Silent Soap was deleted.').waitFor();
  assert.equal(await page.locator('#admin-content li', { hasText: 'Silent Soap' }).count(), 0);
  await page.getByRole('button', { name: 'Delete Iron X Spray' }).click();
  await dialog.getByText(/has a history, so it will be hidden/).waitFor();
  await shot(page, 'supplies-delete-1440');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText(/Iron X Spray has a history, so it was hidden instead/).waitFor();
  assert.equal(await page.locator('#admin-content li', { hasText: 'Iron X Spray' }).count(), 0, 'archived items are hidden');
  await page.getByLabel('Show archived').check();
  await rowOf(page, 'Iron X Spray').getByText('Archived').waitFor();
  await page.getByRole('button', { name: 'Restore Iron X Spray' }).click();
  await page.getByText('Iron X Spray is back.').waitFor();
  await page.getByLabel('Show archived').uncheck();
  await rowOf(page, 'Iron X Spray').waitFor();
  await layoutRules(page, 'desktop list');
  await shot(page, 'supplies-list-1440');
  await context.close();
});

test('phone 390: the list and every dialog fit, nothing scrolls sideways or as a page, every control is 44 px', { timeout: 240_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 390, height: 844 }, 'phone');
  await goToSupplies(page);
  await page.getByTestId('supplies-summary').waitFor();
  await rowOf(page, 'Iron X Spray').waitFor();
  await layoutRules(page, 'phone list');
  await shot(page, 'supplies-list-390');
  const dialog = page.getByRole('dialog');
  const fits = async (label) => {
    const box = await dialog.locator('> div').nth(1).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, `${label} fits the phone: ${JSON.stringify(box)}`);
    await layoutRules(page, label);
  };
  await page.getByRole('button', { name: 'Add item' }).first().click();
  await dialog.waitFor();
  await fits('phone add dialog');
  await shot(page, 'supplies-add-390');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Stock in for Iron X Spray' }).click();
  await dialog.waitFor();
  await dialog.getByLabel(/How many/).fill('4');
  await fits('phone stock dialog');
  await shot(page, 'supplies-stock-390');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'History of Iron X Spray' }).click();
  await dialog.getByText('History of Iron X Spray').waitFor();
  await fits('phone history dialog');
  await shot(page, 'supplies-history-390');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Delete Iron X Spray' }).click();
  await dialog.waitFor();
  await fits('phone delete dialog');
  await page.keyboard.press('Escape');
  await context.close();
  assert.deepEqual(problems, [], 'no page error or console error in any run');
});

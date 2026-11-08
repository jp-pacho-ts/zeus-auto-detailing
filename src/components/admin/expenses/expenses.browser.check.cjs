/* eslint-disable @typescript-eslint/no-require-imports */
// P1-39 real-browser check: the Expenses screen against a built app on loopback with synthetic data (the team fixture, src/server/admin/team-browser.fixture.ts, gives the
// admin and detailer logins and unpaid commission entries). Runs the real Content-Security-Policy and fails on any violation. Same environment as team.browser.check.cjs;
// never loads .env. The check changes data, so build a fresh database for every run. Optional P139_SHOTS: a screenshot folder.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
const origin = new URL(process.env.P120_APP_ORIGIN).origin;
const shots = process.env.P139_SHOTS;
let browser;
const problems = [];
// The console error the step running now provokes on purpose. Narrow on purpose: outside that step the same error fails the run.
let provoked = null;

async function open(email, password, viewport, label) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin + '/')) return route.abort();
    const retryable = ['GET', 'HEAD'].includes(request.method());
    let response;
    for (let attempt = 0; !response; attempt++) {
      try {
        response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.139' } });
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
  const expected = { detailer: /status of 403/ }[label];
  page.on('console', (m) => { if (m.type() === 'error' && !(expected && expected.test(m.text())) && !(provoked && provoked.test(m.text()))) problems.push(label + ' console: ' + m.text()); });
  await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Staff Email or ID').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
  return { context, page };
}
async function goToExpenses(page) {
  const menu = page.locator('button[aria-controls=admin-nav]');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Expenses', exact: true }).click();
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const total = (page) => page.getByTestId('expenses-total').innerText();
const rowOf = (page, text) => page.locator('[data-expense]').filter({ hasText: text });
const status = (page, text) => page.getByRole('status').filter({ hasText: text }).first().waitFor();
const manilaToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

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

async function fillExpense(page, { category, amount, payee, note }) {
  const dialog = page.getByRole('dialog');
  if (category) await dialog.getByLabel('Category').selectOption({ label: category });
  if (amount !== undefined) await dialog.getByLabel('Amount, in pesos').fill(amount);
  if (payee !== undefined) await dialog.getByLabel('Who was paid (optional)').fill(payee);
  if (note !== undefined) await dialog.getByLabel('Note (optional)').fill(note);
  return dialog;
}

test.before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.ok(process.env.P120_TEST_EMAIL && process.env.QSA_DETAILER_EMAIL, 'Supply synthetic fixture credentials');
  browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
});
test.after(async () => { await browser?.close(); });

test('a non-admin login is told plainly this screen is for admins, fetches nothing, and the server refuses too', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.QSA_DETAILER_EMAIL, process.env.QSA_DETAILER_PASSWORD, { width: 1440, height: 900 }, 'detailer');
  const asked = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/admin/expense')) asked.push(r.url()); });
  await goToExpenses(page);
  await page.getByText('Only an admin can see expenses.').waitFor();
  assert.deepEqual(asked, [], 'the screen fetches nothing');
  assert.doesNotMatch(await page.locator('#admin-content').innerText(), /₱/);
  for (const url of ['/api/admin/expenses?month=2026-11', '/api/admin/expense-categories']) assert.equal(await page.evaluate(async (u) => (await fetch(u)).status, url), 403, url);
  await context.close();
});

test('desktop: add, edit, History, remove, restore, categories, a lost response, a stale edit and the derived lines moving', { timeout: 240_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 1440, height: 900 }, 'desktop');
  await goToExpenses(page);
  await page.getByRole('heading', { name: 'Expenses', exact: true }).first().waitFor();
  await page.getByText('No expenses typed in for this month.').waitFor();
  assert.equal(await total(page), '₱0.00');
  assert.equal(await page.locator('ol[aria-label="The last 12 months"] > li').count(), 12);
  await layoutRules(page, 'desktop empty');

  // Add. A wrong amount is refused in words and keeps the form.
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  let dialog = await fillExpense(page, { category: 'Utilities', amount: '0', payee: 'Meralco', note: 'November bill' });
  await layoutRules(page, 'desktop add dialog');
  await shot(page, '1440-add');
  provoked = /status of 400/;
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: /more than zero/ }).waitFor();
  provoked = null;
  await dialog.getByLabel('Amount, in pesos').fill('1250.50');

  // A lost response: the server records it, the browser never hears. The retry sends the same id and records it once.
  let posts = [];
  await page.route('**/api/admin/expenses', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts.push(JSON.parse(route.request().postData()).id);
    // The server records it for real (the context route's address rewrite does not apply to this fetch), then the answer is lost.
    if (posts.length === 1) { await route.fetch({ url: route.request().url().replace(origin, upstream.origin), headers: { ...route.request().headers(), 'x-forwarded-for': '198.51.100.139' } }); return route.abort('failed'); }
    return route.fallback();
  });
  provoked = /ERR_FAILED/;
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  provoked = null;
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await status(page, 'The expense was added.');
  await page.unroute('**/api/admin/expenses');
  assert.equal(posts.length, 2);
  assert.equal(posts[0], posts[1], 'the retry carries the same id');
  assert.equal(await rowOf(page, 'Meralco').count(), 1, 'recorded once');
  assert.equal(await total(page), '₱1,250.50');
  await shot(page, '1440-added');

  // Edit, and the amount before and after in History.
  await rowOf(page, 'Meralco').getByRole('button', { name: 'Edit', exact: true }).click();
  dialog = await fillExpense(page, { amount: '1300' });
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await status(page, 'The expense was changed.');
  assert.equal(await total(page), '₱1,300.00');
  await rowOf(page, 'Meralco').getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog').filter({ hasText: 'History of this expense' });
  await history.getByText(/Changed · ₱1,300\.00/).waitFor();
  await history.getByText(/Added · ₱1,250\.50/).waitFor();
  await layoutRules(page, 'desktop history');
  await history.getByRole('button', { name: 'Close', exact: true }).last().click();

  // A stale edit: someone else changed it. Refused in words, and the list reloads.
  await rowOf(page, 'Meralco').getByRole('button', { name: 'Edit', exact: true }).click();
  dialog = await fillExpense(page, { amount: '1400' });
  await page.evaluate(async () => {
    const month = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    const list = (await (await fetch(`/api/admin/expenses?month=${month}`)).json()).data;
    const e = list.expenses[0];
    await fetch(`/api/admin/expenses/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: e.revision, date: e.expenseDate, categoryId: e.categoryId, amountPesos: '1350', payee: e.payee, note: e.note }) });
  });
  provoked = /status of 409/;
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Someone else changed this.' }).waitFor();
  provoked = null;
  await page.getByTestId('expenses-total').filter({ hasText: '₱1,350.00' }).waitFor();
  // The form kept what was typed and follows the reloaded list, so saving again is not a dead end.
  assert.equal(await dialog.getByLabel('Amount, in pesos').inputValue(), '1400');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await status(page, 'The expense was changed.');
  await page.getByTestId('expenses-total').filter({ hasText: '₱1,400.00' }).waitFor();

  // Remove hides, Show removed brings the row back into view without changing the money, Restore counts it again.
  await rowOf(page, 'Meralco').getByRole('button', { name: 'Remove', exact: true }).click();
  const remove = page.getByRole('dialog').filter({ hasText: 'Remove this expense?' });
  await remove.getByText('It will be hidden and kept in history. You can bring it back.').waitFor();
  await remove.getByLabel('Reason (optional)').fill('typed twice');
  await remove.getByRole('button', { name: 'Remove', exact: true }).click();
  await status(page, 'The expense was removed.');
  assert.equal(await total(page), '₱0.00');
  assert.equal(await rowOf(page, 'Meralco').count(), 0);
  await page.getByLabel('Show removed').check();
  await rowOf(page, 'Meralco').getByRole('button', { name: 'Restore', exact: true }).waitFor();
  assert.equal(await total(page), '₱0.00', 'the switch never changes the money');
  await shot(page, '1440-removed');
  await rowOf(page, 'Meralco').getByRole('button', { name: 'Restore', exact: true }).click();
  await status(page, 'The expense is back.');
  assert.equal(await total(page), '₱1,400.00');
  await page.getByLabel('Show removed').uncheck();

  // Search and the category filter.
  await page.getByLabel('Search').fill('rent');
  await page.getByText('No expenses match your search.').waitFor();
  await page.getByLabel('Search').fill('MERALCO');
  assert.equal(await rowOf(page, 'Meralco').count(), 1);
  await page.getByLabel('Search').fill('');
  await page.locator('#admin-content').getByLabel('Category').selectOption({ label: 'Rent' });
  await page.getByText('No expenses typed in for this month.').waitFor();
  assert.equal(await total(page), '₱1,400.00', 'the filter narrows the rows, not the money');
  await page.locator('#admin-content').getByLabel('Category').selectOption({ label: 'All categories' });
  await rowOf(page, 'Meralco').waitFor();

  // Categories: add, a reserved name, rename, hide, show.
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  const cats = page.getByRole('dialog').filter({ hasText: 'Hide one you no longer use.' });
  await cats.getByLabel('New category').fill('Stock bought');
  provoked = /status of 400/;
  await cats.getByRole('button', { name: 'Add category', exact: true }).click();
  await cats.getByRole('alert').filter({ hasText: 'automatic lines' }).waitFor();
  provoked = null;
  await cats.getByLabel('New category').fill('Permits');
  await cats.getByRole('button', { name: 'Add category', exact: true }).click();
  await cats.getByRole('status').filter({ hasText: 'Permits was added.' }).waitFor();
  await cats.getByRole('button', { name: 'Rename Permits', exact: true }).click();
  await cats.getByLabel('New name for Permits').fill('Permits and fees');
  await cats.getByRole('button', { name: 'Save name', exact: true }).click();
  await cats.getByRole('status').filter({ hasText: 'Renamed to Permits and fees.' }).waitFor();
  await cats.getByRole('button', { name: 'Hide Permits and fees', exact: true }).click();
  await cats.getByRole('status').filter({ hasText: 'Permits and fees is hidden.' }).waitFor();
  await layoutRules(page, 'desktop categories');
  await shot(page, '1440-categories');
  await cats.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('Category').locator('option', { hasText: 'Permits and fees' }).count(), 0, 'a hidden category is not offered for a new expense');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // The derived lines move: a priced stock-in and a "mark paid" made elsewhere, one unpriced stock-in reported. Then the reload shows them.
  const before = { stock: await page.getByTestId('expenses-stock').innerText(), commissions: await page.getByTestId('expenses-commissions').innerText() };
  assert.match(before.stock, /₱0\.00 from 0 stock-ins/);
  const moved = await page.evaluate(async () => {
    const send = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(url + ' ' + JSON.stringify(j.error)); return j.data; };
    const item = await send('/api/admin/supplies', { id: crypto.randomUUID(), name: 'Check Wax', unit: 'bottle', reorderLevel: 0, costPesos: '0' });
    const priced = await send(`/api/admin/supplies/${item.id}/stock`, { id: crypto.randomUUID(), expectedRevision: item.revision, kind: 'RECEIVE', quantity: 3, unitCostPesos: '100.50' });
    await send(`/api/admin/supplies/${item.id}/stock`, { id: crypto.randomUUID(), expectedRevision: priced.revision, kind: 'RECEIVE', quantity: 1 });
    const day = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10); // the fixture's jobs complete on the real clock
    const list = (await (await fetch(`/api/admin/commissions?from=${day}&to=${day}&status=UNPAID`)).json()).data;
    const entry = list.entries[0];
    await send('/api/admin/commissions/paid', { ids: [entry.id], paid: true });
    return { share: entry.amountCentavos };
  });
  await page.reload({ waitUntil: 'networkidle' });
  await goToExpenses(page);
  await page.getByTestId('expenses-stock').filter({ hasText: '₱301.50 from 1 stock-in' }).waitFor();
  const commissions = await page.getByTestId('expenses-commissions').innerText();
  const pesos = (moved.share / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.ok(commissions.includes(`₱${pesos}`), `commissions paid shows the marked amount: ${commissions}`);
  await page.getByTestId('expenses-note').filter({ hasText: '1 stock-in had no price and is not counted.' }).waitFor();
  await page.getByTestId('expenses-note').filter({ hasText: /Still owed in commissions/ }).waitFor();
  const expected = (140_000 + 30_150 + moved.share);
  assert.equal(await total(page), `₱${Math.floor(expected / 100).toLocaleString('en-PH')}.${String(expected % 100).padStart(2, '0')}`, 'the total is the three kinds');
  await shot(page, '1440-derived');
  await layoutRules(page, 'desktop derived');

  // Month picker: nothing after this month; the previous month is empty but the strip stays 12 long.
  assert.equal(await page.getByRole('button', { name: 'Next month' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByText('No expenses typed in for this month.').waitFor();
  assert.equal(await page.locator('ol[aria-label="The last 12 months"] > li').count(), 12);
  assert.equal(await page.getByRole('button', { name: 'Next month' }).isDisabled(), false);
  // Adding from a past month starts on that month, not today.
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  assert.notEqual(await page.getByRole('dialog').getByLabel('Date').inputValue(), manilaToday());
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await context.close();
});

test('phone: the screen and the add dialog fit, every control is 44 px, and an expense can be added', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 390, height: 844 }, 'phone');
  await goToExpenses(page);
  await page.getByRole('button', { name: 'Add expense', exact: true }).waitFor();
  await layoutRules(page, 'phone list');
  await shot(page, '390-list');
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const dialog = await fillExpense(page, { category: 'Rent', amount: '5000', payee: 'Landlord' });
  await layoutRules(page, 'phone add dialog');
  await shot(page, '390-add');
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await status(page, 'The expense was added.');
  await rowOf(page, 'Landlord').waitFor();
  await layoutRules(page, 'phone after add');
  await shot(page, '390-after-add');
  await context.close();
});

test('no page error, no unexpected console error', () => {
  assert.deepEqual(problems, [], 'no page error or console error in any run: ' + problems.join(' | '));
});

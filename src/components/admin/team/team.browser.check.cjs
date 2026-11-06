/* eslint-disable @typescript-eslint/no-require-imports */
// P1-37 real-browser check: the Team and Commissions screens against a built app on loopback with synthetic data
// (fixture: three detailers, four completed jobs, one with nobody assigned). Same environment as
// booking-delete.browser.check.cjs; never loads .env. Runs the real Content-Security-Policy and fails on any violation.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const upstream = new URL(process.env.P120_BROWSER_ORIGIN);
const origin = new URL(process.env.P120_APP_ORIGIN).origin;
const shots = process.env.P137_SHOTS;
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
        response = await route.fetch({ url: request.url().replace(origin, upstream.origin), headers: { ...request.headers(), 'x-forwarded-for': '198.51.100.137' } });
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
  // The only console errors allowed are the browser's note of the two refusals this check provokes on purpose:
  // the detailer's 403 on the team list, and the 400 for the invalid percentage (and invalid default rate).
  const expected = { detailer: /status of 403/, desktop: /status of 400/ }[label];
  page.on('console', (m) => { if (m.type() === 'error' && !(expected && expected.test(m.text()))) problems.push(label + ' console: ' + m.text()); });
  await page.goto(origin + '/admin/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Staff Email or ID').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('heading', { name: 'Bookings', exact: true }).waitFor();
  return { context, page };
}
async function goToTeam(page) {
  const menu = page.locator('button[aria-controls=admin-nav]');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Team & Commissions', exact: true }).click();
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

// The page must not scroll sideways or vertically itself (the admin content area scrolls), and every control is 44 px.
async function layoutRules(page, label) {
  const m = await page.evaluate(() => ({
    docH: document.documentElement.scrollHeight, winH: window.innerHeight, docW: document.documentElement.scrollWidth, winW: window.innerWidth,
    csp: window.__csp,
  }));
  assert.ok(m.docH <= m.winH + 1, `${label}: the document itself must not scroll (${m.docH} > ${m.winH})`);
  assert.ok(m.docW <= m.winW + 1, `${label}: no sideways scroll (${m.docW} > ${m.winW})`);
  assert.deepEqual(m.csp, [], `${label}: no Content-Security-Policy violation`);
  const small = await page.evaluate(() => {
    const main = document.getElementById('admin-content');
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
    void main;
    return out;
  });
  assert.deepEqual(small, [], `${label}: every control is at least 44 px`);
}
const text = (page) => page.locator('#admin-content').innerText();

test.before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname), 'Synthetic loopback app only');
  assert.ok(process.env.P120_TEST_EMAIL && process.env.QSA_DETAILER_EMAIL, 'Supply synthetic fixture credentials');
  browser = await chromium.launch({ headless: true, ...(process.env.P120_CHROME_EXECUTABLE ? { executablePath: process.env.P120_CHROME_EXECUTABLE } : {}) });
});
test.after(async () => { await browser?.close(); });

test('a detailer is told plainly this screen is for admins and sees no money or phone numbers', { timeout: 120_000 }, async () => {
  const { context, page } = await open(process.env.QSA_DETAILER_EMAIL, process.env.QSA_DETAILER_PASSWORD, { width: 1440, height: 900 }, 'detailer');
  await goToTeam(page);
  await page.getByText('Only an admin can see the team and commissions.').waitFor();
  const body = await text(page);
  assert.doesNotMatch(body, /₱|\+63|Ana Reyes|Commission/);
  const denied = await page.evaluate(async () => (await fetch('/api/admin/team')).status);
  assert.equal(denied, 403, 'the server refuses the detailer too');
  await context.close();
});

test('desktop 1440: add, edit, deactivate and remove detailers; the commissions add up; mark paid; change the default rate', { timeout: 240_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 1440, height: 900 }, 'desktop');
  await goToTeam(page);
  const dialog = page.getByRole('dialog');

  // Team: the three fixture people, with rates and the shop default.
  await page.getByRole('heading', { name: 'Team', exact: true }).waitFor();
  let body = await text(page);
  assert.match(body, /Ana Reyes[\s\S]*Commission 20% \(shop default\)/);
  assert.match(body, /Ben Cruz[\s\S]*Commission 12\.5%/);
  assert.match(body, /Cleo Santos/);
  await layoutRules(page, 'desktop team');
  // P1-61: names only. No role labels, no account or email wording, and the plain intro.
  assert.match(body, /Add the names of your staff\. They have no login\./);
  assert.doesNotMatch(body, /Detailer|Manager|Admin|Sign-in|sign-in|[Ee]mail|account/, 'the Team screen has no role, sign-in or email words');
  await shot(page, 'team-1440');

  // A bad percentage is refused with a plain sentence and the form stays open.
  await page.getByRole('button', { name: 'Add staff' }).first().click();
  assert.equal(await dialog.getByLabel(/[Ee]mail/).count(), 0, 'no email field');
  await dialog.getByLabel('Full name').fill('Dora Lim');
  await dialog.getByLabel('Commission percent (optional)').fill('abc');
  await dialog.getByRole('button', { name: 'Add staff' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.ok((await dialog.getByRole('alert').innerText()).length > 10, 'a plain refusal message is shown');
  await layoutRules(page, 'desktop add dialog');
  await shot(page, 'team-add-error-1440');
  // Fix it and save.
  await dialog.getByLabel('Commission percent (optional)').fill('15');
  await dialog.getByLabel('Phone (optional)').fill('+63 917 555 0199');
  await dialog.getByRole('button', { name: 'Add staff' }).click();
  await page.getByText('Dora Lim was added to the team.').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await goToTeam(page);
  await page.getByText('Dora Lim').first().waitFor();
  body = await text(page);
  assert.match(body, /Dora Lim[\s\S]*\+63 917 555 0199[\s\S]*Commission 15%/, 'the new person survives a reload');

  // Edit: change the percentage, then clear it back to the shop default.
  await page.getByRole('button', { name: 'Edit Dora Lim' }).click();
  await dialog.getByLabel('Commission percent (optional)').fill('');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Dora Lim was updated.').waitFor();
  assert.match(await text(page), /Dora Lim[\s\S]*Commission 20% \(shop default\)/);

  // Deactivate and reactivate.
  await page.getByRole('button', { name: 'Deactivate Dora Lim' }).click();
  await page.getByText("Dora Lim is now inactive and won't be assigned new jobs.").waitFor();
  assert.match(await text(page), /Dora Lim\s*Inactive/);
  await page.getByRole('button', { name: 'Reactivate Dora Lim' }).click();
  await page.getByText('Dora Lim is active again.').waitFor();

  // Remove someone with no history: gone. Remove someone with history: made inactive, and the screen says so.
  await page.getByRole('button', { name: 'Remove Dora Lim' }).click();
  await dialog.getByText("can't be undone").waitFor();
  await shot(page, 'team-remove-1440');
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByText('Dora Lim was removed from the team.').waitFor();
  assert.equal(await page.getByText('Dora Lim', { exact: true }).count(), 0, 'removed for good');
  await page.getByRole('button', { name: 'Remove Cleo Santos' }).click();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByText('Cleo Santos was removed from the team.').waitFor(); // Cleo has no jobs either
  await page.getByRole('button', { name: 'Remove Ana Reyes' }).click();
  await dialog.getByText('has job history').waitFor();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByText(/Ana Reyes has job history, so they were made inactive instead/).waitFor();
  assert.match(await text(page), /Ana Reyes\s*Inactive/);
  await page.getByRole('button', { name: 'Reactivate Ana Reyes' }).click();
  await page.getByText('Ana Reyes is active again.').waitFor();

  // Commissions.
  await page.getByRole('tab', { name: 'Commissions' }).click();
  await page.getByTestId('default-rate-line').waitFor();
  assert.equal(await page.getByTestId('default-rate-line').innerText(), 'Default rate is 20% until you change it.');
  await page.getByText('By person').waitFor();
  body = await text(page);
  assert.match(body, /Earned\s*₱675\.00/, 'grand total: Ana 300.00 + Ben 375.00');
  assert.match(body, /Unpaid\s*₱675\.00/);
  assert.match(body, /Commission is earned on detailing, paint, coating and tint services\. A car wash earns none\./, 'the rule is stated');
  assert.match(body, /No commission: car wash\. 1 completed booking in this range had only car wash services/, 'the wash-only job is explained');
  assert.match(body, /Counted: Regular Tint ₱1,000\.00/, 'which service counted');
  assert.match(body, /Not counted: Basic Wash ₱180\.00 \(car wash does not earn commission\)/, 'which service did not count, and why');
  assert.match(body, /Commission base ₱1,000\.00/, 'the base used is the tint only, not the wash');
  assert.match(body, /Ana Reyes\s*2 jobs\s*Earned ₱300\.00/);
  assert.match(body, /Ben Cruz\s*2 jobs\s*Earned ₱375\.00/);
  assert.match(body, /1 completed booking in this range had nobody assigned, so no commission was earned\./);
  assert.match(body, /shared by 2 of ₱1,000\.01/, 'the shared job says how it was split');
  await layoutRules(page, 'desktop commissions');
  await shot(page, 'commissions-1440');

  // A bad range is refused before asking the server.
  const toDate = page.getByLabel('To', { exact: true }), fromDate = page.getByLabel('From', { exact: true });
  await toDate.fill('2000-01-01');
  await page.getByRole('alert').filter({ hasText: "can't be before" }).waitFor();
  // Wait for each range answer itself (the old rows stay on screen meanwhile, so 'By person' alone proves nothing).
  const answered = () => page.waitForResponse((r) => r.url().includes('/api/admin/commissions?') && r.ok());
  // A range of one day (today, where the fixture's jobs completed) is allowed. It must be a day WITH data: the first day of the month has none,
  // and the page then shows no 'By person' list at all.
  const monthFrom = await fromDate.inputValue();
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  await fromDate.fill(today);
  await Promise.all([answered(), toDate.fill(today)]);
  await page.getByText('By person').waitFor();
  await Promise.all([answered(), fromDate.fill(monthFrom)]);
  await page.getByText('By person').waitFor();

  // Mark Ben's two jobs paid; the totals and the filter agree, and it survives a reload.
  await page.waitForLoadState('networkidle'); // let the range refetch finish before ticking, or the ticks can land on rows that are about to be replaced
  for (const box of await page.getByRole('checkbox', { name: /^Select Ben Cruz/ }).all()) await box.check();
  await page.getByText('2 selected').waitFor();
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByText('2 commissions marked as paid.').waitFor();
  body = await text(page);
  assert.match(body, /Paid\s*₱375\.00/);
  assert.match(body, /Unpaid\s*₱300\.00/);
  await page.getByLabel('Show').selectOption('UNPAID');
  await page.getByText('By person').waitFor();
  await page.getByRole('checkbox', { name: /^Select Ben Cruz/ }).first().waitFor({ state: 'detached' }); // old rows stay until the answer arrives
  assert.equal(await page.getByRole('checkbox', { name: /^Select Ben Cruz/ }).count(), 0, 'paid jobs are filtered out');
  assert.equal(await page.getByRole('checkbox', { name: /^Select Ana Reyes/ }).count(), 2);
  await page.reload({ waitUntil: 'networkidle' });
  await goToTeam(page);
  await page.getByRole('tab', { name: 'Commissions' }).click();
  await page.getByText('By person').waitFor();
  assert.match(await text(page), /Paid\s*₱375\.00/, 'paid state survives a reload');

  // Change the default rate: the line changes, and existing commissions do not.
  await page.getByRole('button', { name: 'Change default rate' }).click();
  await page.getByLabel('Default commission percent').fill('150');
  await page.getByRole('button', { name: 'Save default' }).click();
  await page.locator('#admin-content').getByRole('alert').waitFor();
  await page.getByLabel('Default commission percent').fill('12');
  await page.getByRole('button', { name: 'Save default' }).click();
  await page.getByText(/The default rate was changed/).waitFor();
  assert.equal(await page.getByTestId('default-rate-line').innerText(), 'Default rate is 12% until you change it.');
  assert.match(await text(page), /Earned\s*₱675\.00/, 'earlier commissions are unchanged');
  await page.reload({ waitUntil: 'networkidle' });
  await goToTeam(page);
  await page.getByRole('tab', { name: 'Commissions' }).click();
  assert.equal(await page.getByTestId('default-rate-line').innerText(), 'Default rate is 12% until you change it.');
  await layoutRules(page, 'desktop commissions after');

  // Adjustments (review F1/R2): Add, Take off, a refusal below zero, paid on their own, and "owed back" after payment.
  await page.getByLabel('Person').selectOption({ label: 'Ana Reyes' });
  await page.getByText('By person').waitFor();
  const adjust = async (mode, amount, reason, which) => {
    await page.getByRole('button', { name: 'Add adjustment' }).nth(which).click();
    await page.getByLabel('Change').selectOption(mode);
    await page.getByLabel('Amount (pesos)').fill(amount);
    await page.getByLabel('Reason', { exact: true }).fill(reason);
    await page.getByRole('button', { name: 'Save adjustment' }).click();
  };
  assert.match(await text(page), /Ana Reyes\s*2 jobs\s*Earned ₱300\.00/, 'before: Ana earned 300.00');
  await adjust('ADD', '300', 'Coating priced after the job', 0);
  await page.getByText('Coating priced after the job').waitFor();
  body = await text(page);
  assert.match(body, /Adjustment ₱300\.00/, 'the adjustment shows under the job');
  assert.match(body, /Coating priced after the job/);
  assert.match(body, /Ana Reyes\s*2 jobs\s*Earned ₱600\.00/, 'the totals include it');
  // A "Take off" larger than the job is worth is refused with a plain sentence, and nothing changes.
  await adjust('TAKE', '9999', 'Far too much', 0);
  await page.locator('#admin-content').getByRole('alert').filter({ hasText: 'below zero' }).waitFor();
  assert.match(await text(page), /Earned ₱600\.00/, 'nothing changed after the refusal');
  await page.getByRole('button', { name: 'Cancel' }).click();
  // A client-side refusal: a typed minus sign is not how it is done.
  await page.getByRole('button', { name: 'Add adjustment' }).nth(0).click();
  await page.getByLabel('Amount (pesos)').fill('-5');
  await page.getByLabel('Reason', { exact: true }).fill('typed minus');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await page.locator('#admin-content').getByRole('alert').filter({ hasText: 'no minus sign' }).waitFor();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await adjust('TAKE', '100', 'Part of it was a mistake', 0);
  await page.getByText('Part of it was a mistake').waitFor(); // the new line itself, not the notice (the notice text repeats)
  assert.match(await text(page), /Ana Reyes\s*2 jobs\s*Earned ₱500\.00/);
  await layoutRules(page, 'desktop commissions with adjustments');
  await shot(page, 'commissions-adjusted-1440');

  // The +300 adjustment is paid on its own; the jobs stay unpaid.
  await page.getByRole('checkbox', { name: /^Select the adjustment of ₱300\.00/ }).check();
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByText('1 commission marked as paid.').waitFor();
  body = await text(page);
  assert.match(body, /Paid\s*₱300\.00/);
  assert.match(body, /Unpaid\s*₱200\.00/);
  // Pay everything for Ana, then take more off: the screen says "Owed back", not a bare negative.
  for (const box of await page.locator('#admin-content').getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByText(/commissions? marked as paid\./).waitFor();
  await adjust('TAKE', '50', 'Overpaid, take it back', 1);
  await page.getByText('Overpaid, take it back').waitFor();
  body = await text(page);
  assert.match(body, /Owed back ₱50\.00/, 'paid more than is now owed reads as owed back');
  assert.doesNotMatch(body, /Unpaids*-/, 'never a bare negative unpaid');
  assert.match(body, /Adjustment -₱50.00/, 'a take-off line itself shows its sign');
  await shot(page, 'commissions-owed-back-1440');
  await page.reload({ waitUntil: 'networkidle' });
  await goToTeam(page);
  await page.getByRole('tab', { name: 'Commissions' }).click();
  await page.getByText('By person').waitFor();
  assert.match(await text(page), /Adjustment ₱300\.00/, 'adjustments survive a reload');
  await context.close();
});

test('phone 390: both screens fit, nothing scrolls sideways or as a page, every control is 44 px, and the dialogs fit', { timeout: 240_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 390, height: 844 }, 'phone');
  await goToTeam(page);
  const dialog = page.getByRole('dialog');
  await page.getByRole('heading', { name: 'Team', exact: true }).waitFor();
  await layoutRules(page, 'phone team');
  await shot(page, 'team-390');

  await page.getByRole('button', { name: 'Add staff' }).first().click();
  await dialog.waitFor();
  const box = await dialog.locator('> div').nth(1).boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, `the add dialog fits the phone: ${JSON.stringify(box)}`);
  await layoutRules(page, 'phone add dialog');
  await shot(page, 'team-add-390');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  await page.getByRole('tab', { name: 'Commissions' }).click();
  await page.getByText('By person').waitFor();
  await layoutRules(page, 'phone commissions');
  await shot(page, 'commissions-390');
  await page.getByRole('button', { name: 'Add adjustment' }).first().click();
  await page.getByLabel('Amount (pesos)').waitFor();
  await layoutRules(page, 'phone adjustment form');
  await shot(page, 'commissions-adjust-390');
  const rowWidths = await page.evaluate(() => [...document.querySelectorAll('#admin-content li')].map((li) => li.scrollWidth - li.clientWidth));
  assert.ok(rowWidths.every((d) => d <= 1), 'no row is wider than the phone');
  await context.close();
  assert.deepEqual(problems, [], 'no page error or console error in any run');
});

test('staff names flow: a name typed on the Team screen is offered on the booking, assigned there, and credited when the booking completes; the admin is never offered', { timeout: 240_000 }, async () => {
  const { context, page } = await open(process.env.P120_TEST_EMAIL, process.env.P120_TEST_PASSWORD, { width: 1440, height: 900 }, 'flow');
  await goToTeam(page);
  await page.getByRole('button', { name: 'Add staff' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Eve Tan');
  await dialog.getByRole('button', { name: 'Add staff' }).click();
  await page.getByText('Eve Tan was added to the team.').waitFor();

  // The booking drawer: the typed name is offered, the admin is not; assign it.
  await page.getByRole('navigation', { name: 'Shop Operations Navigation' }).getByRole('button', { name: 'Bay board', exact: true }).click();
  await page.getByLabel('Board day').waitFor();
  const card = page.getByRole('region', { name: 'Waiting · Wash', exact: true }).locator('article').first();
  await card.waitFor();
  await card.getByRole('button', { name: await card.getAttribute('aria-label'), exact: true }).click();
  await dialog.getByText('Booking details').waitFor();
  const picker = dialog.getByLabel('Add assigned worker');
  await picker.locator('option', { hasText: 'Eve Tan' }).waitFor({ state: 'attached' }); // the picker fills in after the board answers
  const offered = await picker.locator('option').allInnerTexts();
  assert.ok(offered.includes('Eve Tan'), 'the typed name is offered: ' + offered.join(', '));
  assert.ok(!offered.some((n) => /Catalog Test Admin/.test(n)), 'the admin is never offered: ' + offered.join(', '));
  await picker.selectOption({ label: 'Eve Tan' });
  await dialog.getByRole('button', { name: 'Assign worker' }).click();
  await dialog.getByRole('button', { name: 'Remove Eve Tan' }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // Complete that booking through the real services (the fixture script, with the real clock), then read the commission on the screen.
  const done = spawnSync(process.execPath, ['--require', './src/server/__tests__/register.cjs', 'src/server/admin/team-browser.fixture.ts', '--complete'], { env: process.env, encoding: 'utf8' });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /open booking completed/);
  await page.reload({ waitUntil: 'networkidle' });
  await goToTeam(page);
  await page.getByRole('tab', { name: 'Commissions' }).click();
  await page.getByTestId('default-rate-line').waitFor();
  await page.getByText('By person').waitFor();
  await page.locator('#admin-content li', { hasText: 'Eve Tan' }).first().waitFor();
  const body = await text(page);
  // The desktop test above changed the shop default to 12%, so the new name earns 12% of the 800.00 tint (96.00), not the original 20%.
  assert.match(body, /Eve Tan\s*1 job\s*Earned ₱96\.00/, '12% of the 800.00 tint: ' + body.slice(0, 1500));
  assert.match(body, /12% of ₱800\.00/);
  assert.match(body, /Commission base ₱800\.00/);
  assert.match(body, /Counted: Regular Tint ₱800\.00/);
  assert.match(body, /Not counted: Basic Wash ₱180\.00 \(car wash does not earn commission\)/);
  await shot(page, 'flow-commission-1440');
  await context.close();
  assert.deepEqual(problems, [], 'no page error or console error in any run');
});
